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

async function getSummary(days = 30) {
  const since = daysAgo(days);

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
    FROM sessions WHERE started_at >= ?`,
    [since]
  );

  const total = Number(totals?.total_sessions || 0);
  const resolved = Number(totals?.resolved_bot || 0);
  const escalated = Number(totals?.escalated || 0);
  const fallback = Number(totals?.fallback || 0);

  return {
    periodDays: days,
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

async function getDailyStats(days = 30) {
  const since = daysAgo(days);
  const day = dayExpr();
  const rows = await all(
    `SELECT ${day} AS day, COUNT(*) AS sessions
     FROM sessions WHERE started_at >= ?
     GROUP BY ${day} ORDER BY day`,
    [since]
  );
  return rows.map((r) => ({ day: r.day, sessions: Number(r.sessions) }));
}

async function getIntentStats(days = 30) {
  const since = daysAgo(days);
  const rows = await all(
    `SELECT intent, COUNT(*) AS count FROM messages
     WHERE role = 'bot' AND intent IS NOT NULL AND created_at >= ?
     GROUP BY intent ORDER BY count DESC LIMIT 12`,
    [since]
  );
  return rows.map((r) => ({ intent: r.intent, count: Number(r.count) }));
}

async function getTopQuestions(days = 30, limit = 10) {
  const since = daysAgo(days);
  const rows = await all(
    `SELECT text, COUNT(*) AS count FROM messages
     WHERE role = 'user' AND created_at >= ?
     GROUP BY text ORDER BY count DESC LIMIT ?`,
    [since, limit]
  );
  return rows.map((r) => ({ text: r.text, count: Number(r.count) }));
}

async function getRecentDialogs(limit = 50, offset = 0) {
  const sessions = await all(
    `SELECT id, started_at, last_activity, status, satisfaction, message_count
     FROM sessions ORDER BY last_activity DESC LIMIT ? OFFSET ?`,
    [limit, offset]
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

async function exportCsv(days = 30) {
  const since = daysAgo(days);
  const rows = await all(
    `SELECT s.id, s.started_at, s.status, s.satisfaction,
            m.role, m.text, m.intent, m.created_at
     FROM sessions s
     JOIN messages m ON m.session_id = s.id
     WHERE s.started_at >= ?
     ORDER BY s.started_at DESC, m.created_at ASC`,
    [since]
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
  getSummary,
  getDailyStats,
  getIntentStats,
  getTopQuestions,
  getRecentDialogs,
  exportCsv,
};
