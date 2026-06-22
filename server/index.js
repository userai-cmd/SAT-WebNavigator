require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const { chat, loadKnowledgeBase } = require("./chat");
const { ensureRagReady, getRagStatus } = require("./rag");
const { isEnabled } = require("./llm");

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
  });
});

app.post("/api/chat", async (req, res) => {
  const { message } = req.body || {};
  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "message is required" });
  }
  try {
    const reply = await chat(message);
    res.json({ message, reply });
  } catch (err) {
    console.error("[api/chat]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

async function start() {
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
  });
}

start();
