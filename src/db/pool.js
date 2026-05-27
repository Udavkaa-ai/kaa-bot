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

pool.on('connect', async (client) => {
  try {
    await pgvector.registerType(client);
  } catch (err) {
    console.error('[DB] pgvector registerType failed:', err.message);
  }
});

pool.on('error', (err) => {
  console.error('[DB] Pool error:', err.message);
});

async function query(sql, params) {
  return pool.query(sql, params);
}

async function migrate() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  await pool.query(sql);
  console.log('[DB] Схема применена');
}

async function close() {
  await pool.end();
}

module.exports = { pool, query, migrate, close };
