const config = require('./config');

// Эмодзи, доступные для реакций в Telegram
const REACTION_EMOJIS = [
  '👍', '👎', '❤️', '🔥', '🥰', '👏', '😁', '🤔', '🤯', '😱',
  '🤬', '😢', '🎉', '🤩', '🤮', '💩', '🙏', '👌', '🕊', '🤡',
  '🥱', '🥴', '😍', '🐳', '❤️‍🔥', '🌚', '💯', '🤣', '⚡', '🍌',
  '🏆', '💔', '🤨', '😐', '🍓', '🍾', '💋', '🖕', '😈', '😴',
  '😭', '🤓', '👻', '👨‍💻', '👀', '🎃', '🙈', '😇', '😨', '🤝',
  '✍', '🤗', '🫡', '🎅', '🎄', '☃', '💅', '🤪', '🗿', '🆒',
  '💘', '🙉', '🦄', '😘', '💊', '🙊', '😎', '👾', '🤷‍♂', '🤷',
  '🤷‍♀', '😡',
];

// Подмножество для случайных реакций (нейтральные/позитивные)
const RANDOM_REACTION_POOL = [
  '👍', '🔥', '👏', '😁', '🤔', '💯', '🤣', '⚡', '👀', '🤗',
  '😎', '🗿', '🆒', '❤️', '🎉',
];

// Кэш стикеров: setName -> fileId[]
const stickerCache = new Map();

/**
 * Парсит теги действий из ответа AI.
 * [REACT:emoji] — поставить реакцию
 * [STICKER] — отправить стикер
 */
function parseActions(text) {
  const actions = { reaction: null, sticker: false };

  const reactMatch = text.match(/\[REACT:([^\]]+)\]/);
  if (reactMatch) {
    const emoji = reactMatch[1].trim();
    if (REACTION_EMOJIS.includes(emoji)) {
      actions.reaction = emoji;
    }
  }

  if (/\[STICKER\]/.test(text)) {
    actions.sticker = true;
  }

  return actions;
}

/**
 * Удаляет теги действий из текста.
 */
function cleanText(text) {
  return text
    .replace(/\[REACT:[^\]]+\]/g, '')
    .replace(/\[STICKER\]/g, '')
    .trim();
}

/**
 * Ставит эмодзи-реакцию на сообщение через Telegram API.
 */
async function setReaction(bot, chatId, messageId, emoji) {
  try {
    const url = `https://api.telegram.org/bot${config.BOT_TOKEN}/setMessageReaction`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        reaction: [{ type: 'emoji', emoji }],
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      console.warn(`[REACT] Ошибка: ${err.description}`);
    }
  } catch (err) {
    console.warn(`[REACT] ${err.message}`);
  }
}

/**
 * Загружает и кэширует стикерпак.
 */
async function loadStickerSet(bot, setName) {
  if (stickerCache.has(setName)) return stickerCache.get(setName);

  try {
    const set = await bot.getStickerSet(setName);
    const stickers = set.stickers.map(s => s.file_id);
    stickerCache.set(setName, stickers);
    console.log(`[STICKER] Загружен набор "${setName}" (${stickers.length} шт.)`);
    return stickers;
  } catch (err) {
    console.warn(`[STICKER] Не удалось загрузить набор "${setName}": ${err.message}`);
    return [];
  }
}

/**
 * Отправляет случайный стикер из настроенных наборов.
 */
async function sendRandomSticker(bot, chatId, replyTo) {
  const setNames = config.STICKER_SETS;
  if (!setNames.length) return;

  // Выбираем случайный набор
  const setName = setNames[Math.floor(Math.random() * setNames.length)];
  const stickers = await loadStickerSet(bot, setName);

  if (stickers.length === 0) return;

  const stickerId = stickers[Math.floor(Math.random() * stickers.length)];

  try {
    await bot.sendSticker(chatId, stickerId, { reply_to_message_id: replyTo });
  } catch (err) {
    console.warn(`[STICKER] ${err.message}`);
  }
}

/**
 * Случайная реакция с заданной вероятностью (для сообщений без ответа бота).
 */
async function randomReaction(bot, chatId, messageId) {
  if (Math.random() > config.REACTION_CHANCE) return;

  const emoji = RANDOM_REACTION_POOL[Math.floor(Math.random() * RANDOM_REACTION_POOL.length)];
  await setReaction(bot, chatId, messageId, emoji);
  console.log(`[REACT] Случайная реакция ${emoji} в чате ${chatId}`);
}

/**
 * Выполняет все действия из ответа AI.
 */
async function executeActions(bot, chatId, messageId, actions) {
  const promises = [];

  if (actions.reaction) {
    promises.push(setReaction(bot, chatId, messageId, actions.reaction));
  }

  if (actions.sticker) {
    promises.push(sendRandomSticker(bot, chatId, messageId));
  }

  await Promise.allSettled(promises);
}

module.exports = {
  parseActions,
  cleanText,
  executeActions,
  randomReaction,
  REACTION_EMOJIS,
};
