const { query } = require('../pool');

async function saveQuiz({ pollId, chatId, messageId, question, correctOption, topic }) {
  await query(
    `INSERT INTO quizzes (poll_id, chat_id, message_id, question, correct_option, topic)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (poll_id) DO NOTHING`,
    [pollId, chatId, messageId, question, correctOption, topic]
  );
}

async function getQuiz(pollId) {
  const r = await query(`SELECT * FROM quizzes WHERE poll_id = $1`, [pollId]);
  return r.rows[0] || null;
}

async function recordAnswer(pollId, userId) {
  const r = await query(
    `INSERT INTO quiz_answers (poll_id, user_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING RETURNING user_id`,
    [pollId, userId]
  );
  return r.rowCount > 0;
}

async function bumpScore(chatId, userId, username, isCorrect) {
  await query(
    `INSERT INTO quiz_scores (chat_id, user_id, username, correct, total)
     VALUES ($1, $2, $3, $4, 1)
     ON CONFLICT (chat_id, user_id) DO UPDATE SET
       username = COALESCE(EXCLUDED.username, quiz_scores.username),
       correct = quiz_scores.correct + EXCLUDED.correct,
       total = quiz_scores.total + 1`,
    [chatId, userId, username, isCorrect ? 1 : 0]
  );
}

async function getLeaderboard(chatId, limit = 10) {
  const r = await query(
    `SELECT user_id, username, correct, total,
            CASE WHEN total > 0 THEN ROUND(correct::numeric * 100 / total, 0)::int ELSE 0 END AS pct
     FROM quiz_scores
     WHERE chat_id = $1 AND total > 0
     ORDER BY correct DESC, pct DESC
     LIMIT $2`,
    [chatId, limit]
  );
  return r.rows;
}

async function getUserScore(chatId, userId) {
  const r = await query(
    `SELECT correct, total FROM quiz_scores WHERE chat_id = $1 AND user_id = $2`,
    [chatId, userId]
  );
  return r.rows[0] || null;
}

module.exports = {
  saveQuiz,
  getQuiz,
  recordAnswer,
  bumpScore,
  getLeaderboard,
  getUserScore,
};
