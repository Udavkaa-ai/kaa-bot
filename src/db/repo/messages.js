const pgvector = require('pgvector/pg');
const { query } = require('../pool');
const config = require('../../config');

async function addMessage(chatId, role, text, opts = {}) {
  await query(
    `INSERT INTO messages (chat_id, user_id, username, role, text, message_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [chatId, opts.userId || null, opts.username || null, role, text, opts.messageId || null]
  );
  await query(`UPDATE chats SET last_msg_ts = now() WHERE id = $1`, [chatId]);
}

async function getHistory(chatId, limit = config.historyLimit) {
  const r = await query(
    `SELECT user_id, username, role, text, ts FROM messages
     WHERE chat_id = $1 ORDER BY ts DESC LIMIT $2`,
    [chatId, limit]
  );
  return r.rows.reverse();
}

async function getRecentSince(chatId, hoursAgo) {
  const r = await query(
    `SELECT user_id, username, role, text, ts FROM messages
     WHERE chat_id = $1 AND ts > now() - make_interval(hours => $2)
     ORDER BY ts ASC`,
    [chatId, hoursAgo]
  );
  return r.rows;
}

async function addMemory({ chatId, userId, content, kind, importance, embedding }) {
  const vec = embedding ? pgvector.toSql(embedding) : null;
  await query(
    `INSERT INTO memories (chat_id, user_id, content, kind, importance, embedding)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [chatId || null, userId || null, content, kind || 'fact', importance ?? 0.5, vec]
  );
}

async function recallMemories({ chatId, userId, queryEmbedding, k = 5 }) {
  if (!queryEmbedding) return [];
  const vec = pgvector.toSql(queryEmbedding);
  const conditions = ['embedding IS NOT NULL'];
  const params = [vec];
  let idx = 2;
  if (chatId !== undefined && chatId !== null) {
    conditions.push(`(chat_id = $${idx} OR chat_id IS NULL)`);
    params.push(chatId);
    idx++;
  }
  if (userId !== undefined && userId !== null) {
    conditions.push(`(user_id = $${idx} OR user_id IS NULL)`);
    params.push(userId);
    idx++;
  }
  params.push(k);
  const r = await query(
    `SELECT content, kind, importance, ts,
            1 - (embedding <=> $1::vector) AS similarity
     FROM memories
     WHERE ${conditions.join(' AND ')}
     ORDER BY embedding <=> $1::vector
     LIMIT $${idx}`,
    params
  );
  return r.rows.filter(row => row.similarity > 0.5);
}

async function addDailySummary(chatId, date, summary, embedding) {
  const vec = embedding ? pgvector.toSql(embedding) : null;
  await query(
    `INSERT INTO daily_summaries (chat_id, date, summary, embedding)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (chat_id, date) DO UPDATE SET
       summary = EXCLUDED.summary,
       embedding = EXCLUDED.embedding`,
    [chatId, date, summary, vec]
  );
}

async function getRecentSummaries(chatId, days = 7) {
  const r = await query(
    `SELECT date, summary FROM daily_summaries
     WHERE chat_id = $1 AND date > current_date - make_interval(days => $2)
     ORDER BY date DESC`,
    [chatId, days]
  );
  return r.rows;
}

async function getChatsWithRecentActivity(daysBack = 1) {
  const r = await query(
    `SELECT DISTINCT chat_id FROM messages
     WHERE ts > now() - make_interval(days => $1)`,
    [daysBack]
  );
  return r.rows.map(row => row.chat_id);
}

module.exports = {
  addMessage,
  getHistory,
  getRecentSince,
  addMemory,
  recallMemories,
  addDailySummary,
  getRecentSummaries,
  getChatsWithRecentActivity,
};
