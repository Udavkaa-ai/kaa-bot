const groq = require('../providers/groq');
const gemini = require('../providers/gemini');
const claude = require('../providers/claude');
const messagesRepo = require('../db/repo/messages');
const { gatherContext } = require('./context');
const { withTyping } = require('../utils/typing');
const { sendSafe } = require('../utils/telegram');
const { humorReply } = require('../ai/errorHumor');
const config = require('../config');

async function handleVoice(bot, msg) {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;
  const userName = msg.from?.first_name || 'Гость';

  if (!config.voiceEnabled) return;

  const voice = msg.voice || msg.video_note;
  if (!voice) return;

  try {
    const fileLink = await bot.getFileLink(voice.file_id);
    const res = await fetch(fileLink);
    const buffer = Buffer.from(await res.arrayBuffer());
    const mimeType = msg.voice ? 'audio/ogg' : 'video/mp4';
    const filename = msg.voice ? 'voice.ogg' : 'video.mp4';

    console.log(`[VOICE] chat=${chatId} ${userName}: ${Math.round(buffer.length / 1024)}KB ${voice.duration}s`);

    // 1. Транскрипция: Groq Whisper приоритетно, fallback на Gemini
    let transcript = null;
    let sttSource = null;
    if (groq.isAvailable()) {
      try {
        transcript = await groq.transcribe(buffer, filename, mimeType);
        if (transcript) sttSource = 'groq';
      } catch (err) {
        console.warn('[VOICE] Groq упал, попробую Gemini:', err.message);
      }
    } else {
      console.warn('[VOICE] GROQ_KEY не задан — сразу Gemini');
    }
    if (!transcript && gemini.isAvailable()) {
      try {
        const base64 = buffer.toString('base64');
        transcript = await gemini.describeAudio(base64, mimeType,
          'Транскрибируй ДОСЛОВНО что сказано в этом аудио на языке оригинала. Верни только текст сказанного, без комментариев.');
        if (transcript) sttSource = 'gemini';
      } catch (err) {
        console.warn('[VOICE] Gemini тоже упал:', err.message);
      }
    } else if (!transcript) {
      console.warn('[VOICE] GEMINI_KEY не задан — распознавать нечем');
    }

    if (!transcript || transcript.length < 2) {
      console.warn(`[VOICE] chat=${chatId} транскрипция пустая. groq=${groq.isAvailable()} gemini=${gemini.isAvailable()}`);
      await sendSafe(bot, chatId, 'Не разобрал что сказано. Проверь ключи GROQ_KEY / GEMINI_KEY на Railway.', { reply_to_message_id: msg.message_id });
      return;
    }

    console.log(`[STT/${sttSource}] "${transcript.slice(0, 100)}"`);

    // 2. Сохраняем ЧИСТУЮ расшифровку — без пометки "(голосовым сообщением)",
    // потому что Claude, увидев такую разметку, иногда рефлекторно отвечает
    // "я текстовый бот и голосовые не распознаю". Для него это просто текст юзера.
    await messagesRepo.addMessage(chatId, 'user', transcript, {
      userId, username: userName, messageId: msg.message_id,
    });

    // 3. Ответ через Claude в характере персоны
    const ctx = await gatherContext(msg, transcript);
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
      console.log(`[OUT] chat=${chatId} ${result.model} +voice | "${reply.slice(0, 80)}"`);
    }
  } catch (err) {
    console.error(`[VOICE] chat=${chatId}: ${err.message}`);
    await sendSafe(bot, chatId, humorReply(err), { reply_to_message_id: msg.message_id });
  }
}

module.exports = { handleVoice };
