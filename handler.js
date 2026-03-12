const config = require('./config');
const { getAIResponse, describeImage, translateImagePrompt, analyzeChatContext, generateRecap } = require('./ai');
const storage = require('./storage');
const { trySearch } = require('./search');
const { parseActions, cleanText, executeActions, randomReaction } = require('./reactions');
const { handleGameMessage } = require('./games');
const { generateImage } = require('./imagegen');

// Кэш ID бота (заполняется при первом вызове)
let botId = null;

// Очередь сообщений по чатам — предотвращает race condition
const chatQueues = new Map();

function enqueue(chatId, fn) {
  const prev = chatQueues.get(chatId) || Promise.resolve();
  const next = prev.then(fn).catch(err => {
    console.error(`[ERROR] chat=${chatId}: ${err.message}`);
  });
  chatQueues.set(chatId, next);
}

// Паттерн триггера — список слов через запятую в BOT_TRIGGER
function isMentioned(text, botUsername) {
  if (!text) return false;

  // Проверяем @username бота
  if (botUsername && text.toLowerCase().includes(`@${botUsername.toLowerCase()}`)) {
    return true;
  }

  const triggers = config.BOT_TRIGGERS;
  return triggers.some(trigger => {
    const escaped = trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(?<![а-яёa-z])${escaped}(?![а-яёa-z])`, 'i');
    return pattern.test(text);
  });
}

// Счётчик сообщений для периодического анализа контекста чата
const contextUpdateCounters = new Map();
const CONTEXT_UPDATE_EVERY = 20; // анализировать контекст каждые N сообщений

// Счётчик сообщений для периодического обновления памяти пользователя
const memoryUpdateCounters = new Map();
const MEMORY_UPDATE_EVERY = 5; // обновлять память каждые N сообщений

async function processMessage(bot, msg) {
  // Получаем ID бота один раз
  if (!botId) {
    const me = await bot.getMe();
    botId = me.id;
    bot._botUsername = me.username;
  }

  const chatId = msg.chat.id;

  // Ставим обработку в очередь по chatId
  enqueue(chatId, () => _handleMessage(bot, msg));
}

async function _handleMessage(bot, msg) {
  const chatId = msg.chat.id;
  const text = msg.text || msg.caption || '';
  const hasPhoto = msg.photo && msg.photo.length > 0;
  const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup';
  const isPrivate = msg.chat.type === 'private';

  // Сообщения от канала в чате: msg.from отсутствует, есть msg.sender_chat
  const isChannel = !msg.from && !!msg.sender_chat;
  const userId = msg.from?.id || msg.sender_chat?.id || 0;
  const chatName = msg.chat.title || 'ЛС';
  const userName = msg.from?.first_name || msg.sender_chat?.title || 'Пользователь';
  const userTag = msg.from?.username
    ? `@${msg.from.username}`
    : msg.sender_chat?.username
      ? `@${msg.sender_chat.username}`
      : `id:${userId}`;

  console.log(`[IN] ${chatName} | ${userName} (${userTag}): "${text.slice(0, 80)}"`);

  // Сообщения от других ботов: читаем для контекста, но НЕ отвечаем
  const isFromBot = msg.from?.is_bot && !msg.sender_chat;
  if (isFromBot) {
    // Сохраняем в историю для понимания контекста чата
    const botMessageRecord = {
      role: 'user',
      name: `[бот] ${userName}`,
      userId,
      text,
      ts: Date.now(),
    };
    storage.addMessage(chatId, botMessageRecord);

    if (text && text.length > 0) {
      storage.addToDailyBuffer(chatId, botMessageRecord);
    }

    console.log(`[BOT-MSG] ${chatName} | ${userName}: сохранено для контекста`);
    return;
  }

  // Трекинг пользователя глобально (имя, юзернейм, чаты)
  if (userId && userId !== 0) {
    storage.trackUserGlobal(
      userId,
      userName,
      msg.from?.username ? `@${msg.from.username}` : null,
      chatId,
      chatName
    );
  }

  // Игры — обрабатываем ДО сохранения в историю (буквы и PM не должны попадать в историю)
  if (config.GAMES_ENABLED) {
    const handled = await handleGameMessage(bot, msg);
    if (handled) return;
  }

  // Сохраняем сообщение в историю
  const messageRecord = {
    role: 'user',
    name: userName,
    userId,
    text,
    ts: Date.now(),
  };
  storage.addMessage(chatId, messageRecord);

  // Добавляем в ежедневный буфер (для анализа контекста и архивации)
  if (text && text.length > 0) {
    storage.addToDailyBuffer(chatId, messageRecord);
  }

  // В группе: анализируем ВСЕ сообщения для контекста, но отвечаем только если упомянули
  if (isGroup) {
    const isReplyToMe = msg.reply_to_message?.from?.id === botId;
    const photoReplyToMe = hasPhoto && isReplyToMe;
    const mentioned = isMentioned(text, bot._botUsername) || isReplyToMe || photoReplyToMe;

    // Периодический анализ контекста чата (для ВСЕХ сообщений, включая те, что не к боту)
    if (text && text.length > 3) {
      updateChatContextAsync(chatId);
    }

    if (!mentioned) {
      // Случайная реакция на сообщения, где бот не отвечает
      if (config.REACTIONS_ENABLED) {
        randomReaction(bot, chatId, msg.message_id);
      }
      return;
    }
  }

  // Команды
  if (text.startsWith('/start')) {
    await bot.sendMessage(chatId, `Я — ${config.BOT_NAME}. Говори со мной, маугли...`);
    return;
  }

  if (text.startsWith('/help')) {
    const modules = [];
    if (config.VISION_ENABLED) modules.push('👁 Распознавание картинок');
    if (config.SEARCH_ENABLED) modules.push('🔍 Веб-поиск');
    if (config.IMAGES_ENABLED) modules.push('🎨 Генерация изображений');
    if (config.QUIZ_ENABLED) modules.push('🎯 Викторины');
    if (config.RPG_ENABLED) modules.push('⚔️ RPG');
    if (config.STATS_ENABLED) modules.push('📊 Статистика');
    if (config.GAMES_ENABLED) modules.push('🎮 Игры (/виселица, /гамруль)');
    if (config.AUTO_REVIVE_ENABLED) modules.push('💬 Авто-оживление');

    const moduleText = modules.length > 0
      ? `\n\nАктивные модули:\n${modules.join('\n')}`
      : '';

    await bot.sendMessage(chatId, `Я — ${config.BOT_NAME}.\nОбращайся ко мне по имени в чате.${moduleText}`);
    return;
  }

  // Пересказ чата — "что в чате", "что пропустил", "что обсуждали" и т.п.
  const recapPattern = /(?:что\s+(?:в\s+чате|(?:я\s+)?пропустил[аи]?|обсуждал[иь]?|было|нового|происходи(?:т|ло))|(?:пересказ|краткое\s+содержание|рекап|recap|summary)\s*(?:чата)?|введи\s+в\s+курс|(?:catch|fill)\s+me\s+up)/i;

  if (recapPattern.test(text)) {
    try {
      // Парсим количество часов из сообщения (по умолчанию 6)
      const hoursMatch = text.match(/(\d+)\s*(?:час|ч\b|hour|hr)/i);
      const hours = hoursMatch ? Math.min(parseInt(hoursMatch[1]), 48) : 6;

      const buffer = storage.getDailyBuffer(chatId);
      const topics = storage.getChatTopics(chatId);
      const recap = await generateRecap(buffer, hours, topics);

      if (recap) {
        console.log(`[RECAP] ${chatName} | ${userName} запросил пересказ за ${hours}ч`);
        await bot.sendMessage(chatId, recap, { reply_to_message_id: msg.message_id });
        storage.addMessage(chatId, { role: 'assistant', text: recap, ts: Date.now() });
      } else {
        await bot.sendMessage(chatId, 'В джунглях было тихо... Нечего пересказывать.', { reply_to_message_id: msg.message_id });
      }
    } catch (err) {
      console.error(`[RECAP ERROR] ${chatName}: ${err.message}`);
      await bot.sendMessage(chatId, 'Не удалось вспомнить... Попробуй позже.', { reply_to_message_id: msg.message_id });
    }
    return;
  }

  // Получаем профиль пользователя, глобальную память и историю чата
  const userProfile = storage.getProfile(chatId, userId);
  const userMemory = storage.getUserMemory(userId);
  const userMemoryFull = storage.getUserMemoryFull(userId);
  const chatHistory = storage.getHistory(chatId);

  // Память чата (обсуждаемые темы и архив)
  const chatTopics = storage.getChatTopics(chatId);
  const chatArchive = storage.getChatArchive(chatId, 3);

  // Веб-поиск (если включён и сообщение содержит триггер)
  let searchContext = null;
  if (config.SEARCH_ENABLED) {
    searchContext = await trySearch(text);
    if (searchContext) {
      console.log(`[SEARCH] ${chatName} | Найдены результаты для "${text.slice(0, 50)}"`);
    } else {
      console.log(`[SEARCH] ${chatName} | Нет результатов или нет триггера для "${text.slice(0, 50)}"`);
    }
  }

  // Распознавание изображений (Vision)
  if (hasPhoto && config.VISION_ENABLED) {
    const isReplyToMe = msg.reply_to_message?.from?.id === botId;
    const mentioned = isMentioned(text, bot._botUsername);
    const shouldDescribe = isPrivate || isReplyToMe || mentioned || text.length > 0;

    if (shouldDescribe) {
      try {
        const fileId = msg.photo[msg.photo.length - 1].file_id;
        const fileLink = await bot.getFileLink(fileId);
        const imgRes = await fetch(fileLink);
        const buffer = Buffer.from(await imgRes.arrayBuffer());
        const base64 = buffer.toString('base64');

        console.log(`[VISION] ${chatName} | ${userName}: картинка ${Math.round(buffer.length / 1024)}KB`);

        const result = await describeImage(base64, text, userName);
        if (!result?.text) return;

        let responseText = result.text;
        let actions = { reaction: null, sticker: false };

        if (config.REACTIONS_ENABLED) {
          actions = parseActions(responseText);
          responseText = cleanText(responseText);
        }

        if (!responseText) return;

        console.log(`[OUT] ${chatName} | ${result.model} +vision | "${responseText.slice(0, 80)}"`);

        const sendPromises = [
          bot.sendMessage(chatId, responseText, { reply_to_message_id: msg.message_id }),
        ];
        if (config.REACTIONS_ENABLED && (actions.reaction || actions.sticker)) {
          sendPromises.push(executeActions(bot, chatId, msg.message_id, actions));
        }
        await Promise.allSettled(sendPromises);

        storage.addMessage(chatId, { role: 'assistant', text: responseText, ts: Date.now() });
      } catch (err) {
        console.error(`[VISION ERROR] ${chatName}: ${err.message}`);
      }
      return;
    }
    return;
  }

  // Генерируем ответ
  let result;
  try {
    result = await getAIResponse({
      text,
      userName,
      userProfile,
      userMemory,
      userMemoryFull,
      chatHistory,
      chatId,
      searchContext,
      chatTopics,
      chatArchive,
    });
  } catch (err) {
    console.error(`[AI ERROR] ${chatName}: ${err.message}`);
    await bot.sendMessage(chatId, 'Все нейронки заняты, попробуй позже...', { reply_to_message_id: msg.message_id });
    return;
  }

  if (!result?.text) return;

  // Парсим действия (реакции, стикеры) из ответа AI
  let responseText = result.text;
  let actions = { reaction: null, sticker: false };

  if (config.REACTIONS_ENABLED) {
    actions = parseActions(responseText);
    responseText = cleanText(responseText);

    // Fallback: если пользователь просил стикер, а AI не добавил тег
    if (!actions.sticker && config.STICKER_SETS.length > 0) {
      const lowerText = text.toLowerCase();
      if (/стикер|наклейк|sticker/i.test(lowerText)) {
        actions.sticker = true;
      }
    }
  }

  // Парсим тег генерации картинки [IMAGE:prompt]
  let imagePrompt = null;
  if (config.IMAGES_ENABLED) {
    const imageMatch = responseText.match(/\[IMAGE:(.+?)\]/i);
    if (imageMatch) {
      imagePrompt = imageMatch[1].trim();
      responseText = responseText.replace(/\[IMAGE:.+?\]/gi, '').trim();
    }
  }

  if (!responseText) return;

  const hasImage = !!imagePrompt;
  console.log(`[OUT] ${chatName} | ${result.model}${searchContext ? ' +search' : ''}${hasImage ? ' +image' : ''}${actions.reaction ? ` +react:${actions.reaction}` : ''}${actions.sticker ? ' +sticker' : ''} | "${responseText.slice(0, 80)}"`);

  // Отправляем ответ и выполняем действия параллельно
  const sendPromises = [
    bot.sendMessage(chatId, responseText, { reply_to_message_id: msg.message_id }),
  ];

  if (config.REACTIONS_ENABLED && (actions.reaction || actions.sticker)) {
    sendPromises.push(executeActions(bot, chatId, msg.message_id, actions));
  }

  await Promise.allSettled(sendPromises);

  // Генерация картинки (после текстового ответа, чтобы не задерживать)
  if (imagePrompt) {
    try {
      const translatedPrompt = await translateImagePrompt(imagePrompt);
      console.log(`[IMAGEGEN] ${chatName} | prompt: "${translatedPrompt.slice(0, 80)}"`);
      const imageBuffer = await generateImage(translatedPrompt);
      await bot.sendPhoto(chatId, imageBuffer, { reply_to_message_id: msg.message_id });
      console.log(`[IMAGEGEN] ${chatName} | OK, ${Math.round(imageBuffer.length / 1024)}KB`);
    } catch (err) {
      console.error(`[IMAGEGEN ERROR] ${chatName}: ${err.message}`);
      await bot.sendMessage(chatId, 'Не удалось нарисовать... Джунгли иногда капризны.', { reply_to_message_id: msg.message_id });
    }
  }

  // Сохраняем ответ в историю (без тегов действий)
  storage.addMessage(chatId, {
    role: 'assistant',
    text: responseText,
    ts: Date.now(),
  });

  // Обновляем профиль пользователя и глобальную память асинхронно
  updateProfileAsync(chatId, userId, userName, text, result.text);
}

// Обновляем профиль пользователя в фоне
async function updateProfileAsync(chatId, userId, userName, userText, botResponse) {
  try {
    const { getProfileUpdate, updateUserMemory } = require('./ai');
    const update = await getProfileUpdate(userName, userText, botResponse);
    if (update) {
      storage.updateProfile(chatId, userId, update);
    }

    // Обновляем глобальную память каждые N сообщений (чтобы не тратить лимиты на каждое)
    const uid = String(userId);
    const count = (memoryUpdateCounters.get(uid) || 0) + 1;
    memoryUpdateCounters.set(uid, count);

    if (count >= MEMORY_UPDATE_EVERY) {
      memoryUpdateCounters.set(uid, 0);
      const currentMemory = storage.getUserMemory(userId);
      // Собираем последние сообщения пользователя из текущего чата
      const history = storage.getHistory(chatId);
      const recentUserMsgs = history
        .filter(m => m.role === 'user' && String(m.userId) === uid)
        .slice(-10)
        .map(m => `${m.name || userName}: ${m.text}`)
        .join('\n');

      if (recentUserMsgs) {
        const newMemory = await updateUserMemory(userName, currentMemory, recentUserMsgs);
        if (newMemory) {
          storage.setUserMemory(userId, newMemory);
          console.log(`[MEMORY] Updated global memory for ${userName} (${uid})`);
        }
      }
    }
  } catch (err) {
    // Не критично, просто логируем
    console.error('Profile update error:', err.message);
  }
}

// Периодический анализ контекста чата (вызывается для КАЖДОГО сообщения)
async function updateChatContextAsync(chatId) {
  try {
    const cid = String(chatId);
    const count = (contextUpdateCounters.get(cid) || 0) + 1;
    contextUpdateCounters.set(cid, count);

    if (count < CONTEXT_UPDATE_EVERY) return;
    contextUpdateCounters.set(cid, 0);

    // Берём последние сообщения из дневного буфера
    const buffer = storage.getDailyBuffer(chatId);
    const recentMessages = buffer.slice(-30);
    if (recentMessages.length < 5) return;

    const currentTopics = storage.getChatTopics(chatId);
    const newTopics = await analyzeChatContext(recentMessages, currentTopics);

    if (newTopics) {
      storage.updateChatTopics(chatId, newTopics);
      console.log(`[CONTEXT] Updated chat topics for ${cid}`);
    }
  } catch (err) {
    console.error('[CONTEXT] Error updating chat context:', err.message);
  }
}

module.exports = { processMessage };
