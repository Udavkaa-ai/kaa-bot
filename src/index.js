const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');
const db = require('./db/pool');
const handlers = require('./handlers');
const archive = require('./memory/archive');
const chatsRepo = require('./db/repo/chats');
const statsRepo = require('./db/repo/stats');
const messagesRepo = require('./db/repo/messages');
const eyeballRepo = require('./db/repo/eyeball');
const claude = require('./providers/claude');
const giveaway = require('./handlers/giveaway');
const quiz = require('./handlers/quiz');
const webapp = require('./webapp/server');
const { moscowHour } = require('./utils/time');

// Глобальные хендлеры — чтобы любая ошибка попала в логи Railway
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err?.message || err);
  if (err?.stack) console.error(err.stack);
});

process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]', reason?.message || reason);
  if (reason?.stack) console.error(reason.stack);
});

async function main() {
  // Миграция БД
  try {
    await db.migrate();
  } catch (err) {
    console.error('[DB] Миграция упала:', err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  }

  const bot = new TelegramBot(config.botToken, { polling: true });
  await handlers.init(bot);

  try {
    const me = await bot.getMe();
    config.botUsername = me.username;
  } catch (err) {
    console.error('[BOT] getMe failed:', err.message);
  }

  webapp.setBot(bot);
  webapp.start();

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

  bot.on('poll_answer', async (pollAnswer) => {
    try {
      await quiz.handlePollAnswer(bot, pollAnswer);
    } catch (err) {
      console.error('[POLL_ANSWER]', err.message);
    }
  });

  // Cron: завершение розыгрышей по таймеру (каждые 30 сек)
  setInterval(() => {
    giveaway.tickExpired(bot).catch(err => console.error('[GW TICK]', err.message));
  }, 30 * 1000);

  // Cron: напоминания каждую минуту.
  // Поддерживает два типа: 'text' (обычное) и 'eyeball_top' (пост топа Сечения).
  // Если recurring='daily' — сдвигаем fire_at на +24ч, иначе удаляем.
  setInterval(async () => {
    try {
      const pending = await statsRepo.getPendingReminders();
      for (const r of pending) {
        try {
          if (r.kind === 'eyeball_top') {
            const top = await eyeballRepo.topByStreak(r.chat_id, 5, 2);
            if (top.length === 0) {
              await bot.sendMessage(r.chat_id, '👁 Топ Сечения пустой — никто ещё не играл. /sec чтобы начать.').catch(() => {});
            } else {
              const medals = ['🥇', '🥈', '🥉'];
              const lines = top.map((row, i) => {
                const m = medals[i] || `${i + 1}.`;
                const name = row.username || 'id' + row.user_id;
                return `${m} ${name} — серия ${row.best_streak}, точность ${Number(row.best_accuracy).toFixed(1)}%`;
              });
              await bot.sendMessage(r.chat_id, `👁 Топ "Сечения" сейчас:\n\n${lines.join('\n')}\n\nИграть: /sec`);
            }
          } else {
            await bot.sendMessage(r.chat_id, `⏰ Напоминание: ${r.text}`);
          }
        } catch (err) {
          console.error('[REMINDER]', err.message);
        }
        // Повторяющиеся сдвигаем на следующий день, одноразовые удалим ниже
        if (r.recurring === 'daily') {
          const next = new Date(r.fire_at);
          next.setUTCDate(next.getUTCDate() + 1);
          await statsRepo.bumpRecurring(r.id, next).catch(err =>
            console.error('[REMINDER BUMP]', err.message));
        }
      }
      const toDelete = pending.filter(r => r.recurring !== 'daily').map(r => r.id);
      if (toDelete.length > 0) {
        await statsRepo.removeReminders(toDelete);
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
