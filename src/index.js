const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');
const db = require('./db/pool');
const handlers = require('./handlers');
const archive = require('./memory/archive');
const chatsRepo = require('./db/repo/chats');
const statsRepo = require('./db/repo/stats');
const messagesRepo = require('./db/repo/messages');
const claude = require('./providers/claude');
const { moscowHour } = require('./utils/time');

async function main() {
  // Миграция БД
  try {
    await db.migrate();
  } catch (err) {
    console.error('[DB] Миграция упала:', err.message);
    process.exit(1);
  }

  const bot = new TelegramBot(config.botToken, { polling: true });
  await handlers.init(bot);
  console.log(`🐍 ${config.botName} запущен`);

  bot.on('message', (msg) => {
    handlers.dispatch(bot, msg).catch(err => {
      console.error('[DISPATCH]', err.message);
    });
  });

  bot.on('callback_query', async (query) => {
    try {
      await handlers.handleCallback(bot, query);
    } catch (err) {
      console.error('[CALLBACK]', err.message);
      try { await bot.answerCallbackQuery(query.id); } catch (_) {}
    }
  });

  bot.on('polling_error', (err) => {
    console.error('[POLLING]', err.message);
  });

  // Cron: напоминания каждую минуту
  setInterval(async () => {
    try {
      const pending = await statsRepo.getPendingReminders();
      for (const r of pending) {
        try {
          await bot.sendMessage(r.chat_id, `⏰ Напоминание: ${r.text}`);
        } catch (err) {
          console.error('[REMINDER]', err.message);
        }
      }
      if (pending.length > 0) {
        await statsRepo.removeReminders(pending.map(r => r.id));
      }
    } catch (err) {
      console.error('[REMINDER LOOP]', err.message);
    }
  }, 60 * 1000);

  // Cron: авто-оживление чатов
  if (config.autoReviveEnabled) {
    const INACTIVITY_MS = config.autoReviveHours * 60 * 60 * 1000;
    setInterval(async () => {
      try {
        const h = moscowHour();
        if (h < 8) return; // ночь не беспокоим

        const chatIds = await chatsRepo.getInactiveChats(INACTIVITY_MS);
        for (const chatId of chatIds) {
          try {
            const history = await messagesRepo.getHistory(chatId, 10);
            const transcript = history
              .map(m => `${m.role === 'user' ? (m.username || 'юзер') : 'бот'}: ${m.text || ''}`)
              .join('\n').slice(0, 3000);

            const result = await claude.callWithFallback(
              [
                { role: 'system', content: `Ты — бот в неактивном чате. Напиши ОДНО короткое сообщение (1-2 предложения) чтобы оживить разговор. Это может быть вопрос по последней теме, наблюдение, провокационное мнение. НЕ упоминай тишину. Не начинай с "Кстати".` },
                { role: 'user', content: `Последние сообщения:\n${transcript}` },
              ],
              { temperature: 0.9, maxTokens: 200 }
            );

            if (result?.text) {
              await bot.sendMessage(chatId, result.text.trim());
              await chatsRepo.upsertChat(chatId, null, null);
              console.log(`[AUTO-REVIVE] chat=${chatId}`);
            }
          } catch (err) {
            console.error(`[AUTO-REVIVE] chat=${chatId}:`, err.message);
            if (/chat not found|kicked|Forbidden|bot was blocked/i.test(err.message)) {
              await chatsRepo.setAutoRevive(chatId, false);
            }
          }
        }
      } catch (err) {
        console.error('[AUTO-REVIVE LOOP]', err.message);
      }
    }, 15 * 60 * 1000);
  }

  // Cron: ежедневная архивация в 2:00 МСК
  let lastArchive = null;
  setInterval(async () => {
    try {
      const h = moscowHour();
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });
      if (h !== 2 || lastArchive === today) return;
      lastArchive = today;
      console.log('[ARCHIVE] Начинаю ежедневную архивацию...');
      await archive.archiveAllChats();
    } catch (err) {
      console.error('[ARCHIVE CRON]', err.message);
    }
  }, 30 * 60 * 1000);

  const shutdown = async (signal) => {
    console.log(`Получен ${signal}, завершаю...`);
    try {
      await bot.stopPolling();
      await db.close();
    } catch (_) {}
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
