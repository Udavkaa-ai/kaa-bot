const gemini = require('../providers/gemini');
const claude = require('../providers/claude');
const messagesRepo = require('../db/repo/messages');
const { gatherContext } = require('./context');
const { withTyping } = require('../utils/typing');
const { sendSafe } = require('../utils/telegram');
const { humorReply } = require('../ai/errorHumor');
const config = require('../config');

async function handleAudio(bot, msg) {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;
  const userName = msg.from?.first_name || 'Гость';
  const caption = msg.caption || '';

  if (!config.audioEnabled) return;

  const audio = msg.audio || msg.document;
  if (!audio) return;

  // Проверяем, что документ — это аудио
  if (msg.document && !/audio|mpeg|ogg|wav|mp3|flac|m4a/i.test(audio.mime_type || '')) {
    return; // не аудио — пропускаем
  }

  if (!gemini.isAvailable()) {
    await sendSafe(bot, chatId, 'Уши заняты — нечем слушать (нужен GEMINI_KEY).', { reply_to_message_id: msg.message_id });
    return;
  }

  try {
    const fileLink = await bot.getFileLink(audio.file_id);
    const res = await fetch(fileLink);
    const buffer = Buffer.from(await res.arrayBuffer());
    const mimeType = audio.mime_type || inferMime(audio.file_name);

    // Лимит на размер (Gemini принимает до 20MB inline)
    if (buffer.length > 19 * 1024 * 1024) {
      await sendSafe(bot, chatId, 'Файл слишком большой, не унесу.', { reply_to_message_id: msg.message_id });
      return;
    }

    console.log(`[AUDIO] chat=${chatId} ${userName}: ${Math.round(buffer.length / 1024)}KB ${audio.duration || '?'}s mime=${mimeType}`);

    const base64 = buffer.toString('base64');
    const description = await gemini.describeAudio(base64, mimeType);

    if (!description) {
      await sendSafe(bot, chatId, 'Не разобрал что слышу.', { reply_to_message_id: msg.message_id });
      return;
    }

    console.log(`[AUDIO-DESC] "${description.slice(0, 120)}"`);

    const savedText = caption
      ? `(прислал аудио с подписью "${caption}", в аудио: ${description})`
      : `(прислал аудио, в нём: ${description})`;

    await messagesRepo.addMessage(chatId, 'user', savedText, {
      userId, username: userName, messageId: msg.message_id,
    });

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
      console.log(`[OUT] chat=${chatId} ${result.model} +audio | "${reply.slice(0, 80)}"`);
    }
  } catch (err) {
    console.error(`[AUDIO] chat=${chatId}: ${err.message}`);
    await sendSafe(bot, chatId, humorReply(err), { reply_to_message_id: msg.message_id });
  }
}

function inferMime(filename) {
  const f = (filename || '').toLowerCase();
  if (f.endsWith('.mp3')) return 'audio/mpeg';
  if (f.endsWith('.ogg')) return 'audio/ogg';
  if (f.endsWith('.wav')) return 'audio/wav';
  if (f.endsWith('.flac')) return 'audio/flac';
  if (f.endsWith('.m4a')) return 'audio/mp4';
  return 'audio/mpeg';
}

module.exports = { handleAudio };
