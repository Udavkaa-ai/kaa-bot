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
    `SELECT id, chat_id, user_id, username, fire_at, text
     FROM reminders WHERE fire_at <= now()`
  );
  return r.rows;
}

async function removeReminders(ids) {
  if (!ids || ids.length === 0) return;
  await query(`DELETE FROM reminders WHERE id = ANY($1)`, [ids]);
}

module.exports = {
  increment,
  getToday,
  getPeriod,
  getAllTime,
  addReminder,
  getPendingReminders,
  removeReminders,
};
