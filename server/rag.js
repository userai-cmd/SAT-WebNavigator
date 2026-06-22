const fs = require("fs");
const path = require("path");
const { getChunks, searchKnowledgeBase } = require("./kb");
const { embedText, embedBatch, isEnabled, EMBEDDING_MODEL } = require("./llm");

const EMBEDDINGS_PATH = path.join(__dirname, "../data/embeddings.json");
const TOP_K = Number(process.env.RAG_TOP_K || 5);

let store = null;
let initPromise = null;

function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function saveEmbeddings(chunks) {
  const payload = {
    model: EMBEDDING_MODEL,
    builtAt: new Date().toISOString(),
    chunkCount: chunks.length,
    chunks: chunks.map((c) => ({
      id: c.id,
      sheet: c.sheet,
      text: c.text,
      embedding: c.embedding,
    })),
  };
  fs.writeFileSync(EMBEDDINGS_PATH, JSON.stringify(payload));
  return payload;
}

async function buildEmbeddings() {
  if (!isEnabled()) {
    throw new Error("OPENAI_API_KEY required to build embeddings");
  }

  const chunks = getChunks();
  const batchSize = 50;
  const withEmbeddings = [];

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const texts = batch.map((c) => c.text);
    const embeddings = await embedBatch(texts);
    batch.forEach((chunk, idx) => {
      withEmbeddings.push({ ...chunk, embedding: embeddings[idx] });
    });
    console.log(`Embeddings: ${Math.min(i + batchSize, chunks.length)}/${chunks.length}`);
  }

  return saveEmbeddings(withEmbeddings);
}

function loadEmbeddingsFromDisk() {
  if (!fs.existsSync(EMBEDDINGS_PATH)) return null;
  const data = JSON.parse(fs.readFileSync(EMBEDDINGS_PATH, "utf8"));
  if (!data.chunks?.length) return null;
  return data;
}

async function ensureRagReady() {
  if (store) return store;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    let data = loadEmbeddingsFromDisk();

    if (!data && isEnabled()) {
      console.log("Building embeddings (first run)...");
      data = await buildEmbeddings();
    }

    store = data;
    return store;
  })();

  return initPromise;
}

function keywordFallback(query, limit = TOP_K) {
  return searchKnowledgeBase(query, limit).map((r) => ({
    id: r.entry.ID || r.entry.Параметр,
    sheet: r.sheet,
    text: require("./kb").entryToChunkText(r.entry, r.sheet),
    score: r.score,
    method: "keyword",
  }));
}

async function retrieve(query, limit = TOP_K) {
  const storeData = await ensureRagReady();

  if (!storeData || !isEnabled()) {
    return keywordFallback(query, limit);
  }

  const queryEmbedding = await embedText(query);
  const scored = storeData.chunks.map((chunk) => ({
    id: chunk.id,
    sheet: chunk.sheet,
    text: chunk.text,
    score: cosineSimilarity(queryEmbedding, chunk.embedding),
    method: "embedding",
  }));

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, limit);

  if (top[0]?.score < 0.35) {
    const kw = keywordFallback(query, 2);
    const merged = [...top.slice(0, 3)];
    for (const k of kw) {
      if (!merged.find((m) => m.id === k.id)) merged.push(k);
    }
    return merged.slice(0, limit);
  }

  return top;
}

function getRagStatus() {
  const onDisk = fs.existsSync(EMBEDDINGS_PATH);
  let chunkCount = 0;
  if (onDisk) {
    try {
      chunkCount = JSON.parse(fs.readFileSync(EMBEDDINGS_PATH, "utf8")).chunkCount || 0;
    } catch (_) {}
  }
  return {
    enabled: isEnabled(),
    embeddingsOnDisk: onDisk,
    chunkCount,
    model: EMBEDDING_MODEL,
    topK: TOP_K,
  };
}

module.exports = {
  ensureRagReady,
  buildEmbeddings,
  retrieve,
  getRagStatus,
};
