const { query } = require('../pool');

const cache = new Map();

async function get(key) {
  if (cache.has(key)) return cache.get(key);
  const r = await query(`SELECT value FROM bot_settings WHERE key = $1`, [key]);
  const v = r.rows[0] ? r.rows[0].value : null;
  cache.set(key, v);
  return v;
}

async function set(key, value) {
  await query(
    `INSERT INTO bot_settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, value]
  );
  cache.set(key, value);
}

async function getJson(key) {
  const v = await get(key);
  if (!v) return null;
  try { return JSON.parse(v); } catch (_) { return null; }
}

async function setJson(key, obj) {
  return set(key, JSON.stringify(obj));
}

module.exports = { get, set, getJson, setJson };
