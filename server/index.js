require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const { chat, loadKnowledgeBase } = require("./chat");
const { ensureRagReady, getRagStatus } = require("./rag");
const { isEnabled } = require("./llm");
const { initDb, dbInfo } = require("./db");
const analytics = require("./analytics");

const app = express();
const PORT = process.env.PORT || 3000;

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "*")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
  })
);
app.use(express.json());

app.use("/widget", express.static(path.join(__dirname, "../widget")));
app.use("/admin", express.static(path.join(__dirname, "../admin")));
app.use(express.static(path.join(__dirname, "../public")));

app.get("/health", (_req, res) => {
  const kb = loadKnowledgeBase();
  res.json({
    status: "ok",
    service: "sat-webnavigator",
    knowledgeBase: {
      version: kb.version,
      entries: kb.totalEntries,
      sheets: kb.sheetCount,
    },
    rag: getRagStatus(),
    llm: { enabled: isEnabled() },
    analytics: dbInfo(),
  });
});

app.post("/api/chat", async (req, res) => {
  const { message, sessionId } = req.body || {};
  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "message is required" });
  }
  try {
    const reply = await chat(message);
    analytics.logChat(sessionId, message, reply).catch((e) => console.warn("[analytics]", e.message));
    res.json({ message, sessionId, reply });
  } catch (err) {
    console.error("[api/chat]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/event", async (req, res) => {
  const { sessionId, type } = req.body || {};
  if (!sessionId || !type) {
    return res.status(400).json({ error: "sessionId and type required" });
  }
  try {
    await analytics.logEvent(sessionId, type);
    res.json({ ok: true });
  } catch (err) {
    console.error("[api/event]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/feedback", async (req, res) => {
  const { sessionId, rating } = req.body || {};
  if (!sessionId || rating === undefined) {
    return res.status(400).json({ error: "sessionId and rating required" });
  }
  try {
    await analytics.logFeedback(sessionId, Number(rating));
    res.json({ ok: true });
  } catch (err) {
    console.error("[api/feedback]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/stats", async (req, res) => {
  try {
    const days = Number(req.query.days) || 30;
    const [summary, daily, intents, topQuestions] = await Promise.all([
      analytics.getSummary(days),
      analytics.getDailyStats(days),
      analytics.getIntentStats(days),
      analytics.getTopQuestions(days),
    ]);
    res.json({ summary, daily, intents, topQuestions });
  } catch (err) {
    console.error("[api/stats]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/dialogs", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const offset = Number(req.query.offset) || 0;
    const dialogs = await analytics.getRecentDialogs(limit, offset);
    res.json({ dialogs });
  } catch (err) {
    console.error("[api/dialogs]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/export.csv", async (req, res) => {
  try {
    const days = Number(req.query.days) || 30;
    const csv = await analytics.exportCsv(days);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="sat-analytics-${days}d.csv"`);
    res.send("\uFEFF" + csv);
  } catch (err) {
    console.error("[api/export]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

async function start() {
  await initDb();
  loadKnowledgeBase();

  if (isEnabled()) {
    ensureRagReady()
      .then(() => console.log("RAG ready:", getRagStatus().chunkCount, "chunks"))
      .catch((err) => console.warn("RAG init warning:", err.message));
  } else {
    console.warn("OPENAI_API_KEY not set — LLM/RAG embeddings disabled, keyword mode only");
  }

  app.listen(PORT, () => {
    console.log(`SAT WebNavigator → http://localhost:${PORT}`);
    console.log(`Analytics dashboard → http://localhost:${PORT}/admin/`);
  });
}

start();
