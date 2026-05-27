const claude = require('../providers/claude');
const usersRepo = require('../db/repo/users');
const chatsRepo = require('../db/repo/chats');
const messagesRepo = require('../db/repo/messages');
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
  ] = await Promise.all([
    resolvePersona(userId, chatId, userText),
    usersRepo.getProfile(chatId, userId),
    usersRepo.getGlobalMemory(userId),
    chatsRepo.getChat(chatId),
    messagesRepo.getRecentSummaries(chatId, 7),
    semantic.recall({ chatId, userId, queryText: userText }),
    messagesRepo.getHistory(chatId),
    search.trySearch(userText),
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
  });

  return { persona, justAssigned, system, history, searchContext, userProfile };
}

async function generateReply({ system, history }) {
  const safeHistory = (history || []).map(m => ({
    role: m.role,
    text: m.text || '',
    username: m.role === 'user' ? (m.username || 'юзер') : null,
  }));

  return claude.ask({
    system,
    history: safeHistory,
    opts: { temperature: 0.85, maxTokens: 1000 },
  });
}

module.exports = { gatherContext, generateReply };
