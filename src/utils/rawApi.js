const config = require('../config');

// Прямые вызовы Bot API через fetch — для методов, которых нет в
// node-telegram-bot-api (sendMessageDraft, ephemeral-сообщения,
// setChatMemberTag и прочие новинки Bot API 10.x).
async function call(method, params = {}) {
  const res = await fetch(`https://api.telegram.org/bot${config.botToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json().catch(() => null);
  if (!data || !data.ok) {
    const desc = (data && data.description) || `HTTP ${res.status}`;
    throw new Error(`${method}: ${desc}`);
  }
  return data.result;
}

// Эфемерное сообщение: в группе его видит только receiver (userId).
// Подходит для служебных уведомлений, которые незачем показывать всем.
async function sendEphemeral(chatId, userId, text, extra = {}) {
  return call('sendMessage', {
    chat_id: chatId,
    text,
    ephemeral_message_parameters: { receiver_user_id: userId },
    ...extra,
  });
}

module.exports = { call, sendEphemeral };
