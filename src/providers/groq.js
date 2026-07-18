const config = require('../config');
const stats = require('../db/repo/stats');

// Если основная модель заблокирована на project level или снята —
// пробуем эти по очереди.
const STT_FALLBACKS = ['whisper-large-v3', 'whisper-large-v3-turbo'];

async function transcribeOnce(model, buffer, filename, mimeType) {
  const form = new FormData();
  const blob = new Blob([buffer], { type: mimeType });
  form.append('file', blob, filename);
  form.append('model', model);
  form.append('response_format', 'json');
  form.append('temperature', '0');

  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${config.groqKey}` },
    body: form,
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Groq STT ${res.status} (${model}): ${txt.slice(0, 220)}`);
  }
  stats.increment('groq', model).catch(() => {});
  const data = await res.json();
  return data.text || null;
}

async function transcribe(buffer, filename = 'audio.ogg', mimeType = 'audio/ogg') {
  if (!config.groqKey) throw new Error('GROQ_KEY не задан');

  const tried = new Set();
  const order = [config.groqSttModel, ...STT_FALLBACKS.filter(m => m !== config.groqSttModel)];
  let lastErr = null;

  for (const model of order) {
    if (tried.has(model)) continue;
    tried.add(model);
    try {
      return await transcribeOnce(model, buffer, filename, mimeType);
    } catch (err) {
      lastErr = err;
      // Модель заблокирована / не найдена / отключена — идём к следующей
      if (/403|404|blocked|decommissioned|not found|not available/i.test(err.message)) {
        console.warn(`[GROQ] ${model} недоступна, пробую следующую`);
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error('Все Groq STT модели недоступны');
}

function isAvailable() {
  return !!config.groqKey;
}

module.exports = { transcribe, isAvailable };
