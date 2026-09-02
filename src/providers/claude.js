const OpenAI = require('openai');
const config = require('../config');
const stats = require('../db/repo/stats');

let currentKeyIdx = 0;
const exhaustedKeys = new Set();
let lastResetDay = currentMoscowDay();

function currentMoscowDay() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });
}

function maybeResetQuotas() {
  const today = currentMoscowDay();
  if (today !== lastResetDay) {
    exhaustedKeys.clear();
    lastResetDay = today;
  }
}

function pickKey() {
  maybeResetQuotas();
  if (config.openrouterKeys.length === 0) {
    throw new Error('OPENROUTER_KEY не задан');
  }
  if (exhaustedKeys.size >= config.openrouterKeys.length) {
    exhaustedKeys.clear();
  }
  let tries = 0;
  while (exhaustedKeys.has(currentKeyIdx) && tries < config.openrouterKeys.length) {
    currentKeyIdx = (currentKeyIdx + 1) % config.openrouterKeys.length;
    tries++;
  }
  return currentKeyIdx;
}

function makeClient(keyIdx) {
  return new OpenAI({
    apiKey: config.openrouterKeys[keyIdx],
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: {
      'HTTP-Referer': 'https://github.com/udavkaa-ai/kaa-bot',
      'X-Title': 'kaa-bot',
    },
    timeout: 60000,
  });
}

function isQuotaError(err) {
  if (!err) return false;
  // 429 — rate limit, 402 — кончились кредиты OpenRouter: в обоих случаях
  // пробуем следующий ключ, а не следующую модель (у неё будет та же беда)
  if (err.status === 429 || err.status === 402) return true;
  const msg = err.message || '';
  return /rate.?limit|quota|RESOURCE_EXHAUSTED|insufficient.?(balance|credits)|payment required/i.test(msg);
}

async function callOnce(model, messages, opts = {}) {
  const keyIdx = pickKey();
  const client = makeClient(keyIdx);
  try {
    const resp = await client.chat.completions.create({
      model,
      messages,
      temperature: opts.temperature ?? 0.85,
      max_tokens: opts.maxTokens ?? 1200,
      ...(opts.responseFormat ? { response_format: opts.responseFormat } : {}),
    });
    stats.increment('openrouter', model).catch(() => {});
    return {
      text: resp.choices?.[0]?.message?.content || null,
      model,
      raw: resp,
    };
  } catch (err) {
    if (isQuotaError(err)) {
      console.warn(`[CLAUDE] Key #${keyIdx} исчерпан на ${model}`);
      exhaustedKeys.add(keyIdx);
    }
    throw err;
  }
}

async function callWithFallback(messages, opts = {}) {
  // opts.model — предпочтительная модель для этого вызова (например, сильная для викторины);
  // если она упала — обычная цепочка фолбэков.
  const baseOrder = [config.claudeModel, ...config.fallbackModels];
  const tryOrder = opts.model
    ? [opts.model, ...baseOrder.filter(m => m !== opts.model)]
    : baseOrder;
  let lastErr = null;

  for (const model of tryOrder) {
    for (let attempt = 0; attempt < config.openrouterKeys.length; attempt++) {
      try {
        return await callOnce(model, messages, opts);
      } catch (err) {
        lastErr = err;
        if (!isQuotaError(err)) {
          console.warn(`[CLAUDE] ${model} failed: ${err.message}`);
          break;
        }
      }
    }
  }
  throw lastErr || new Error('All models failed');
}

function buildSystemContent(systemText) {
  if (!config.promptCache) return systemText;
  // Claude prompt caching через OpenRouter — массив content blocks с cache_control
  return [
    { type: 'text', text: systemText, cache_control: { type: 'ephemeral' } },
  ];
}

function buildAskMessages({ system, history, userText }) {
  const historyMsgs = (history || []).map(m => {
    if (m.role === 'user') {
      const prefix = m.username || m.name || 'Пользователь';
      return { role: 'user', content: `${prefix}: ${m.text}` };
    }
    return { role: 'assistant', content: m.text };
  });
  const messages = [{ role: 'system', content: buildSystemContent(system) }, ...historyMsgs];

  // userText передаётся отдельно только если последнее сообщение истории — не от пользователя
  // или userText явно отличается от последнего user-сообщения в истории
  if (userText) {
    const last = messages[messages.length - 1];
    const lastUserContent = last?.role === 'user' ? last.content : null;
    if (!lastUserContent || !lastUserContent.endsWith(userText)) {
      messages.push({ role: 'user', content: userText });
    }
  }
  return messages;
}

async function ask({ system, history, userText, opts = {} }) {
  return callWithFallback(buildAskMessages({ system, history, userText }), opts);
}

async function streamOnce(model, messages, opts, onProgress) {
  const keyIdx = pickKey();
  const client = makeClient(keyIdx);
  try {
    const stream = await client.chat.completions.create({
      model,
      messages,
      temperature: opts.temperature ?? 0.85,
      max_tokens: opts.maxTokens ?? 1200,
      stream: true,
    });
    let full = '';
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content || '';
      if (delta) {
        full += delta;
        try { onProgress(full); } catch (_) {}
      }
    }
    stats.increment('openrouter', model).catch(() => {});
    return { text: full || null, model };
  } catch (err) {
    if (isQuotaError(err)) {
      console.warn(`[CLAUDE] Key #${keyIdx} исчерпан на ${model} (stream)`);
      exhaustedKeys.add(keyIdx);
    }
    throw err;
  }
}

// Стриминговый вариант ask: onProgress получает накопленный текст по мере генерации.
async function askStream({ system, history, userText, opts = {} }, onProgress) {
  const messages = buildAskMessages({ system, history, userText });
  const tryOrder = [config.claudeModel, ...config.fallbackModels];
  let lastErr = null;
  for (const model of tryOrder) {
    for (let attempt = 0; attempt < config.openrouterKeys.length; attempt++) {
      try {
        return await streamOnce(model, messages, opts, onProgress);
      } catch (err) {
        lastErr = err;
        if (!isQuotaError(err)) {
          console.warn(`[CLAUDE] ${model} stream failed: ${err.message}`);
          break;
        }
      }
    }
  }
  throw lastErr || new Error('All models failed (stream)');
}

async function askWithImages({ system, userText, images = [], opts = {} }) {
  // images: [{ base64, mimeType }]
  const userContent = [
    { type: 'text', text: userText },
    ...images.map(img => ({
      type: 'image_url',
      image_url: { url: `data:${img.mimeType};base64,${img.base64}` },
    })),
  ];
  const messages = [
    { role: 'system', content: buildSystemContent(system) },
    { role: 'user', content: userContent },
  ];
  return callWithFallback(messages, opts);
}

async function askJson({ system, userText, opts = {} }) {
  const messages = [
    { role: 'system', content: system + '\n\nОтвечай ТОЛЬКО валидным JSON, без markdown.' },
    { role: 'user', content: userText },
  ];
  const result = await callWithFallback(messages, { ...opts, temperature: opts.temperature ?? 0.3 });
  if (!result?.text) return null;
  try {
    const clean = result.text.replace(/```json\n?|```\n?/g, '').trim();
    return JSON.parse(clean);
  } catch (err) {
    console.warn('[CLAUDE] JSON parse failed:', err.message);
    return null;
  }
}

module.exports = { ask, askStream, askWithImages, askJson, callWithFallback };
