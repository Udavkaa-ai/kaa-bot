const claude = require('../providers/claude');
const usersRepo = require('../db/repo/users');
const chatsRepo = require('../db/repo/chats');
const messagesRepo = require('../db/repo/messages');
const eyeballRepo = require('../db/repo/eyeball');
const quizRepo = require('../db/repo/quiz');
const contourRepo = require('../db/repo/contour');

// Топ Эрудита подтягиваем только когда о нём спрашивают — экономим промпт
const QUIZ_TRIGGER = /квиз|эрудит|викторин|самый умный|самая умная|умнее|умнейш|лидерборд|кто лидер|кто в топе/i;
// Топ Контура (география) — по словам «контур», «страна», «граница» и их формам
const CONTOUR_TRIGGER = /контур|стран[аыеуо]|границ|географ|картограф|очертани/i;

async function contourContext(chatId, userId) {
  const [guessTop, borderTop, guessMe, borderMe] = await Promise.all([
    contourRepo.getTop(chatId, 'guess', 10).catch(() => []),
    contourRepo.getTop(chatId, 'border', 10).catch(() => []),
    userId ? contourRepo.getStanding(chatId, userId, 'guess').catch(() => null) : null,
    userId ? contourRepo.getStanding(chatId, userId, 'border').catch(() => null) : null,
  ]);
  return { guessTop, borderTop, guessMe, borderMe };
}
const { resolvePersona } = require('./persona');
const semantic = require('../memory/semantic');
const search = require('../providers/search');
const { buildSystemPrompt } = require('../ai/prompt');

// Сбор всей контекстной информации для ответа
async function gatherContext(msg, userText) {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;
  const userName = msg.from?.first_name || 'Гость';
  const userTag = msg.from?.username ? `@${msg.from.username}` : null;
  const isPrivate = msg.chat.type === 'private';
  const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup';

  const [
    { persona, justAssigned },
    userProfile,
    userGlobalMemory,
    chatProfile,
    chatRecaps,
    semanticMemories,
    history,
    searchContext,
    eyeballTop,
    eyeballMe,
    quizTop,
    quizMe,
    quizAgg,
    contour,
  ] = await Promise.all([
    resolvePersona(userId, chatId, userText),
    usersRepo.getProfile(chatId, userId),
    usersRepo.getGlobalMemory(userId),
    chatsRepo.getChat(chatId),
    messagesRepo.getRecentSummaries(chatId, 7),
    semantic.recall({ chatId, userId, queryText: userText }),
    messagesRepo.getHistory(chatId),
    search.trySearch(userText),
    // Топ и место собеседника в игре "Сечение" (текущий сезон)
    eyeballRepo.topByStreak(chatId, 10, eyeballRepo.CURRENT_SEASON).catch(() => []),
    userId ? eyeballRepo.getUserStats(chatId, userId, eyeballRepo.CURRENT_SEASON).catch(() => null) : null,
    // Топ Эрудита (викторины) — по ключевым словам в сообщении
    QUIZ_TRIGGER.test(userText || '') ? quizRepo.getLeaderboard(chatId, 10).catch(() => []) : null,
    QUIZ_TRIGGER.test(userText || '') && userId ? quizRepo.getUserStanding(chatId, userId).catch(() => null) : null,
    QUIZ_TRIGGER.test(userText || '') ? quizRepo.getAggregates(chatId).catch(() => null) : null,
    // Топ Контура — по ключевым словам в сообщении
    CONTOUR_TRIGGER.test(userText || '') ? contourContext(chatId, userId) : null,
  ]);

  const system = buildSystemPrompt({
    persona,
    userProfile,
    userGlobalMemory,
    userName,
    userTag,
    chatProfile,
    chatRecaps,
    semanticMemories,
    searchContext,
    isPrivate,
    isGroup,
    eyeballTop,
    eyeballMe,
    quizTop,
    quizMe,
    quizAgg,
    contour,
  });

  return { persona, justAssigned, system, history, searchContext, userProfile };
}

function safeHistory(history) {
  return (history || []).map(m => ({
    role: m.role,
    text: m.text || '',
    username: m.role === 'user' ? (m.username || 'юзер') : null,
  }));
}

async function generateReply({ system, history }) {
  return claude.ask({
    system,
    history: safeHistory(history),
    opts: { temperature: 0.85, maxTokens: 1000 },
  });
}

// Стриминговая версия: onProgress получает накопленный текст ответа.
async function generateReplyStream({ system, history }, onProgress) {
  return claude.askStream({
    system,
    history: safeHistory(history),
    opts: { temperature: 0.85, maxTokens: 1000 },
  }, onProgress);
}

module.exports = { gatherContext, generateReply, generateReplyStream };
