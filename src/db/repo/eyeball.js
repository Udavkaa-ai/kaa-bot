const { query } = require('../pool');

async function upsertScore(chatId, userId, username, { streak, bestAccuracy, addRounds }) {
  await query(
    `INSERT INTO eyeball_scores (chat_id, user_id, username, best_streak, best_accuracy, rounds, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (chat_id, user_id) DO UPDATE SET
       username = EXCLUDED.username,
       best_streak = GREATEST(eyeball_scores.best_streak, EXCLUDED.best_streak),
       best_accuracy = GREATEST(eyeball_scores.best_accuracy, EXCLUDED.best_accuracy),
       rounds = eyeball_scores.rounds + EXCLUDED.rounds,
       updated_at = now()`,
    [chatId, userId, username, streak, bestAccuracy, addRounds]
  );
}

async function topByStreak(chatId, limit = 10) {
  const r = await query(
    `SELECT user_id, username, best_streak, best_accuracy, rounds
     FROM eyeball_scores
     WHERE chat_id = $1
     ORDER BY best_streak DESC, best_accuracy DESC, rounds DESC
     LIMIT $2`,
    [chatId, limit]
  );
  return r.rows;
}

async function getUserStats(chatId, userId) {
  const r = await query(
    `WITH ranked AS (
       SELECT user_id, username, best_streak, best_accuracy, rounds,
              RANK() OVER (ORDER BY best_streak DESC, best_accuracy DESC, rounds DESC) AS rank
       FROM eyeball_scores
       WHERE chat_id = $1
     )
     SELECT user_id, username, best_streak, best_accuracy, rounds, rank
     FROM ranked WHERE user_id = $2`,
    [chatId, userId]
  );
  return r.rows[0] || null;
}

async function getChatAggregates(chatId) {
  const r = await query(
    `SELECT
       COALESCE(AVG(best_accuracy), 0)::float AS avg_acc,
       COALESCE(MAX(best_accuracy), 0)::float AS max_acc,
       COALESCE(MAX(best_streak), 0)::int    AS max_streak,
       COALESCE(SUM(rounds), 0)::int          AS total_rounds,
       COUNT(*)::int                          AS players
     FROM eyeball_scores
     WHERE chat_id = $1`,
    [chatId]
  );
  return r.rows[0] || { avg_acc: 0, max_acc: 0, max_streak: 0, total_rounds: 0, players: 0 };
}

module.exports = { upsertScore, topByStreak, getUserStats, getChatAggregates };
