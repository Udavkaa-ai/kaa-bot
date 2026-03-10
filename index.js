const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');
const { processMessage } = require('./handler');
const { generateAutoRevive } = require('./ai');
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
