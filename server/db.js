const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "../data/analytics.db");
const usePg = Boolean(process.env.DATABASE_URL);

let sqlite = null;
let pgPool = null;

function toPg(sql) {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}

const SCHEMA_SQLITE = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  last_activity TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  satisfaction INTEGER,
  message_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  intent TEXT,
  mode TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);
`;

const SCHEMA_PG = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL,
  last_activity TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  satisfaction INTEGER,
  message_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  intent TEXT,
  mode TEXT,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id SERIAL PRIMARY KEY,
  session_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);
`;

async function initDb() {
  if (usePg) {
    const { Pool } = require("pg");
    pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
    });
    await pgPool.query(SCHEMA_PG);
    console.log("Analytics DB: PostgreSQL");
    return;
  }

  const Database = require("better-sqlite3");
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  sqlite = new Database(DB_PATH);
  sqlite.exec(SCHEMA_SQLITE);
  console.log("Analytics DB: SQLite →", DB_PATH);
}

async function all(sql, params = []) {
  if (usePg) {
    const res = await pgPool.query(toPg(sql), params);
    return res.rows;
  }
  return sqlite.prepare(sql).all(...params);
}

async function get(sql, params = []) {
  if (usePg) {
    const res = await pgPool.query(toPg(sql), params);
    return res.rows[0];
  }
  return sqlite.prepare(sql).get(...params);
}

async function run(sql, params = []) {
  if (usePg) {
    return pgPool.query(toPg(sql), params);
  }
  return sqlite.prepare(sql).run(...params);
}

function dbInfo() {
  return { driver: usePg ? "postgresql" : "sqlite", path: usePg ? "DATABASE_URL" : DB_PATH };
}

module.exports = { initDb, get, all, run, dbInfo };
