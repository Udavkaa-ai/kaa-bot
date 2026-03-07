const config = require('./config');
const {
  getAIResponse, analyzeUserImmediate, analyzeBatch,
  determineReaction, generateProfileDescription, generateFlavorText, getErrorReply
} = require('./ai');
const storage = require('./storage');

// Буферы для batch-анализа
const analysisBuffers = {};
const chatAnalysisBuffers = {};
const BUFFER_SIZE = 20;
const CHAT_BUFFER_SIZE = 50;

function isMentioned(text) {
  if (!text) return false;
  const trigger = config.BOT_TRIGGER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?<![а-яёa-z])${trigger}(?![а-яёa-z])`, 'i');
  return pattern.test(text);
}

// Жёсткая проверка threadId
function getThreadId(msg) {
  let threadId = msg.is_topic_message
    ? msg.message_thread_id
    : (msg.message_thread_id || (msg.reply_to_message ? msg.reply_to_message.message_thread_id : null));
  return typeof threadId === 'number' ? threadId : null;
}

// Контроллер "печатает" с защитой от зависания
function createTypingController(bot, chatId, threadId) {
  let typingTimer = null;
  let safetyTimeout = null;

  const sendAction = () => {
    const opts = threadId ? { message_thread_id: threadId } : undefined;
    bot.sendChatAction(chatId, 'typing', opts).catch(() => {});
  };

  const start = () => {
    if (typingTimer) return;
    sendAction();
    typingTimer = setInterval(sendAction, 4000);
    safetyTimeout = setTimeout(() => stop(), 20000);
  };

  const stop = () => {
    if (typingTimer) { clearInterval(typingTimer); typingTimer = null; }
    if (safetyTimeout) { clearTimeout(safetyTimeout); safetyTimeout = null; }
  };

  return { start, stop };
}

// Отправка с fallback на plain text если Markdown сломался
async function safeSend(bot, chatId, text, opts = {}) {
  try {
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', disable_web_page_preview: true, ...opts });
  } catch {
    try {
      await bot.sendMessage(chatId, text, { disable_web_page_preview: true, ...opts });
    } catch (e) {
      console.error('[SEND ERROR]', e.message);
    }
  }
}

async function processMessage(bot, msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup';
  const threadId = getThreadId(msg);
  let text = msg.text || msg.caption || '';

  if (msg.from.is_bot) return;

  // === ЗАЩИТА ЛИЧНЫХ СООБЩЕНИЙ ===
  // В личке отвечаем только админу. Всем остальным — только на /start, остальное игнорируем.
  if (msg.chat.type === 'private' && userId !== config.ADMIN_ID) {
    const command = (msg.text || '').trim().split(/[\s@]+/)[0].toLowerCase();
    if (command === '/start') {
      await bot.sendMessage(chatId,
        `В личке я не общаюсь — работаю только в групповых чатах.\n\nЕсли хочешь добавить меня к себе — обратись к владельцу.`
      );
    }
    return;
  }

  const chatTitle = msg.chat.title || msg.chat.username || msg.chat.first_name || 'Unknown';
  const cleanText = text.toLowerCase();

  const isReplyToBot = msg.reply_to_message?.from?.is_bot &&
    String(msg.reply_to_message?.from?.id) === String(config.BOT_ID);
  const hasTriggerWord = isMentioned(text);
  const isDirectlyCalled = hasTriggerWord || isReplyToBot;

  // Уведомление о новом чате
  if (!storage.hasChat(chatId) && config.ADMIN_ID && chatId !== config.ADMIN_ID) {
    const inviter = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;
    bot.sendMessage(
      config.ADMIN_ID,
      `🔔 *Новый чат!*\n📂 ${chatTitle}\n🆔 \`${chatId}\`\n👤 ${inviter}\n💬 ${text.slice(0, 100)}`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
  }

  storage.updateChatName(chatId, chatTitle);

  // Сохраняем сообщение
  const senderName = msg.from.username
    ? `${msg.from.first_name} (@${msg.from.username})`
    : msg.from.first_name || 'Пользователь';

  storage.addMessage(chatId, { role: 'user', name: senderName, userId, text, ts: Date.now() });
  storage.trackUser(chatId, msg.from);

  if (isGroup) storage.updateLastMessageTime(chatId);

  // === BATCH-БУФЕРЫ ===
  if (text && !text.startsWith('/')) {
    if (!analysisBuffers[chatId]) analysisBuffers[chatId] = [];
    analysisBuffers[chatId].push({ userId, name: senderName, text });
    if (analysisBuffers[chatId].length >= BUFFER_SIZE) processBatchAsync(chatId);

    if (!chatAnalysisBuffers[chatId]) chatAnalysisBuffers[chatId] = [];
    chatAnalysisBuffers[chatId].push({ name: senderName, text });
    if (chatAnalysisBuffers[chatId].length >= CHAT_BUFFER_SIZE) processChatBatchAsync(bot, chatId);
  }

  // В группе отвечаем только если упомянули или ответили
  if (isGroup && !isDirectlyCalled) {
    // Случайная реакция 1.5%
    if (text.length > 10 && Math.random() < 0.015 && !storage.isTopicMuted(chatId, threadId)) {
      const history = storage.getHistory(chatId);
      const historyBlock = history.slice(-15).map(m => `${m.name || m.role}: ${m.text}`).join('\n');
      determineReaction(historyBlock + `\nСообщение для реакции: ${text}`).then(async emoji => {
        if (emoji) {
          try { await bot.setMessageReaction(chatId, msg.message_id, { reaction: [{ type: 'emoji', emoji }] }); } catch {}
        }
      });
    }
    return;
  }

  if (storage.isTopicMuted(chatId, threadId)) return;

  // === КОМАНДЫ ===
  const command = text.trim().split(/[\s@]+/)[0].toLowerCase();
  if (command === '/start') {
    await safeSend(bot, chatId, `Я — ${config.BOT_NAME}. Говори со мной, маугли...`);
    return;
  }

  if (command === '/help') {
    const modules = [];
    if (config.SEARCH_ENABLED) modules.push('🔍 Веб-поиск');
    if (config.IMAGES_ENABLED) modules.push('🎨 Генерация изображений');
    if (config.QUIZ_ENABLED) modules.push('🎯 Викторины');
    if (config.RPG_ENABLED) modules.push('⚔️ RPG');
    if (config.STATS_ENABLED) modules.push('📊 Статистика');
    if (config.AUTO_REVIVE_ENABLED) modules.push('💬 Авто-оживление');
    const moduleText = modules.length ? `\n\nАктивные модули:\n${modules.join('\n')}` : '';
    await safeSend(bot, chatId, `Я — ${config.BOT_NAME}.\nОбращайся ко мне по имени в чате.${moduleText}`);
    return;
  }

  if (command === '/mute') {
    const nowMuted = storage.toggleMute(chatId, threadId);
    await safeSend(bot, chatId, nowMuted ? '🐍 Хорошо, замолкаю.' : '🐍 Я снова здесь.');
    return;
  }

  if (command === '/reset') {
    analysisBuffers[chatId] = [];
    chatAnalysisBuffers[chatId] = [];
    await safeSend(bot, chatId, '🐍 Забыл всё. Начнём сначала.');
    return;
  }

  // === ФИЧИ ПО ТРИГГЕРУ ===
  if (hasTriggerWord) {
    // Auto-revive команды
    if (cleanText.match(/(?:не скучай|болтай|не молчи)/)) {
      if (!isGroup) { await safeSend(bot, chatId, 'Это работает только в групповых чатах.', { reply_to_message_id: msg.message_id }); return; }
      storage.setAutoRevive(chatId, true);
      storage.updateLastMessageTime(chatId);
      await safeSend(bot, chatId, 'Хорошо. Если тут станет тихо — напомню о себе.', { reply_to_message_id: msg.message_id });
      return;
    }
    if (cleanText.match(/(?:не болтай|замолчи|хватит болтать)/)) {
      storage.setAutoRevive(chatId, false);
      await safeSend(bot, chatId, 'Хорошо. Буду молчать.', { reply_to_message_id: msg.message_id });
      return;
    }

    // Монетка
    if (cleanText.match(/(монетк|кинь монет|подбрось)/)) {
      const typing = createTypingController(bot, chatId, threadId);
      typing.start();
      const result = Math.random() > 0.5 ? 'ОРЁЛ' : 'РЕШКА';
      const flavor = await generateFlavorText('подбросить монетку', result);
      typing.stop();
      await safeSend(bot, chatId, flavor, { reply_to_message_id: msg.message_id });
      return;
    }

    // Рандомное число
    const rangeMatch = cleanText.match(/(\d+)-(\d+)/);
    if ((cleanText.includes('число') || cleanText.includes('рандом')) && rangeMatch) {
      const typing = createTypingController(bot, chatId, threadId);
      typing.start();
      const min = parseInt(rangeMatch[1]), max = parseInt(rangeMatch[2]);
      const rand = Math.floor(Math.random() * (max - min + 1)) + min;
      const flavor = await generateFlavorText(`выбрать число ${min}-${max}`, String(rand));
      typing.stop();
      await safeSend(bot, chatId, flavor, { reply_to_message_id: msg.message_id });
      return;
    }

    // Кто из нас
    const isWhoGame = cleanText.match(/(?:кто|кого)\s+(?:из нас|тут|в чате|сегодня)/);
    if (isWhoGame) {
      const typing = createTypingController(bot, chatId, threadId);
      typing.start();
      const randomUser = storage.getRandomUser(chatId);
      if (!randomUser) { typing.stop(); await safeSend(bot, chatId, 'Никого не знаю пока.'); return; }
      const flavor = await generateFlavorText(`выбрать случайного человека на вопрос "${text}"`, randomUser);
      typing.stop();
      await safeSend(bot, chatId, flavor, { reply_to_message_id: msg.message_id });
      return;
    }

    // Расскажи про @юзера
    const aboutMatch = cleanText.match(/(?:расскажи про|кто такой|кто такая|мнение о)\s+(.+)/);
    if (aboutMatch) {
      const targetName = aboutMatch[1].replace('?', '').trim();
      const targetProfile = storage.findProfileByQuery(chatId, targetName);
      if (targetProfile) {
        const typing = createTypingController(bot, chatId, threadId);
        typing.start();
        const description = await generateProfileDescription(targetProfile, targetName);
        typing.stop();
        await safeSend(bot, chatId, description, { reply_to_message_id: msg.message_id });
        return;
      }
    }
  }

  // === ОСНОВНОЙ ОТВЕТ ===
  const userProfile = storage.getProfile(chatId, userId);
  const chatHistory = storage.getHistory(chatId);
  const chatProfile = storage.getChatProfile(chatId);

  const typing = createTypingController(bot, chatId, threadId);
  typing.start();

  let response;
  try {
    response = await getAIResponse({ text, userName: msg.from.first_name || 'Пользователь', userProfile, chatHistory, chatId, chatProfile });
    if (!response) response = getErrorReply('503 overloaded');
  } catch (err) {
    console.error('AI error:', err.message);
    if (config.ADMIN_ID) {
      bot.sendMessage(config.ADMIN_ID, `🔥 Ошибка AI\nЧат: ${chatTitle}\n\`${err.message}\``, { parse_mode: 'Markdown' }).catch(() => {});
    }
    response = getErrorReply(err.message);
  }

  typing.stop();

  await safeSend(bot, chatId, response, { reply_to_message_id: msg.message_id });

  storage.addMessage(chatId, { role: 'assistant', name: config.BOT_NAME, text: response, ts: Date.now() });

  // Анализ репутации после ответа (в фоне)
  const recentHistory = storage.getHistory(chatId).slice(-5).map(m => `${m.name || m.role}: ${m.text}`).join('\n');
  analyzeUserImmediate(recentHistory, userProfile).then(updated => {
    if (updated) {
      if (updated.relationship !== undefined) {
        console.log(`[REPUTATION] ${senderName}: ${updated.relationship}/100`);
      }
      storage.bulkUpdateProfiles(chatId, { [userId]: updated });
    }
  }).catch(err => console.error('[REPUTATION ERROR]', err.message));
}

// Batch-анализ профилей пользователей
async function processBatchAsync(chatId) {
  const buffer = analysisBuffers[chatId];
  if (!buffer?.length) return;
  analysisBuffers[chatId] = [];

  try {
    const userIds = [...new Set(buffer.map(m => m.userId))];
    const currentProfiles = {};
    userIds.forEach(uid => { currentProfiles[uid] = storage.getProfile(chatId, uid); });

    const updates = await analyzeBatch(buffer, currentProfiles);
    if (updates && Object.keys(updates).length > 0) {
      storage.bulkUpdateProfiles(chatId, updates);
      console.log(`[BATCH] Обновлено профилей: ${Object.keys(updates).length}`);
    }
  } catch (err) {
    console.error('[BATCH ERROR]', err.message);
  }
}

// Batch-анализ профиля чата
async function processChatBatchAsync(bot, chatId) {
  const buffer = chatAnalysisBuffers[chatId];
  if (!buffer?.length) return;
  chatAnalysisBuffers[chatId] = [];

  try {
    const { analyzeChatProfile } = require('./ai');
    const currentProfile = storage.getChatProfile(chatId);
    const updates = await analyzeChatProfile(buffer, currentProfile);
    if (updates) {
      storage.updateChatProfile(chatId, updates);
      console.log(`[CHAT PROFILE] Обновлён для ${chatId}: "${updates.topic}"`);
    }
  } catch (err) {
    console.error('[CHAT BATCH ERROR]', err.message);
  }
}

module.exports = { processMessage };
