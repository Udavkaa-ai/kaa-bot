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

// Кэш стикеров: setName -> { fileId, emoji }[]
const stickerCache = new Map();

/**
 * Парсит теги действий из ответа AI.
 * [REACT:emoji] — поставить реакцию
 * [STICKER:emoji] или [STICKER] — отправить стикер (с подбором по эмодзи)
 */
function parseActions(text) {
  const actions = { reaction: null, sticker: null };

  const reactMatch = text.match(/\[REACT:([^\]]+)\]/);
  if (reactMatch) {
    const emoji = reactMatch[1].trim();
    if (REACTION_EMOJIS.includes(emoji)) {
      actions.reaction = emoji;
    }
  }

  // [STICKER:emoji] или просто [STICKER]
  const stickerMatch = text.match(/\[STICKER(?::([^\]]+))?\]/);
  if (stickerMatch) {
    actions.sticker = stickerMatch[1]?.trim() || true;
  }

  return actions;
}

/**
 * Удаляет теги действий из текста.
 */
function cleanText(text) {
  return text
    .replace(/\[REACT:[^\]]+\]/g, '')
    .replace(/\[STICKER(?::[^\]]+)?\]/g, '')
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
 * Загружает и кэширует стикерпак (с эмодзи для каждого стикера).
 */
async function loadStickerSet(bot, setName) {
  if (stickerCache.has(setName)) return stickerCache.get(setName);

  try {
    const set = await bot.getStickerSet(setName);
    const stickers = set.stickers.map(s => ({
      fileId: s.file_id,
      emoji: s.emoji || '',
    }));
    stickerCache.set(setName, stickers);
    console.log(`[STICKER] Загружен набор "${setName}" (${stickers.length} шт.)`);
    return stickers;
  } catch (err) {
    console.warn(`[STICKER] Не удалось загрузить набор "${setName}": ${err.message}`);
    return [];
  }
}

/**
 * Отправляет стикер, подбирая по эмодзи если указан.
 */
async function sendSticker(bot, chatId, replyTo, emoji) {
  const setNames = config.STICKER_SETS;
  if (!setNames.length) return;

  // Собираем стикеры из всех наборов
  let allStickers = [];
  for (const setName of setNames) {
    const stickers = await loadStickerSet(bot, setName);
    allStickers.push(...stickers);
  }

  if (allStickers.length === 0) return;

  // Подбираем по эмодзи
  let candidates = allStickers;
  if (emoji && typeof emoji === 'string') {
    const matched = allStickers.filter(s => s.emoji === emoji);
    if (matched.length > 0) {
      candidates = matched;
      console.log(`[STICKER] Найдено ${matched.length} стикеров для ${emoji}`);
    } else {
      console.log(`[STICKER] Нет совпадений для ${emoji}, отправляю случайный`);
    }
  }

  const pick = candidates[Math.floor(Math.random() * candidates.length)];

  try {
    await bot.sendSticker(chatId, pick.fileId, { reply_to_message_id: replyTo });
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
    promises.push(sendSticker(bot, chatId, messageId, actions.sticker));
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
