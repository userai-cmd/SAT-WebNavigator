const fs = require("fs");
const path = require("path");

const KB_PATH = path.join(__dirname, "../data/knowledge-base.json");

let cache = null;

const SKIP_SHEETS = new Set(["🗺 Навигация"]);

function loadKnowledgeBase() {
  if (!cache) {
    cache = JSON.parse(fs.readFileSync(KB_PATH, "utf8"));
  }
  return cache;
}

function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text) {
  return normalize(text).split(" ").filter((w) => w.length > 2);
}

function getBotResponse(entry) {
  return (
    entry["Відповідь бота"] ||
    entry["Шаблон фрази (UA)"] ||
    entry["Значення"] ||
    entry["Опис"] ||
    null
  );
}

function entryId(entry) {
  return entry.ID || entry.Параметр || entry.Дата || entry.Лист || null;
}

function entryToChunkText(entry, sheetName) {
  const parts = [`[${sheetName}]`];
  const id = entryId(entry);
  if (id) parts.push(`ID: ${id}`);

  const fields = [
    ["Послуга", entry.Послуга],
    ["Категорія", entry.Категорія],
    ["Питання", entry.Питання],
    ["Тема", entry.Тема],
    ["Ситуація", entry.Ситуація],
    ["Параметр", entry.Параметр],
    ["Опис", entry.Опис],
    ["Параметри", entry.Параметри],
    ["Правило", entry["Правило / Умова"]],
    ["Ключові слова", entry["Ключові слова"]],
    ["Відповідь", getBotResponse(entry)],
    ["Примітки", entry.Примітки],
  ];

  for (const [label, value] of fields) {
    if (value && String(value).trim()) {
      parts.push(`${label}: ${String(value).trim()}`);
    }
  }

  return parts.join("\n");
}

function iterEntries(fn) {
  const kb = loadKnowledgeBase();
  for (const sheet of kb.sheets) {
    if (SKIP_SHEETS.has(sheet.id)) continue;
    for (const entry of sheet.entries) {
      if (!entryId(entry) && !getBotResponse(entry)) continue;
      fn(entry, sheet.id);
    }
  }
}

function getChunks() {
  const chunks = [];
  iterEntries((entry, sheetName) => {
    chunks.push({
      id: entryId(entry) || `${sheetName}-${chunks.length}`,
      sheet: sheetName,
      text: entryToChunkText(entry, sheetName),
      entry,
    });
  });
  return chunks;
}

function getToneOfVoiceRules() {
  const rules = [];
  const kb = loadKnowledgeBase();
  const sheet = kb.sheets.find((s) => s.id.includes("Стандарти спілкування"));
  if (!sheet) return rules;

  for (const entry of sheet.entries) {
    const note = entry.Примітки;
    const template = entry["Шаблон фрази (UA)"];
    const situation = entry.Ситуація;
    if (situation && (template || note)) {
      rules.push({ situation, template, note });
    }
  }
  return rules;
}

function scoreEntry(queryTokens, entry) {
  const keywords = entry["Ключові слова"] || "";
  const question =
    entry["Питання"] ||
    entry.Послуга ||
    entry.Тема ||
    entry.Ситуація ||
    entry.Категорія ||
    "";
  const haystack = normalize(
    [keywords, question, entry.Опис || "", entry.Параметри || "", entry["Правило / Умова"] || ""].join(" ")
  );
  let score = 0;
  for (const token of queryTokens) {
    if (haystack.includes(token)) score += 2;
  }
  const q = normalize(queryTokens.join(" "));
  if (keywords && q) {
    for (const kw of keywords.split(",")) {
      const k = normalize(kw);
      if (k && q.includes(k)) score += 5;
    }
  }
  return score;
}

function searchKnowledgeBase(query, limit = 3) {
  const tokens = tokenize(query);
  const scored = [];

  iterEntries((entry, sheetName) => {
    const score = scoreEntry(tokens, entry);
    if (score > 0) {
      scored.push({ score, entry, sheet: sheetName });
    }
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

module.exports = {
  loadKnowledgeBase,
  getBotResponse,
  entryToChunkText,
  getChunks,
  getToneOfVoiceRules,
  searchKnowledgeBase,
  entryId,
};
