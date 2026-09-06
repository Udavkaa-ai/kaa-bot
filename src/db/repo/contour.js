const { query } = require('../pool');

// Мини-игра «Контур»: два режима, у каждого свой лучший результат.
//  guess  — «Страна»: сумма очков за игру (10 стран × до 30 очков)
//  border — «Граница»: средняя точность за игру (0–100)

async function recordGuessGame(chatId, userId, username, { score, correct, rounds }) {
  await query(
    `INSERT INTO contour_scores (chat_id, user_id, username, best_guess, guess_games, guess_correct, guess_rounds, updated_at)
     VALUES ($1, $2, $3, $4, 1, $5, $6, now())
     ON CONFLICT (chat_id, user_id) DO UPDATE SET
       username = COALESCE(EXCLUDED.username, contour_scores.username),
       best_guess = GREATEST(contour_scores.best_guess, EXCLUDED.best_guess),
       guess_games = contour_scores.guess_games + 1,
       guess_correct = contour_scores.guess_correct + EXCLUDED.guess_correct,
       guess_rounds = contour_scores.guess_rounds + EXCLUDED.guess_rounds,
       updated_at = now()`,
    [chatId, userId, username, score, correct, rounds]
  );
}

async function recordBorderGame(chatId, userId, username, { avg, sum, rounds }) {
  await query(
    `INSERT INTO contour_scores (chat_id, user_id, username, best_border, border_games, border_sum, border_rounds, updated_at)
     VALUES ($1, $2, $3, $4, 1, $5, $6, now())
     ON CONFLICT (chat_id, user_id) DO UPDATE SET
       username = COALESCE(EXCLUDED.username, contour_scores.username),
       best_border = GREATEST(contour_scores.best_border, EXCLUDED.best_border),
       border_games = contour_scores.border_games + 1,
       border_sum = contour_scores.border_sum + EXCLUDED.border_sum,
       border_rounds = contour_scores.border_rounds + EXCLUDED.border_rounds,
       updated_at = now()`,
    [chatId, userId, username, avg, sum, rounds]
  );
}

function cols(metric) {
  return metric === 'border'
    ? { best: 'best_border', games: 'border_games', tie: 'border_sum' }
    : { best: 'best_guess', games: 'guess_games', tie: 'guess_correct' };
}

// Топ чата по режиму: лучший результат, при равенстве — кто больше наиграл в сумме
async function getTop(chatId, metric, limit = 10) {
  const c = cols(metric);
  const r = await query(
    `SELECT user_id, username, ${c.best} AS best, ${c.games} AS games
     FROM contour_scores
     WHERE chat_id = $1 AND ${c.games} > 0
     ORDER BY ${c.best} DESC, ${c.tie} DESC, updated_at ASC
     LIMIT $2`,
    [chatId, limit]
  );
  return r.rows;
}

async function getStanding(chatId, userId, metric) {
  const c = cols(metric);
  const r = await query(
    `WITH ranked AS (
       SELECT user_id, ${c.best} AS best, ${c.games} AS games,
              RANK() OVER (ORDER BY ${c.best} DESC, ${c.tie} DESC) AS rank
       FROM contour_scores WHERE chat_id = $1 AND ${c.games} > 0
     )
     SELECT * FROM ranked WHERE user_id = $2`,
    [chatId, userId]
  );
  return r.rows[0] || null;
}

async function getAggregates(chatId, metric) {
  const c = cols(metric);
  const r = await query(
    `SELECT COUNT(*)::int AS players, COALESCE(MAX(${c.best}), 0)::int AS max_best
     FROM contour_scores WHERE chat_id = $1 AND ${c.games} > 0`,
    [chatId]
  );
  return r.rows[0] || { players: 0, max_best: 0 };
}

module.exports = { recordGuessGame, recordBorderGame, getTop, getStanding, getAggregates };
