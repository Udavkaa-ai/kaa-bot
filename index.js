const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');
const { processMessage } = require('./handler');
const { generateAutoRevive, createDailySummary, condenseUserMemory } = require('./ai');
const storage = require('./storage');

const bot = new TelegramBot(config.BOT_TOKEN, { polling: true });

console.log(`🐍 ${config.BOT_NAME} запущен...`);
console.log(`[CONFIG] REACTIONS=${config.REACTIONS_ENABLED}, STICKER_SETS=[${config.STICKER_SETS}], CHANCE=${config.REACTION_CHANCE}`);

bot.on('message', async (msg) => {
  try {
    await processMessage(bot, msg);
  } catch (err) {
    console.error('Ошибка обработки сообщения:', err.message);
  }
});

bot.on('polling_error', (err) => {
  console.error('Polling error:', err.message);
});

// === GAMES (inline keyboard callbacks) ===
if (config.GAMES_ENABLED) {
  const { handleGameCallback } = require('./games');
  bot.on('callback_query', async (query) => {
    try {
      await handleGameCallback(bot, query);
    } catch (err) {
      console.error('Ошибка callback_query:', err.message);
      try { await bot.answerCallbackQuery(query.id); } catch (_) {}
    }
  });
  console.log('[CONFIG] GAMES=true');
}

// === AUTO-REVIVE ===
if (config.AUTO_REVIVE_ENABLED) {
  const INACTIVITY_MS = config.AUTO_REVIVE_HOURS * 60 * 60 * 1000;
  const CHECK_INTERVAL = 15 * 60 * 1000; // Проверяем каждые 15 минут

  setInterval(async () => {
    // Ночью по Москве (0-8) не беспокоим
    const moscowHour = parseInt(
      new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', hour12: false }),
      10
    );
    if (moscowHour >= 0 && moscowHour < 8) return;

    const inactiveChats = storage.getInactiveChats(INACTIVITY_MS);
    if (inactiveChats.length === 0) return;

    console.log(`[AUTO-REVIVE] Неактивных чатов: ${inactiveChats.length}`);

    for (const chatId of inactiveChats) {
      try {
        const chatHistory = storage.getHistory(chatId);
        const chatProfile = storage.getChatProfile(chatId);
        const message = await generateAutoRevive(chatHistory, chatProfile);

        if (message) {
          await bot.sendMessage(chatId, message);
          storage.updateLastMessageTime(chatId);
          console.log(`[AUTO-REVIVE] Отправлено в ${chatId}`);
        }
      } catch (err) {
        console.error(`[AUTO-REVIVE ERROR] Чат ${chatId}: ${err.message}`);
        // Если бота кикнули — отключаем auto-revive для этого чата
        if (err.message.includes('chat not found') || err.message.includes('kicked') ||
            err.message.includes('Forbidden') || err.message.includes('bot was blocked')) {
          storage.setAutoRevive(chatId, false);
          console.log(`[AUTO-REVIVE] Отключён для ${chatId} (бот удалён)`);
        }
      }
    }
  }, CHECK_INTERVAL);
}

// === ЕЖЕДНЕВНАЯ АРХИВАЦИЯ ПАМЯТИ ===
// Запускается каждые 30 минут, но архивирует только раз в день (в 2:00 по Москве)
let lastArchiveDate = null;

setInterval(async () => {
  try {
    const now = new Date();
    const moscowTime = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Moscow' }));
    const moscowHour = moscowTime.getHours();
    const todayStr = moscowTime.toISOString().split('T')[0]; // YYYY-MM-DD

    // Архивируем только в 2:00-2:30 по Москве, и только раз в день
    if (moscowHour !== 2) return;
    if (lastArchiveDate === todayStr) return;
    lastArchiveDate = todayStr;

    // Вчерашняя дата для метки архива
    const yesterday = new Date(moscowTime);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    console.log(`[ARCHIVE] Начинаю ежедневную архивацию за ${yesterdayStr}...`);

    // 1. Архивация чатов — создаём сводку дня для каждого чата с буфером
    const chatsWithBuffer = storage.getChatsWithBuffer();
    for (const chatId of chatsWithBuffer) {
      try {
        const buffer = storage.getDailyBuffer(chatId);
        if (buffer.length < 3) {
          // Слишком мало сообщений — просто очищаем буфер
          storage.archiveDay(chatId, 'Мало активности.', yesterdayStr);
          continue;
        }

        const currentTopics = storage.getChatTopics(chatId);
        const summary = await createDailySummary(buffer, currentTopics);

        if (summary) {
          storage.archiveDay(chatId, summary, yesterdayStr);
          const chatName = storage.getChatName(chatId) || chatId;
          console.log(`[ARCHIVE] Чат "${chatName}": сводка создана (${buffer.length} сообщений)`);
        } else {
          storage.archiveDay(chatId, 'Не удалось создать сводку.', yesterdayStr);
        }

        // Пауза между чатами чтобы не исчерпать лимиты API
        await new Promise(r => setTimeout(r, 3000));
      } catch (err) {
        console.error(`[ARCHIVE ERROR] Чат ${chatId}: ${err.message}`);
      }
    }

    // 2. Сжатие досье пользователей (если слишком длинные)
    const allUserIds = storage.getAllUserIds();
    let condensedCount = 0;
    for (const uid of allUserIds) {
      try {
        const memory = storage.getUserMemory(uid);
        if (memory && memory.length > 2000) {
          const condensed = await condenseUserMemory(memory);
          if (condensed) {
            storage.setUserMemory(uid, condensed);
            condensedCount++;
          }
          await new Promise(r => setTimeout(r, 2000));
        }
      } catch (err) {
        console.error(`[ARCHIVE ERROR] User ${uid}: ${err.message}`);
      }
    }

    if (condensedCount > 0) {
      console.log(`[ARCHIVE] Сжато ${condensedCount} досье пользователей`);
    }

    console.log(`[ARCHIVE] Архивация завершена.`);
  } catch (err) {
    console.error('[ARCHIVE ERROR]', err.message);
  }
}, 30 * 60 * 1000); // Проверяем каждые 30 минут

// Graceful shutdown — принудительно сбрасываем отложенные сохранения
process.on('SIGINT', () => {
  console.log('🐍 Удав Каа уходит в джунгли...');
  storage.forceSave();
  process.exit(0);
});

process.on('SIGTERM', () => {
  storage.forceSave();
  process.exit(0);
});
