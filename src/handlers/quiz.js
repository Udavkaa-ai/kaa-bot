const claude = require('../providers/claude');
const quizRepo = require('../db/repo/quiz');
const chatsRepo = require('../db/repo/chats');
const { sendSafe, noticeUser } = require('../utils/telegram');

// Кулдаун на /quiz — не чаще раза в 30с в одном чате
const quizCooldown = new Map();
const COOLDOWN_MS = 30 * 1000;

async function generateQuestion(topicHint, avoidQuestions = []) {
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

  let userText = topicHint
    ? `Тема: ${topicHint}. Придумай вопрос в эту тему.`
    : 'Придумай неожиданный, интересный вопрос на любую тему.';
  if (avoidQuestions.length > 0) {
    userText += `\n\nЭти вопросы УЖЕ были, не повторяй их и близкие к ним:\n` +
      avoidQuestions.map(q => `- ${q}`).join('\n').slice(0, 1500);
  }

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

// Активные серии вопросов: chatId -> { total, index, topic, asked, starterId, timer }
const activeSeries = new Map();
const SERIES_INTERVAL_MS = 30 * 1000;

// Генерация + отправка одного вопроса. label — префикс вида "2/5. " для серий.
async function postOneQuiz(bot, chatId, topic, { replyTo = null, label = '', avoid = [] } = {}) {
  await bot.sendChatAction(chatId, 'typing').catch(() => {});

  let quiz = null;
  for (let attempt = 0; attempt < 2 && !quiz; attempt++) {
    try {
      quiz = await generateQuestion(topic, avoid);
    } catch (err) {
      console.warn('[QUIZ] gen failed:', err.message);
    }
  }
  if (!quiz) return null;

  try {
    const question = (label + quiz.question).slice(0, 300);
    const sent = await bot.sendPoll(chatId, question, quiz.options, {
      type: 'quiz',
      correct_option_id: quiz.correct_option,
      explanation: quiz.explanation || undefined,
      is_anonymous: false,
      ...(replyTo ? { reply_to_message_id: replyTo } : {}),
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
    return quiz;
  } catch (err) {
    console.error('[QUIZ] sendPoll:', err.message);
    return null;
  }
}

async function runSeriesStep(bot, chatId) {
  const s = activeSeries.get(chatId);
  if (!s) return;
  s.index++;
  const label = `${s.index}/${s.total}. `;
  const quiz = await postOneQuiz(bot, chatId, s.topic, { label, avoid: s.asked });
  if (quiz) s.asked.push(quiz.question);

  if (s.index >= s.total) {
    activeSeries.delete(chatId);
    quizCooldown.set(chatId, Date.now());
    await sendSafe(bot, chatId, `Серия из ${s.total} вопросов закончена. Итоги: /leaderboard`);
    return;
  }
  s.timer = setTimeout(() => {
    runSeriesStep(bot, chatId).catch(err => console.error('[QUIZ SERIES]', err.message));
  }, SERIES_INTERVAL_MS);
}

async function handleQuizCommand(bot, msg, argsText) {
  const chatId = msg.chat.id;
  const raw = (argsText || '').trim();

  // /quiz stop — остановить серию (только запустивший или владелец бота)
  if (/^(stop|стоп)$/i.test(raw)) {
    const s = activeSeries.get(chatId);
    if (!s) {
      await noticeUser(bot, msg, 'Активной серии нет.');
      return;
    }
    const config = require('../config');
    const canStop = msg.from?.id === s.starterId || msg.from?.id === config.adminId;
    if (!canStop) {
      await noticeUser(bot, msg, 'Остановить серию может тот, кто её запустил.');
      return;
    }
    if (s.timer) clearTimeout(s.timer);
    activeSeries.delete(chatId);
    quizCooldown.set(chatId, Date.now());
    await sendSafe(bot, chatId, `Серия остановлена на ${s.index}/${s.total}. Итоги: /leaderboard`,
      { reply_to_message_id: msg.message_id });
    return;
  }

  if (activeSeries.has(chatId)) {
    const s = activeSeries.get(chatId);
    await noticeUser(bot, msg, `Серия уже идёт (${s.index}/${s.total}). Остановить: /quiz stop`);
    return;
  }

  const last = quizCooldown.get(chatId);
  if (last && Date.now() - last < COOLDOWN_MS) {
    const left = Math.ceil((COOLDOWN_MS - (Date.now() - last)) / 1000);
    await noticeUser(bot, msg, `Подожди ${left} сек до следующего вопроса.`);
    return;
  }
  quizCooldown.set(chatId, Date.now());

  // Парсим количество (1-10): отдельное число в начале или конце аргументов.
  // "/quiz 5", "/quiz космос 5", "/quiz 5 космос"
  let count = 1;
  let topic = raw;
  const m = raw.match(/(?:^|\s)(10|[1-9])(?=\s|$)/);
  if (m) {
    count = parseInt(m[1], 10);
    topic = (raw.slice(0, m.index) + ' ' + raw.slice(m.index + m[0].length)).trim();
  }
  if (!topic) {
    const chat = await chatsRepo.getChat(chatId);
    topic = chat?.chat_topic || null;
  }

  if (count <= 1) {
    const ok = await postOneQuiz(bot, chatId, topic, { replyTo: msg.message_id });
    if (!ok) {
      quizCooldown.delete(chatId);
      await sendSafe(bot, chatId, 'Не получилось сочинить вопрос. Попробуй ещё раз.', { reply_to_message_id: msg.message_id });
    }
    return;
  }

  // Серия: первый вопрос сразу, дальше по одному каждые 30 секунд
  activeSeries.set(chatId, {
    total: count,
    index: 0,
    topic,
    asked: [],
    starterId: msg.from?.id || null,
    timer: null,
  });
  await sendSafe(bot, chatId,
    `Серия из ${count} вопросов${topic ? ` на тему «${topic}»` : ''} — по одному каждые 30 сек. Остановить: /quiz stop`,
    { reply_to_message_id: msg.message_id });
  await runSeriesStep(bot, chatId);
}

async function handlePollAnswer(bot, pollAnswer) {
  const pollId = pollAnswer.poll_id;
  const userId = pollAnswer.user?.id;
  // Без @ — иначе каждый показ топа тегает всех участников уведомлениями
  const username = pollAnswer.user?.username
    || pollAnswer.user?.first_name
    || `id${userId}`;
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
    // Срезаем @ у старых записей, чтобы не тегать людей при каждом показе топа
    const name = (r.username || `id${r.user_id}`).replace(/^@/, '');
    lines.push(`${prefix} ${name} — ${r.correct}/${r.total} (${r.pct}%)`);
  });
  await sendSafe(bot, chatId, lines.join('\n'), { reply_to_message_id: msg.message_id });
}

module.exports = { handleQuizCommand, handlePollAnswer, handleLeaderboard };
