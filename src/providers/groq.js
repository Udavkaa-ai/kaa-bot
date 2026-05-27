const config = require('../config');
const stats = require('../db/repo/stats');

async function transcribe(buffer, filename = 'audio.ogg', mimeType = 'audio/ogg') {
  if (!config.groqKey) throw new Error('GROQ_KEY не задан');

  const form = new FormData();
  const blob = new Blob([buffer], { type: mimeType });
  form.append('file', blob, filename);
  form.append('model', config.groqSttModel);
  form.append('response_format', 'json');
  form.append('temperature', '0');

  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${config.groqKey}` },
    body: form,
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Groq STT ${res.status}: ${txt.slice(0, 200)}`);
  }
  stats.increment('groq', config.groqSttModel).catch(() => {});
  const data = await res.json();
  return data.text || null;
}

function isAvailable() {
  return !!config.groqKey;
}

module.exports = { transcribe, isAvailable };
