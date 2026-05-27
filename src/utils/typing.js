const config = require('../config');

async function withTyping(bot, chatId, action, opts = {}) {
  let cancelled = false;
  const interval = setInterval(() => {
    if (cancelled) return;
    bot.sendChatAction(chatId, opts.action || 'typing').catch(() => {});
  }, 4000);
  bot.sendChatAction(chatId, opts.action || 'typing').catch(() => {});

  const minDelay = opts.minDelay ?? config.typingDelay;
  const started = Date.now();
  try {
    const result = await action();
    const elapsed = Date.now() - started;
    if (elapsed < minDelay) {
      await new Promise(r => setTimeout(r, minDelay - elapsed));
    }
    return result;
  } finally {
    cancelled = true;
    clearInterval(interval);
  }
}

module.exports = { withTyping };
