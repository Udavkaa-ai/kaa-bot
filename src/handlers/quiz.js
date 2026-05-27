const claude = require('../providers/claude');
const quizRepo = require('../db/repo/quiz');
const chatsRepo = require('../db/repo/chats');
const { sendSafe } = require('../utils/telegram');

// Кулдаун на /quiz — не чаще раза в 30с в одном чате
const quizCooldown = new Map();
const COOLDOWN_MS = 30 * 1000;

async function generateQuestion(topicHint) {
  const system = `Ты — генератор квизов. Создай ОДИН интересный вопрос с 4 вариантами ответа.

Правила:
- question: ≤200 символов, конкретный, проверяемый
- options: ровно 4 варианта, каждый ≤80 символов, без префиксов (а), 1., -)
- correct_option: индекс правильного, число 0-3
- explanation: 1-2 предложения почему правильно, ≤180 символов
- Сложность средняя — для взрослых эрудитов, не школьная
- На русском
- НЕ повторяй один и тот же тип вопросов; миксуй: история, наука, культура, кино, музыка, гео, спорт, тех

Формат строго JSON:
{"question": "...", "options": ["...", "...", "...", "..."], "correct_option": 0, "explanation": "..."}`;

  const userText = topicHint
    ? `Тема: ${topicHint}. Придумай вопрос в эту тему.`
    : 'Придумай неожиданный, интересный вопрос на любую тему.';

  const result = await claude.askJson({
    system,
    userText,
    opts: { temperature: 0.95, maxTokens: 500 },
  });

  if (!result) return null;
  if (!result.question || typeof result.question !== 'string') return null;
  if (!Array.isArray(result.options) || result.options.length !== 4) return null;
  if (typeof result.correct_option !== 'number' || result.correct_option < 0 || result.correct_option > 3) return null;

  return {
    question: String(result.question).slice(0, 290),
    options: result.options.map(o => String(o).slice(0, 95)),
    correct_option: Math.floor(result.correct_option),
    explanation: String(result.explanation || '').slice(0, 195),
  };
}

async function handleQuizCommand(bot, msg, argsText) {
  const chatId = msg.chat.id;

  const last = quizCooldown.get(chatId);
  if (last && Date.now() - last < COOLDOWN_MS) {
    const left = Math.ceil((COOLDOWN_MS - (Date.now() - last)) / 1000);
    await sendSafe(bot, chatId, `Подожди ${left} сек до следующего вопроса.`, { reply_to_message_id: msg.message_id });
    return;
  }
  quizCooldown.set(chatId, Date.now());

  let topic = (argsText || '').trim();
  if (!topic) {
    const chat = await chatsRepo.getChat(chatId);
    topic = chat?.chat_topic || null;
  }

  await bot.sendChatAction(chatId, 'typing').catch(() => {});

  let quiz = null;
  for (let attempt = 0; attempt < 2 && !quiz; attempt++) {
    try {
      quiz = await generateQuestion(topic);
    } catch (err) {
      console.warn('[QUIZ] gen failed:', err.message);
    }
  }
  if (!quiz) {
    quizCooldown.delete(chatId);
    await sendSafe(bot, chatId, 'Не получилось сочинить вопрос. Попробуй ещё раз.', { reply_to_message_id: msg.message_id });
    return;
  }

  try {
    const sent = await bot.sendPoll(chatId, quiz.question, quiz.options, {
      type: 'quiz',
      correct_option_id: quiz.correct_option,
      explanation: quiz.explanation || undefined,
      is_anonymous: false,
      reply_to_message_id: msg.message_id,
    });

    const pollId = sent.poll?.id || String(sent.message_id);
    await quizRepo.saveQuiz({
      pollId,
      chatId,
      messageId: sent.message_id,
      question: quiz.question,
      correctOption: quiz.correct_option,
      topic,
    });

    console.log(`[QUIZ] chat=${chatId} pollId=${pollId} correct=${quiz.correct_option}`);
  } catch (err) {
    console.error('[QUIZ] sendPoll:', err.message);
    await sendSafe(bot, chatId, 'Telegram не пустил вопрос. Возможно, бот не админ в группе.',
      { reply_to_message_id: msg.message_id });
  }
}

async function handlePollAnswer(bot, pollAnswer) {
  const pollId = pollAnswer.poll_id;
  const userId = pollAnswer.user?.id;
  const username = pollAnswer.user?.username
    ? `@${pollAnswer.user.username}`
    : pollAnswer.user?.first_name || `id${userId}`;
  const chosen = pollAnswer.option_ids?.[0];

  if (!pollId || !userId || chosen === undefined) return;

  const quiz = await quizRepo.getQuiz(pollId);
  if (!quiz) return;

  // Один ответ на юзера засчитывается
  const fresh = await quizRepo.recordAnswer(pollId, userId);
  if (!fresh) return;

  const isCorrect = chosen === quiz.correct_option;
  await quizRepo.bumpScore(quiz.chat_id, userId, username, isCorrect);
  console.log(`[QUIZ] pollId=${pollId} user=${username} ${isCorrect ? 'OK' : 'miss'}`);
}

async function handleLeaderboard(bot, msg) {
  const chatId = msg.chat.id;
  const rows = await quizRepo.getLeaderboard(chatId, 10);
  if (rows.length === 0) {
    await sendSafe(bot, chatId, 'Пока никто не отвечал. Начни с /quiz', { reply_to_message_id: msg.message_id });
    return;
  }
  const medals = ['🥇', '🥈', '🥉'];
  const lines = ['🏆 Топ викторины'];
  rows.forEach((r, i) => {
    const prefix = medals[i] || `${i + 1}.`;
    lines.push(`${prefix} ${r.username || `id${r.user_id}`} — ${r.correct}/${r.total} (${r.pct}%)`);
  });
  await sendSafe(bot, chatId, lines.join('\n'), { reply_to_message_id: msg.message_id });
}

module.exports = { handleQuizCommand, handlePollAnswer, handleLeaderboard };
