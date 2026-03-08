const config = require('./config');
const { getAIResponse } = require('./ai');
const storage = require('./storage');
const { trySearch } = require('./search');

<<<<<<< Updated upstream
// Паттерн триггера — список слов через запятую в BOT_TRIGGER
function isMentioned(text) {
  if (!text) return false;
=======
// Кэш ID бота (заполняется при первом вызове)
let botId = null;

// Паттерн триггера — список слов через запятую в BOT_TRIGGER
function isMentioned(text, botUsername) {
  if (!text) return false;

  // Проверяем @username бота
  if (botUsername && text.toLowerCase().includes(`@${botUsername.toLowerCase()}`)) {
    return true;
  }

>>>>>>> Stashed changes
  const triggers = config.BOT_TRIGGERS;
  return triggers.some(trigger => {
    const escaped = trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(?<![а-яёa-z])${escaped}(?![а-яёa-z])`, 'i');
    return pattern.test(text);
  });
}

async function processMessage(bot, msg) {
  // Получаем ID бота один раз
  if (!botId) {
    const me = await bot.getMe();
    botId = me.id;
    bot._botUsername = me.username;
  }

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text || '';
  const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup';
  const isPrivate = msg.chat.type === 'private';

<<<<<<< Updated upstream
=======
  const chatName = msg.chat.title || 'ЛС';
  const userName = msg.from.first_name || 'Пользователь';
  const userTag = msg.from.username ? `@${msg.from.username}` : `id:${userId}`;

  console.log(`[IN] ${chatName} | ${userName} (${userTag}): "${text.slice(0, 80)}"`);

>>>>>>> Stashed changes
  // Пропускаем ботов
  if (msg.from.is_bot) return;

  // Сохраняем сообщение в историю
  storage.addMessage(chatId, {
    role: 'user',
    name: msg.from.first_name || 'Пользователь',
    userId,
    text,
    ts: Date.now(),
  });

  // В группе отвечаем только если упомянули или ответили на сообщение бота
  if (isGroup) {
<<<<<<< Updated upstream
    const isReply = msg.reply_to_message?.from?.is_bot;
    if (!isMentioned(text) && !isReply) return;
=======
    const isReplyToMe = msg.reply_to_message?.from?.id === botId;
    if (!isMentioned(text, bot._botUsername) && !isReplyToMe) return;
>>>>>>> Stashed changes
  }

  // Команды
  if (text.startsWith('/start')) {
    await bot.sendMessage(chatId, `Я — ${config.BOT_NAME}. Говори со мной, маугли...`);
    return;
  }

  if (text.startsWith('/help')) {
    const modules = [];
    if (config.SEARCH_ENABLED) modules.push('🔍 Веб-поиск');
    if (config.IMAGES_ENABLED) modules.push('🎨 Генерация изображений');
    if (config.QUIZ_ENABLED) modules.push('🎯 Викторины');
    if (config.RPG_ENABLED) modules.push('⚔️ RPG');
    if (config.STATS_ENABLED) modules.push('📊 Статистика');
    if (config.AUTO_REVIVE_ENABLED) modules.push('💬 Авто-оживление');

    const moduleText = modules.length > 0
      ? `\n\nАктивные модули:\n${modules.join('\n')}`
      : '';

    await bot.sendMessage(chatId, `Я — ${config.BOT_NAME}.\nОбращайся ко мне по имени в чате.${moduleText}`);
    return;
  }

  // Получаем профиль пользователя и историю чата
  const userProfile = storage.getProfile(chatId, userId);
  const chatHistory = storage.getHistory(chatId);

<<<<<<< Updated upstream
  // Генерируем ответ
  const response = await getAIResponse({
    text,
    userName: msg.from.first_name || 'Пользователь',
    userProfile,
    chatHistory,
    chatId,
  });

  if (!response) return;

  // Отправляем ответ
  await bot.sendMessage(chatId, response, { reply_to_message_id: msg.message_id });

  // Сохраняем ответ в историю
  storage.addMessage(chatId, {
    role: 'assistant',
    text: response,
    ts: Date.now(),
  });

  // Обновляем профиль пользователя асинхронно
  updateProfileAsync(chatId, userId, msg.from.first_name, text, response);
=======
  // Веб-поиск (если включён и сообщение содержит триггер)
  let searchContext = null;
  if (config.SEARCH_ENABLED) {
    searchContext = await trySearch(text);
    if (searchContext) console.log(`[SEARCH] ${chatName} | Найдены результаты`);
  } else {
    console.log(`[SEARCH] Модуль отключён (SEARCH=${process.env.SEARCH}, TAVILY_KEY=${config.TAVILY_KEY ? 'есть' : 'нет'})`);
  }

  // Генерируем ответ
  const result = await getAIResponse({
    text,
    userName,
    userProfile,
    chatHistory,
    chatId,
    searchContext,
  });

  if (!result?.text) return;

  console.log(`[OUT] ${chatName} | ${result.model} | "${result.text.slice(0, 80)}"`);

  // Отправляем ответ
  await bot.sendMessage(chatId, result.text, { reply_to_message_id: msg.message_id });

  // Сохраняем ответ в историю
  storage.addMessage(chatId, {
    role: 'assistant',
    text: result.text,
    ts: Date.now(),
  });

  // Обновляем профиль пользователя асинхронно
  updateProfileAsync(chatId, userId, userName, text, result.text);
>>>>>>> Stashed changes
}

// Обновляем профиль пользователя в фоне
async function updateProfileAsync(chatId, userId, userName, userText, botResponse) {
  try {
    const { getProfileUpdate } = require('./ai');
    const update = await getProfileUpdate(userName, userText, botResponse);
    if (update) {
      storage.updateProfile(chatId, userId, update);
    }
  } catch (err) {
    // Не критично, просто логируем
    console.error('Profile update error:', err.message);
  }
}

module.exports = { processMessage };
