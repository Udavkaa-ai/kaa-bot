'use strict';

const ALLOWED_BOT_USERNAME = 'udavkaa_ai';

function shouldIgnoreIncomingBot(msg, ownBotId) {
  const sender = msg?.from;
  if (!sender?.is_bot || sender.id === ownBotId) return false;

  const username = String(sender.username || '').toLowerCase();
  if (username !== ALLOWED_BOT_USERNAME) return true;

  // Разрешённому боту отвечаем на исходное сообщение, но не на его ответ
  // боту: это обрывает взаимную цепочку ответов до возникновения цикла.
  return Boolean(msg.reply_to_message?.from?.is_bot);
}

module.exports = { ALLOWED_BOT_USERNAME, shouldIgnoreIncomingBot };
