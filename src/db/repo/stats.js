const { query } = require('../pool');

async function increment(provider, model) {
  await query(
    `INSERT INTO usage_stats (date, provider, model, count)
     VALUES (current_date, $1, $2, 1)
     ON CONFLICT (date, provider, model) DO UPDATE SET
       count = usage_stats.count + 1`,
    [provider, model]
  );
}

async function getToday() {
  const r = await query(
    `SELECT provider, model, count FROM usage_stats
     WHERE date = current_date
     ORDER BY count DESC`
  );
  return r.rows;
}

async function getPeriod(days) {
  const r = await query(
    `SELECT provider, model, SUM(count)::int AS count FROM usage_stats
     WHERE date > current_date - make_interval(days => $1)
     GROUP BY provider, model
     ORDER BY SUM(count) DESC`,
    [days]
  );
  return r.rows;
}

async function getAllTime() {
  const r = await query(
    `SELECT provider, model, SUM(count)::int AS count FROM usage_stats
     GROUP BY provider, model
     ORDER BY SUM(count) DESC`
  );
  return r.rows;
}

async function addReminder(chatId, userId, username, fireAt, text) {
  await query(
    `INSERT INTO reminders (chat_id, user_id, username, fire_at, text)
     VALUES ($1, $2, $3, $4, $5)`,
    [chatId, userId, username, fireAt, text]
  );
}

async function getPendingReminders() {
  const r = await query(
    `SELECT id, chat_id, user_id, username, fire_at, text, kind, recurring
     FROM reminders WHERE fire_at <= now()`
  );
  return r.rows;
}

async function removeReminders(ids) {
  if (!ids || ids.length === 0) return;
  await query(`DELETE FROM reminders WHERE id = ANY($1)`, [ids]);
}

async function addLeaderReminder(chatId, fireAt) {
  await query(
    `INSERT INTO reminders (chat_id, kind, recurring, fire_at, text)
     VALUES ($1, 'eyeball_top', 'daily', $2, '')`,
    [chatId, fireAt]
  );
}

async function bumpRecurring(id, nextFireAt) {
  await query(`UPDATE reminders SET fire_at = $1 WHERE id = $2`, [nextFireAt, id]);
}

async function removeByChatAndKind(chatId, kind) {
  await query(`DELETE FROM reminders WHERE chat_id = $1 AND kind = $2`, [chatId, kind]);
}

async function getLeaderReminder(chatId) {
  const r = await query(
    `SELECT id, fire_at FROM reminders
     WHERE chat_id = $1 AND kind = 'eyeball_top'
     ORDER BY fire_at ASC LIMIT 1`,
    [chatId]
  );
  return r.rows[0] || null;
}

module.exports = {
  increment,
  getToday,
  getPeriod,
  getAllTime,
  addReminder,
  getPendingReminders,
  removeReminders,
  addLeaderReminder,
  bumpRecurring,
  removeByChatAndKind,
  getLeaderReminder,
};
