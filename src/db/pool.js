const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const pgvector = require('pgvector/pg');
const config = require('../config');

const useSsl = /railway|render|amazonaws|supabase|neon|aiven|cockroach/i.test(config.databaseUrl || '');

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
});

let vectorReady = false;

pool.on('connect', (client) => {
  if (!vectorReady) return;
  pgvector.registerType(client).catch((err) => {
    console.error('[DB] pgvector registerType failed on new connection:', err.message);
  });
});

pool.on('error', (err) => {
  console.error('[DB] Pool error:', err.message);
});

async function query(sql, params) {
  return pool.query(sql, params);
}

async function migrate() {
  const client = await pool.connect();
  try {
    try {
      await client.query('CREATE EXTENSION IF NOT EXISTS vector');
      await pgvector.registerType(client);
      vectorReady = true;
      console.log('[DB] pgvector готов');
    } catch (err) {
      console.error('[DB] pgvector недоступен — embeddings/memory отключаются:', err.message);
    }
    const schemaPath = path.join(__dirname, 'schema.sql');
    const sql = fs.readFileSync(schemaPath, 'utf8');
    await client.query(sql);
    console.log('[DB] Схема применена');
  } finally {
    client.release();
  }
}

async function close() {
  await pool.end();
}

module.exports = { pool, query, migrate, close };
