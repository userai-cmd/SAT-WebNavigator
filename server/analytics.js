const { get, all, run, dbInfo } = require("./db");

const FALLBACK_INTENTS = new Set(["fallback", "empty"]);

function dayExpr() {
  return dbInfo().driver === "postgresql"
    ? "to_char(started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')"
    : "date(started_at)";
}

function now() {
  return new Date().toISOString();
}

function statusFromReply(reply) {
  if (!reply) return "open";
  if (reply.intent === "tracking" || reply.intent === "calculator" || reply.intent === "cabinet") {
    return "resolved_bot";
  }
  if (FALLBACK_INTENTS.has(reply.intent)) return "fallback";
  return "resolved_bot";
}

async function ensureSession(sessionId) {
  if (!sessionId) return;
  const ts = now();
  const existing = await get("SELECT id FROM sessions WHERE id = ?", [sessionId]);
  if (!existing) {
    await run(
      "INSERT INTO sessions (id, started_at, last_activity, status, message_count) VALUES (?, ?, ?, 'open', 0)",
      [sessionId, ts, ts]
    );
  }
}

async function logChat(sessionId, userMessage, reply) {
  if (!sessionId) return;

  await ensureSession(sessionId);
  const ts = now();
  const newStatus = statusFromReply(reply);

  await run(
    "INSERT INTO messages (session_id, role, text, intent, mode, created_at) VALUES (?, 'user', ?, NULL, NULL, ?)",
    [sessionId, userMessage.slice(0, 4000), ts]
  );

  await run(
    "INSERT INTO messages (session_id, role, text, intent, mode, created_at) VALUES (?, 'bot', ?, ?, ?, ?)",
    [sessionId, (reply.text || "").slice(0, 4000), reply.intent || null, reply.mode || null, ts]
  );

  const session = await get("SELECT status FROM sessions WHERE id = ?", [sessionId]);
  let status = newStatus;
  if (session?.status === "escalated") status = "escalated";

  await run(
    "UPDATE sessions SET last_activity = ?, status = ?, message_count = message_count + 2 WHERE id = ?",
    [ts, status, sessionId]
  );
}

async function logEvent(sessionId, eventType) {
  if (!sessionId) return;
  await ensureSession(sessionId);
  const ts = now();

  await run("INSERT INTO events (session_id, event_type, created_at) VALUES (?, ?, ?)", [
    sessionId,
    eventType,
    ts,
  ]);

  if (eventType === "escalate") {
    await run("UPDATE sessions SET status = 'escalated', last_activity = ? WHERE id = ?", [ts, sessionId]);
  }
}

async function logFeedback(sessionId, rating) {
  if (!sessionId) return;
  await ensureSession(sessionId);
  const ts = now();
  const r = rating > 0 ? 1 : -1;

  await run("INSERT INTO events (session_id, event_type, created_at) VALUES (?, ?, ?)", [
    sessionId,
    r > 0 ? "thumbs_up" : "thumbs_down",
    ts,
  ]);
  await run("UPDATE sessions SET satisfaction = ?, last_activity = ? WHERE id = ?", [r, ts, sessionId]);
}

function daysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function resolvePeriod({ days, from, to } = {}) {
  if (from && to) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      const err = new Error("Invalid date format, use YYYY-MM-DD");
      err.status = 400;
      throw err;
    }
    if (from > to) {
      const err = new Error("from must be before or equal to to");
      err.status = 400;
      throw err;
    }
    const fromIso = `${from}T00:00:00.000Z`;
    const end = new Date(`${to}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    return { from: fromIso, toExclusive: end.toISOString(), fromDate: from, toDate: to };
  }

  const d = Math.min(Math.max(Number(days) || 30, 1), 366);
  const end = new Date();
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - d);
  return {
    from: start.toISOString(),
    toExclusive: end.toISOString(),
    fromDate: start.toISOString().slice(0, 10),
    toDate: end.toISOString().slice(0, 10),
    periodDays: d,
  };
}

function sessionRangeWhere() {
  return "started_at >= ? AND started_at < ?";
}

function messageRangeWhere() {
  return "created_at >= ? AND created_at < ?";
}

async function getSummary(period) {
  const range = typeof period === "number" ? resolvePeriod({ days: period }) : resolvePeriod(period);
  const { from, toExclusive, fromDate, toDate, periodDays } = range;

  const totals = await get(
    `SELECT
      COUNT(*) AS total_sessions,
      SUM(CASE WHEN status = 'resolved_bot' THEN 1 ELSE 0 END) AS resolved_bot,
      SUM(CASE WHEN status = 'escalated' THEN 1 ELSE 0 END) AS escalated,
      SUM(CASE WHEN status = 'fallback' THEN 1 ELSE 0 END) AS fallback,
      SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_count,
      SUM(CASE WHEN satisfaction = 1 THEN 1 ELSE 0 END) AS thumbs_up,
      SUM(CASE WHEN satisfaction = -1 THEN 1 ELSE 0 END) AS thumbs_down,
      SUM(message_count) AS total_messages
    FROM sessions WHERE ${sessionRangeWhere()}`,
    [from, toExclusive]
  );

  const total = Number(totals?.total_sessions || 0);
  const resolved = Number(totals?.resolved_bot || 0);
  const escalated = Number(totals?.escalated || 0);
  const fallback = Number(totals?.fallback || 0);

  return {
    fromDate,
    toDate,
    periodDays: periodDays || null,
    totalSessions: total,
    resolvedByBot: resolved,
    escalated,
    fallback,
    open: Number(totals?.open_count || 0),
    thumbsUp: Number(totals?.thumbs_up || 0),
    thumbsDown: Number(totals?.thumbs_down || 0),
    totalMessages: Number(totals?.total_messages || 0),
    pctResolved: total ? Math.round((resolved / total) * 100) : 0,
    pctEscalated: total ? Math.round((escalated / total) * 100) : 0,
    pctFallback: total ? Math.round((fallback / total) * 100) : 0,
  };
}

async function getDailyStats(period) {
  const range = typeof period === "number" ? resolvePeriod({ days: period }) : resolvePeriod(period);
  const { from, toExclusive } = range;
  const day = dayExpr();
  const rows = await all(
    `SELECT ${day} AS day, COUNT(*) AS sessions
     FROM sessions WHERE ${sessionRangeWhere()}
     GROUP BY ${day} ORDER BY day`,
    [from, toExclusive]
  );
  return rows.map((r) => ({ day: r.day, sessions: Number(r.sessions) }));
}

async function getIntentStats(period) {
  const range = typeof period === "number" ? resolvePeriod({ days: period }) : resolvePeriod(period);
  const { from, toExclusive } = range;
  const rows = await all(
    `SELECT intent, COUNT(*) AS count FROM messages
     WHERE role = 'bot' AND intent IS NOT NULL AND ${messageRangeWhere()}
     GROUP BY intent ORDER BY count DESC LIMIT 12`,
    [from, toExclusive]
  );
  return rows.map((r) => ({ intent: r.intent, count: Number(r.count) }));
}

async function getTopQuestions(period, limit = 10) {
  const range = typeof period === "number" ? resolvePeriod({ days: period }) : resolvePeriod(period);
  const { from, toExclusive } = range;
  const rows = await all(
    `SELECT text, COUNT(*) AS count FROM messages
     WHERE role = 'user' AND ${messageRangeWhere()}
     GROUP BY text ORDER BY count DESC LIMIT ?`,
    [from, toExclusive, limit]
  );
  return rows.map((r) => ({ text: r.text, count: Number(r.count) }));
}

async function getRecentDialogs(limit = 50, offset = 0, period = null) {
  let queryParams;
  let where = "";
  if (period) {
    const range = resolvePeriod(period);
    where = `WHERE ${sessionRangeWhere()}`;
    queryParams = [range.from, range.toExclusive, limit, offset];
  } else {
    queryParams = [limit, offset];
  }

  const sessions = await all(
    `SELECT id, started_at, last_activity, status, satisfaction, message_count
     FROM sessions ${where} ORDER BY last_activity DESC LIMIT ? OFFSET ?`,
    queryParams
  );

  const dialogs = [];
  for (const s of sessions) {
    const msgs = await all(
      `SELECT role, text, intent, created_at FROM messages
       WHERE session_id = ? ORDER BY created_at ASC LIMIT 20`,
      [s.id]
    );
    dialogs.push({ ...s, messages: msgs });
  }
  return dialogs;
}

async function exportCsv(period) {
  const range = typeof period === "number" ? resolvePeriod({ days: period }) : resolvePeriod(period);
  const { from, toExclusive } = range;
  const rows = await all(
    `SELECT s.id, s.started_at, s.status, s.satisfaction,
            m.role, m.text, m.intent, m.created_at
     FROM sessions s
     JOIN messages m ON m.session_id = s.id
     WHERE s.started_at >= ? AND s.started_at < ?
     ORDER BY s.started_at DESC, m.created_at ASC`,
    [from, toExclusive]
  );

  const header = "session_id,started_at,status,satisfaction,role,text,intent,created_at\n";
  const lines = rows.map((r) => {
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    return [r.id, r.started_at, r.status, r.satisfaction, r.role, r.text, r.intent, r.created_at]
      .map(esc)
      .join(",");
  });
  return header + lines.join("\n");
}

module.exports = {
  logChat,
  logEvent,
  logFeedback,
  resolvePeriod,
  getSummary,
  getDailyStats,
  getIntentStats,
  getTopQuestions,
  getRecentDialogs,
  exportCsv,
};
