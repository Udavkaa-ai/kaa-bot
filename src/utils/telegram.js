const MAX_LEN = 4000;

function splitMessage(text, maxLen = MAX_LEN) {
  if (!text) return [];
  if (text.length <= maxLen) return [text];
  const parts = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    let cut = remaining.lastIndexOf('\n\n', maxLen);
    if (cut < maxLen / 2) cut = remaining.lastIndexOf('\n', maxLen);
    if (cut < maxLen / 2) cut = remaining.lastIndexOf('. ', maxLen);
    if (cut < maxLen / 2) cut = remaining.lastIndexOf(' ', maxLen);
    if (cut < maxLen / 2) cut = maxLen;
    parts.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining.length > 0) parts.push(remaining);
  return parts;
}

async function sendSafe(bot, chatId, text, opts = {}) {
  if (!text) return;
  const parts = splitMessage(text);
  let firstId = null;
  for (let i = 0; i < parts.length; i++) {
    const sendOpts = i === 0 ? opts : {};
    try {
      const msg = await bot.sendMessage(chatId, parts[i], sendOpts);
      if (i === 0) firstId = msg.message_id;
    } catch (err) {
      console.error(`[TG] sendMessage chat=${chatId}: ${err.message}`);
    }
  }
  return firstId;
}

// Служебное уведомление лично юзеру: в группах — эфемерное сообщение
// (видит только он, чат не засоряется), в личке или при ошибке — обычный reply.
async function noticeUser(bot, msg, text) {
  const chatId = msg.chat.id;
  const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup';
  if (isGroup && msg.from?.id) {
    try {
      const rawApi = require('./rawApi');
      await rawApi.sendEphemeral(chatId, msg.from.id, text);
      return;
    } catch (err) {
      // Сервер не поддержал / нет прав — падаем в обычный reply
    }
  }
  await sendSafe(bot, chatId, text, { reply_to_message_id: msg.message_id });
}

module.exports = { splitMessage, sendSafe, noticeUser };
