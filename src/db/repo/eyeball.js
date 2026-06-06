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

module.exports = { upsertScore, topByStreak };
