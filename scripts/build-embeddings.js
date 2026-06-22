#!/usr/bin/env node
require("dotenv").config();

const { buildEmbeddings } = require("../server/rag");
const { getChunks } = require("../server/kb");

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error("❌ OPENAI_API_KEY не встановлено. Додайте в .env або змінні середовища.");
    process.exit(1);
  }

  const chunks = getChunks();
  console.log(`Будуємо embeddings для ${chunks.length} фрагментів...`);
  const result = await buildEmbeddings();
  console.log(`✓ Готово: ${result.chunkCount} chunks → data/embeddings.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
