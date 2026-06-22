const { getToneOfVoiceRules } = require("./kb");

const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini";
const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";

function isEnabled() {
  return Boolean(process.env.OPENAI_API_KEY);
}

function buildSystemPrompt() {
  const rules = getToneOfVoiceRules();
  const toneLines = rules
    .slice(0, 8)
    .map((r) => `- ${r.situation}: ${r.note || r.template || ""}`)
    .join("\n");

  return `Ти — офіційний онлайн-помічник транспортної компанії SAT (sat.ua), українською мовою.

ПРАВИЛА:
1. Відповідай ТІЛЬКИ на основі наданого контексту з бази знань SAT. Не вигадуй тарифи, терміни, адреси.
2. Якщо в контексті немає відповіді — чесно скажи і запропонуй: info@sat.ua або sat.ua.
3. Тон: дружній, діловий, стислий. 2–5 речень, без зайвої води.
4. Використовуй емодзі помірно (👋 🔍 📦).
5. Посилання оформлюй markdown: [текст](url).
6. Для трекінгу — sat.ua/tracking; калькулятор — sat.ua/calculator; кабінет — cabinet.sat.ua.
7. Не обіцяй те, чого немає в контексті (знижки, точні дати без API).

СТАНДАРТИ СПІЛКУВАННЯ SAT:
${toneLines || "- Вітай клієнта, будь корисним і точним."}`;
}

async function openaiFetch(path, body) {
  const res = await fetch(`https://api.openai.com/v1${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message || `OpenAI API error ${res.status}`);
  }
  return data;
}

async function embedText(text) {
  const data = await openaiFetch("/embeddings", {
    model: EMBEDDING_MODEL,
    input: text,
  });
  return data.data[0].embedding;
}

async function embedBatch(texts) {
  const data = await openaiFetch("/embeddings", {
    model: EMBEDDING_MODEL,
    input: texts,
  });
  return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

async function generateReply(message, contexts) {
  const contextBlock = contexts
    .map((c, i) => `--- Фрагмент ${i + 1} ---\n${c.text}`)
    .join("\n\n");

  const data = await openaiFetch("/chat/completions", {
    model: CHAT_MODEL,
    temperature: 0.3,
    max_tokens: 500,
    messages: [
      { role: "system", content: buildSystemPrompt() },
      {
        role: "user",
        content: `Контекст з бази знань SAT:\n\n${contextBlock}\n\n---\nПитання клієнта: ${message}\n\nДай відповідь українською на основі контексту.`,
      },
    ],
  });

  return data.choices[0].message.content.trim();
}

module.exports = {
  isEnabled,
  CHAT_MODEL,
  EMBEDDING_MODEL,
  embedText,
  embedBatch,
  generateReply,
  buildSystemPrompt,
};
