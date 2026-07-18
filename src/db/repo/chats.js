const { query } = require('../pool');

async function upsertChat(chatId, title, type) {
  const r = await query(
    `INSERT INTO chats (id, title, type, last_msg_ts)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (id) DO UPDATE SET
       title = COALESCE(EXCLUDED.title, chats.title),
       type = COALESCE(EXCLUDED.type, chats.type),
       last_msg_ts = now()
     RETURNING *`,
    [chatId, title, type]
  );
  return r.rows[0];
}

async function setTriggers(chatId, triggersCsv) {
  await query(`UPDATE chats SET triggers = $2 WHERE id = $1`, [chatId, triggersCsv]);
}

async function getTriggers(chatId) {
  const r = await query(`SELECT triggers FROM chats WHERE id = $1`, [chatId]);
  const raw = r.rows[0]?.triggers;
  if (!raw) return null;
  return raw.toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
}

async function getChat(chatId) {
  const r = await query(`SELECT * FROM chats WHERE id = $1`, [chatId]);
  return r.rows[0] || null;
}

async function updateChatTopic(chatId, topic, facts, style) {
  await query(
    `UPDATE chats SET chat_topic = $2, chat_facts = $3, chat_style = $4 WHERE id = $1`,
    [chatId, topic, facts, style]
  );
}

async function setAutoRevive(chatId, enabled) {
  await query(`UPDATE chats SET auto_revive = $2 WHERE id = $1`, [chatId, !!enabled]);
}

async function getInactiveChats(thresholdMs) {
  const r = await query(
    `SELECT c.id FROM chats c
     WHERE c.auto_revive = true
       AND c.last_msg_ts IS NOT NULL
       AND (now() - c.last_msg_ts) > make_interval(secs => $1 / 1000)
       AND NOT EXISTS (
         SELECT 1 FROM muted_topics m
         WHERE m.chat_id = c.id AND m.thread_id = 'general'
       )`,
    [thresholdMs]
  );
  return r.rows.map(row => row.id);
}

async function toggleMute(chatId, threadId) {
  const tid = String(threadId ?? 'general');
  const existing = await query(
    `SELECT 1 FROM muted_topics WHERE chat_id = $1 AND thread_id = $2`,
    [chatId, tid]
  );
  if (existing.rows.length > 0) {
    await query(`DELETE FROM muted_topics WHERE chat_id = $1 AND thread_id = $2`, [chatId, tid]);
    return false;
  }
  await query(
    `INSERT INTO muted_topics (chat_id, thread_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [chatId, tid]
  );
  return true;
}

async function isMuted(chatId, threadId) {
  const tid = String(threadId ?? 'general');
  const r = await query(
    `SELECT 1 FROM muted_topics WHERE chat_id = $1 AND thread_id = $2`,
    [chatId, tid]
  );
  return r.rows.length > 0;
}

async function banUser(userId, reason) {
  await query(
    `INSERT INTO banned_users (user_id, reason) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET reason = EXCLUDED.reason`,
    [userId, reason || 'Banned by admin']
  );
}

async function unbanUser(userId) {
  await query(`DELETE FROM banned_users WHERE user_id = $1`, [userId]);
}

async function isBanned(userId) {
  const r = await query(`SELECT 1 FROM banned_users WHERE user_id = $1`, [userId]);
  return r.rows.length > 0;
}

async function listBanned() {
  const r = await query(`SELECT user_id, reason, banned_at FROM banned_users ORDER BY banned_at DESC`);
  return r.rows;
}

async function setTranscribeVoice(chatId, enabled) {
  await query(`UPDATE chats SET transcribe_voice = $1 WHERE id = $2`, [!!enabled, chatId]);
}

async function getTranscribeVoice(chatId) {
  const r = await query(`SELECT transcribe_voice FROM chats WHERE id = $1`, [chatId]);
  return r.rows[0]?.transcribe_voice === true;
}

module.exports = {
  upsertChat,
  getChat,
  setTriggers,
  getTriggers,
  updateChatTopic,
  setAutoRevive,
  getInactiveChats,
  toggleMute,
  isMuted,
  banUser,
  unbanUser,
  isBanned,
  listBanned,
  setTranscribeVoice,
  getTranscribeVoice,
};
