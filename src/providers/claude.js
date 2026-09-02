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
  // "Key limit exceeded (daily limit)" — OpenRouter отдаёт как 403: это лимит ключа, не модели
  return /rate.?limit|quota|RESOURCE_EXHAUSTED|insufficient.?(balance|credits)|payment required|key limit exceeded|daily limit/i.test(msg);
}

// OpenRouter: у «думающих» моделей (DeepSeek V4 и т.п.) reasoning-токены съедают
// max_tokens, и content приходит пустым. При OPENROUTER_REASONING=off просим
// модель не думать; гибридные модели это понимают, остальные игнорируют.
function reasoningParams() {
  return config.openrouterReasoning === 'off' ? { reasoning: { enabled: false } } : {};
}

// Пустой ответ — это ошибка модели (идём к следующей), а не «null» наверх:
// объясняем, почему пусто, чтобы /diag и логи показывали причину.
function emptyReplyReason(choice) {
  const finish = choice?.finish_reason || '?';
  const reasoned = !!(choice?.message?.reasoning || choice?.message?.reasoning_content);
  if (finish === 'length' && reasoned) return 'пустой ответ: бюджет max_tokens ушёл на reasoning (задай OPENROUTER_REASONING=off)';
  if (finish === 'length') return 'пустой ответ: max_tokens исчерпан до первого символа';
  return `пустой ответ (finish_reason=${finish}${reasoned ? ', есть reasoning' : ''})`;
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
      ...reasoningParams(),
    });
    stats.increment('openrouter', model).catch(() => {});
    const choice = resp.choices?.[0];
    const text = choice?.message?.content || null;
    if (!text) throw new Error(emptyReplyReason(choice));
    return { text, model, raw: resp };
  } catch (err) {
    if (isQuotaError(err)) {
      console.warn(`[CLAUDE] Key #${keyIdx} исчерпан на ${model}`);
      exhaustedKeys.add(keyIdx);
    }
    throw err;
  }
}

async function callWithFallback(messages, opts = {}) {
  // opts.model — предпочтительная модель (строка) или список кандидатов (массив)
  // для этого вызова; если все упали — обычная цепочка фолбэков.
  const preferred = Array.isArray(opts.model) ? opts.model : (opts.model ? [opts.model] : []);
  const baseOrder = [config.claudeModel, ...config.fallbackModels];
  const tryOrder = [...new Set([...preferred, ...baseOrder])];
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
      ...reasoningParams(),
    });
    let full = '';
    let lastChoice = null;
    for await (const chunk of stream) {
      const choice = chunk.choices?.[0];
      if (choice) lastChoice = choice;
      const delta = choice?.delta?.content || '';
      if (delta) {
        full += delta;
        try { onProgress(full); } catch (_) {}
      }
    }
    stats.increment('openrouter', model).catch(() => {});
    if (!full) throw new Error(emptyReplyReason({ finish_reason: lastChoice?.finish_reason, message: lastChoice?.delta }));
    return { text: full, model };
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

// Диагностика: пингуем конкретную модель крошечным запросом и возвращаем
// либо ответ, либо точный текст ошибки (статус + сообщение OpenRouter).
async function probeModel(model) {
  const t0 = Date.now();
  try {
    // maxTokens не 5, а с запасом: «думающим» моделям нужно место под reasoning,
    // иначе диагностика покажет пустой ответ там, где бот работает нормально.
    const r = await callOnce(model, [{ role: 'user', content: 'Ответь одним словом: ок' }], { temperature: 0, maxTokens: 120 });
    return { ok: true, text: (r.text || '').trim().slice(0, 30), ms: Date.now() - t0 };
  } catch (err) {
    const status = err.status ? `HTTP ${err.status}` : '';
    return { ok: false, error: `${status} ${(err.message || String(err)).slice(0, 220)}`.trim(), ms: Date.now() - t0 };
  }
}

module.exports = { ask, askStream, askWithImages, askJson, callWithFallback, probeModel };
