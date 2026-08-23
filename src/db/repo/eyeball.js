const { query } = require('../pool');

const CURRENT_SEASON = 3;

function tableFor(season) {
  if (season === 1) return 'eyeball_scores_s1';
  if (season === 2) return 'eyeball_scores_s2';
  return 'eyeball_scores';
}

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

// Индивидуальный раунд — только для расчёта скользящей средней (текущий сезон).
async function addRound(chatId, userId, accuracy) {
  await query(
    `INSERT INTO eyeball_rounds (chat_id, user_id, accuracy) VALUES ($1, $2, $3)`,
    [chatId, userId, accuracy]
  );
}

// Текущий сезон: топ содержит и best_streak, и avg_last_100. Сортировка: серия → средняя → лучшая.
// Старые сезоны: старая таблица, avg_last_100 = 0 (тогда не считали).
async function topByStreak(chatId, limit = 10, season = CURRENT_SEASON) {
  if (season === CURRENT_SEASON) {
    const r = await query(
      `SELECT s.user_id, s.username, s.best_streak, s.best_accuracy::float AS best_accuracy, s.rounds,
        COALESCE((
          SELECT AVG(accuracy)::float FROM (
            SELECT accuracy FROM eyeball_rounds
            WHERE chat_id = s.chat_id AND user_id = s.user_id
            ORDER BY ts DESC LIMIT 100
          ) sub
        ), 0)::float AS avg_last_100
      FROM eyeball_scores s
      WHERE s.chat_id = $1
      ORDER BY s.best_streak DESC, avg_last_100 DESC, s.best_accuracy DESC
      LIMIT $2`,
      [chatId, limit]
    );
    return r.rows;
  }
  const t = tableFor(season);
  const r = await query(
    `SELECT user_id, username, best_streak, best_accuracy::float AS best_accuracy, rounds,
       0::float AS avg_last_100
     FROM ${t}
     WHERE chat_id = $1
     ORDER BY best_streak DESC, best_accuracy DESC, rounds DESC
     LIMIT $2`,
    [chatId, limit]
  );
  return r.rows;
}

async function getUserStats(chatId, userId, season = CURRENT_SEASON) {
  if (season === CURRENT_SEASON) {
    const r = await query(
      `WITH scored AS (
         SELECT s.user_id, s.username, s.best_streak, s.best_accuracy::float AS best_accuracy, s.rounds,
           COALESCE((
             SELECT AVG(accuracy)::float FROM (
               SELECT accuracy FROM eyeball_rounds
               WHERE chat_id = s.chat_id AND user_id = s.user_id
               ORDER BY ts DESC LIMIT 100
             ) sub
           ), 0)::float AS avg_last_100
         FROM eyeball_scores s
         WHERE s.chat_id = $1
       ),
       ranked AS (
         SELECT *, RANK() OVER (ORDER BY best_streak DESC, avg_last_100 DESC, best_accuracy DESC) AS rank
         FROM scored
       )
       SELECT * FROM ranked WHERE user_id = $2`,
      [chatId, userId]
    );
    return r.rows[0] || null;
  }
  const t = tableFor(season);
  const r = await query(
    `WITH ranked AS (
       SELECT user_id, username, best_streak, best_accuracy::float AS best_accuracy, rounds,
         RANK() OVER (ORDER BY best_streak DESC, best_accuracy DESC, rounds DESC) AS rank
       FROM ${t}
       WHERE chat_id = $1
     )
     SELECT user_id, username, best_streak, best_accuracy, rounds, rank, 0::float AS avg_last_100
     FROM ranked WHERE user_id = $2`,
    [chatId, userId]
  );
  return r.rows[0] || null;
}

async function getChatAggregates(chatId, season = CURRENT_SEASON) {
  const t = tableFor(season);
  const r = await query(
    `SELECT
       COALESCE(AVG(best_accuracy), 0)::float AS avg_acc,
       COALESCE(MAX(best_accuracy), 0)::float AS max_acc,
       COALESCE(MAX(best_streak), 0)::int    AS max_streak,
       COALESCE(SUM(rounds), 0)::int          AS total_rounds,
       COUNT(*)::int                          AS players
     FROM ${t}
     WHERE chat_id = $1`,
    [chatId]
  );
  return r.rows[0] || { avg_acc: 0, max_acc: 0, max_streak: 0, total_rounds: 0, players: 0 };
}

module.exports = { CURRENT_SEASON, upsertScore, addRound, topByStreak, getUserStats, getChatAggregates };
