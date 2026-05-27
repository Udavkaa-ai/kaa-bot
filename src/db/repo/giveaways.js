const { query } = require('../pool');

async function create({ chatId, messageId, creatorId, prize, endsAt, targetCount, winnersCount }) {
  const r = await query(
    `INSERT INTO giveaways (chat_id, message_id, creator_id, prize, ends_at, target_count, winners_count, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')
     RETURNING id`,
    [chatId, messageId, creatorId, prize, endsAt, targetCount, winnersCount]
  );
  return r.rows[0].id;
}

async function get(id) {
  const r = await query(`SELECT * FROM giveaways WHERE id = $1`, [id]);
  return r.rows[0] || null;
}

async function join(giveawayId, userId, username) {
  const r = await query(
    `INSERT INTO giveaway_participants (giveaway_id, user_id, username)
     VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING
     RETURNING giveaway_id`,
    [giveawayId, userId, username]
  );
  return r.rowCount > 0;
}

async function countParticipants(giveawayId) {
  const r = await query(
    `SELECT count(*)::int AS n FROM giveaway_participants WHERE giveaway_id = $1`,
    [giveawayId]
  );
  return r.rows[0]?.n || 0;
}

async function getParticipants(giveawayId) {
  const r = await query(
    `SELECT user_id, username FROM giveaway_participants WHERE giveaway_id = $1`,
    [giveawayId]
  );
  return r.rows;
}

async function setStatus(id, status) {
  await query(`UPDATE giveaways SET status = $2 WHERE id = $1`, [id, status]);
}

async function saveWinners(giveawayId, winners) {
  for (const w of winners) {
    await query(
      `INSERT INTO giveaway_winners (giveaway_id, user_id, username)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [giveawayId, w.user_id, w.username]
    );
  }
}

async function getExpired() {
  const r = await query(
    `SELECT id, chat_id, target_count FROM giveaways
     WHERE status = 'active' AND ends_at IS NOT NULL AND ends_at <= now()`
  );
  return r.rows;
}

async function getActiveByMessage(chatId, messageId) {
  const r = await query(
    `SELECT * FROM giveaways
     WHERE chat_id = $1 AND message_id = $2 AND status = 'active'`,
    [chatId, messageId]
  );
  return r.rows[0] || null;
}

module.exports = {
  create,
  get,
  join,
  countParticipants,
  getParticipants,
  setStatus,
  saveWinners,
  getExpired,
  getActiveByMessage,
};
