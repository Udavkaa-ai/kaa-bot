const gemini = require('../providers/gemini');
const claude = require('../providers/claude');
const messagesRepo = require('../db/repo/messages');
const { gatherContext } = require('./context');
const { withTyping } = require('../utils/typing');
const { sendSafe } = require('../utils/telegram');
const { humorReply } = require('../ai/errorHumor');
const config = require('../config');

async function handlePhoto(bot, msg) {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;
  const userName = msg.from?.first_name || 'Гость';
  const caption = msg.caption || '';

  if (!config.visionEnabled) return;

  try {
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    const fileLink = await bot.getFileLink(fileId);
    const imgRes = await fetch(fileLink);
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    const base64 = buffer.toString('base64');
    const mimeType = inferMime(fileLink);

    console.log(`[VISION] chat=${chatId} ${userName}: ${Math.round(buffer.length / 1024)}KB caption="${caption.slice(0, 50)}"`);

    // 1. Описываем картинку через Gemini (бесплатно)
    let description = null;
    if (gemini.isAvailable()) {
      try {
        description = await gemini.describeImage(base64, mimeType,
          'Опиши изображение в нескольких предложениях. Учитывай детали важные для контекста разговора. Если есть текст — процитируй.');
      } catch (err) {
        console.warn('[VISION] Gemini failed, fallback Claude:', err.message);
      }
    }

    // 2. Fallback на Claude vision если Gemini нет/упал
    if (!description) {
      const result = await claude.askWithImages({
        system: 'Опиши изображение объективно в нескольких предложениях. Если есть текст — процитируй.',
        userText: caption || 'Что на этом изображении?',
        images: [{ base64, mimeType }],
        opts: { temperature: 0.4, maxTokens: 500 },
      });
      description = result?.text || null;
    }

    if (!description) {
      await sendSafe(bot, chatId, 'Не разглядел что на картинке.', { reply_to_message_id: msg.message_id });
      return;
    }

    // 3. Сохраняем как "сообщение" с описанием
    const savedText = caption
      ? `(прислал фото с подписью "${caption}", на фото: ${description})`
      : `(прислал фото, на нём: ${description})`;

    await messagesRepo.addMessage(chatId, 'user', savedText, {
      userId, username: userName, messageId: msg.message_id,
    });

    // 4. Генерируем реплику в характере персоны
    const ctx = await gatherContext(msg, caption || description);
    const result = await withTyping(bot, chatId, () =>
      claude.ask({
        system: ctx.system,
        history: ctx.history,
        opts: { temperature: 0.85, maxTokens: 800 },
      })
    );

    if (result?.text) {
      const reply = result.text.trim();
      await sendSafe(bot, chatId, reply, { reply_to_message_id: msg.message_id });
      await messagesRepo.addMessage(chatId, 'assistant', reply, {});
      console.log(`[OUT] chat=${chatId} ${result.model} +photo | "${reply.slice(0, 80)}"`);
    }
  } catch (err) {
    console.error(`[PHOTO] chat=${chatId}: ${err.message}`);
    await sendSafe(bot, chatId, humorReply(err), { reply_to_message_id: msg.message_id });
  }
}

function inferMime(url) {
  const lower = (url || '').toLowerCase();
  if (lower.includes('.png')) return 'image/png';
  if (lower.includes('.webp')) return 'image/webp';
  if (lower.includes('.gif')) return 'image/gif';
  return 'image/jpeg';
}

module.exports = { handlePhoto };
