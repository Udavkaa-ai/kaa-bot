const messagesRepo = require('../db/repo/messages');
const { gatherContext, generateReply, generateReplyStream } = require('./context');
const { withTyping } = require('../utils/typing');
const { sendSafe } = require('../utils/telegram');
const { humorReply } = require('../ai/errorHumor');
const { withPersonaTag } = require('../utils/personaTag');
const rawApi = require('../utils/rawApi');
const profile = require('../memory/profile');
const semantic = require('../memory/semantic');

const DRAFT_INTERVAL_MS = 700; // не спамим драфтами чаще чем раз в 700мс

// Стриминг ответа в личке: sendMessageDraft показывает "печатающийся" текст
// (Bot API 10.x), финальное сообщение отправляется обычным способом.
async function generateWithDrafts(bot, chatId, draftId, ctx) {
  let lastSent = 0;
  let draftsBroken = false;
  // Мгновенный "Thinking..." плейсхолдер
  rawApi.call('sendMessageDraft', { chat_id: chatId, draft_id: draftId, text: '' })
    .catch(() => { draftsBroken = true; });

  const onProgress = (full) => {
    if (draftsBroken) return;
    const now = Date.now();
    if (now - lastSent < DRAFT_INTERVAL_MS) return;
    lastSent = now;
    rawApi.call('sendMessageDraft', {
      chat_id: chatId,
      draft_id: draftId,
      text: full.slice(0, 4000),
    }).catch(() => { draftsBroken = true; });
  };

  try {
    return await generateReplyStream({ system: ctx.system, history: ctx.history }, onProgress);
  } catch (err) {
    console.warn(`[TEXT] stream failed (${err.message}), фолбэк на обычный запрос`);
    return generateReply({ system: ctx.system, history: ctx.history });
  }
}

const batchCounters = new Map();
const topicCounters = new Map();
const BATCH_EVERY = 20;
const TOPIC_EVERY = 50;

async function handleText(bot, msg, opts = {}) {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;
  const userName = msg.from?.first_name || 'Гость';
  const userTag = msg.from?.username ? `@${msg.from.username}` : null;
  const userText = opts.textOverride || msg.text || msg.caption || '';

  // Сохраняем входящее сообщение
  await messagesRepo.addMessage(chatId, 'user', userText, {
    userId, username: userName, messageId: msg.message_id,
  });

  // Контекст + ответ
  let result, ctx;
  try {
    ctx = await gatherContext(msg, userText);
    if (ctx.searchContext) {
      console.log(`[SEARCH] chat=${chatId} нашли результаты`);
    }
    const isPrivate = msg.chat.type === 'private';
    result = await withTyping(bot, chatId, () =>
      isPrivate
        ? generateWithDrafts(bot, chatId, msg.message_id, ctx)
        : generateReply({ system: ctx.system, history: ctx.history })
    );
  } catch (err) {
    console.error(`[TEXT] chat=${chatId}: ${err.message}`);
    if (err.stack) console.error(err.stack);
    const reply = humorReply(err);
    await sendSafe(bot, chatId, reply, { reply_to_message_id: msg.message_id });
    return;
  }

  if (!result?.text) return;
  const clean = result.text.trim();
  const tagged = withPersonaTag(clean, ctx.persona);
  await sendSafe(bot, chatId, tagged, { reply_to_message_id: msg.message_id });

  // В историю пишем ЧИСТУЮ версию — эмодзи-тег добавляется только при отправке.
  await messagesRepo.addMessage(chatId, 'assistant', clean, { userId: null, username: null });

  console.log(`[OUT] chat=${chatId} ${result.model} ${ctx.persona?.name || '?'} | "${clean.slice(0, 80)}"`);

  // Асинхронные обновления памяти/профилей
  profile.reflectAsync(chatId, userId, userName, userText, replyText);

  // Сохраняем заметное сообщение в семантическую память
  if (userText.length > 30) {
    semantic.remember({
      chatId, userId,
      content: `${userName} (${userTag || ''}): ${userText}`.slice(0, 500),
      kind: 'user_message', importance: 0.4,
    }).catch(() => {});
  }

  // Batch-анализ каждые N сообщений
  bumpBatch(chatId);
}

function bumpBatch(chatId) {
  const c = (batchCounters.get(chatId) || 0) + 1;
  batchCounters.set(chatId, c);
  if (c >= BATCH_EVERY) {
    batchCounters.set(chatId, 0);
    messagesRepo.getHistory(chatId, 30)
      .then(recent => profile.batchAnalyzeAsync(chatId, recent))
      .catch(() => {});
  }

  const tc = (topicCounters.get(chatId) || 0) + 1;
  topicCounters.set(chatId, tc);
  if (tc >= TOPIC_EVERY) {
    topicCounters.set(chatId, 0);
    messagesRepo.getHistory(chatId, 50)
      .then(recent => profile.updateChatTopicAsync(chatId, recent))
      .catch(() => {});
  }
}

module.exports = { handleText };
