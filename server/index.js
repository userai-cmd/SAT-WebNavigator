const express = require("express");
const cors = require("cors");
const path = require("path");
const { chat, loadKnowledgeBase } = require("./chat");

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

// Static: widget, test page
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
  });
});

app.post("/api/chat", (req, res) => {
  const { message } = req.body || {};
  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "message is required" });
  }
  const reply = chat(message);
  res.json({ message, reply });
});

app.listen(PORT, () => {
  loadKnowledgeBase();
  console.log(`SAT WebNavigator → http://localhost:${PORT}`);
});
