const config = require('../config');
const stats = require('../db/repo/stats');

let currentIdx = 0;
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
  if (config.geminiKeys.length === 0) {
    throw new Error('GEMINI_KEY не задан');
  }
  if (exhaustedKeys.size >= config.geminiKeys.length) {
    exhaustedKeys.clear();
  }
  let tries = 0;
  while (exhaustedKeys.has(currentIdx) && tries < config.geminiKeys.length) {
    currentIdx = (currentIdx + 1) % config.geminiKeys.length;
    tries++;
  }
  return currentIdx;
}

async function callRest(path, body, modelForStats) {
  let lastErr = null;
  for (let attempt = 0; attempt < config.geminiKeys.length; attempt++) {
    const keyIdx = pickKey();
    const key = config.geminiKeys[keyIdx];
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/${path}?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const txt = await res.text();
        if (res.status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(txt)) {
          console.warn(`[GEMINI] Key #${keyIdx} исчерпан`);
          exhaustedKeys.add(keyIdx);
          currentIdx = (currentIdx + 1) % config.geminiKeys.length;
          lastErr = new Error(`Gemini quota ${res.status}`);
          continue;
        }
        throw new Error(`Gemini ${res.status}: ${txt.slice(0, 300)}`);
      }
      if (modelForStats) stats.increment('gemini', modelForStats).catch(() => {});
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (!/quota|RESOURCE_EXHAUSTED/i.test(err.message)) throw err;
    }
  }
  throw lastErr || new Error('Все Gemini ключи исчерпаны');
}

// Fallback только на актуальные модели 2.5 семейства (1.5/2.0 flash Google выключил).
const MULTIMODAL_FALLBACKS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-flash-latest'];

async function callWithModelFallback(primaryModel, buildBody) {
  const tried = new Set();
  const order = [primaryModel, ...MULTIMODAL_FALLBACKS.filter(m => m !== primaryModel)];
  let lastErr = null;
  for (const model of order) {
    if (tried.has(model)) continue;
    tried.add(model);
    try {
      const data = await callRest(`models/${model}:generateContent`, buildBody(), model);
      return data;
    } catch (err) {
      lastErr = err;
      // Quota — уже обработана внутри callRest (перебор ключей). Дальше бесполезно.
      if (/quota|RESOURCE_EXHAUSTED/i.test(err.message)) throw err;
      // На любую другую ошибку модели (404, 400 unsupported, deprecated, permission) —
      // пробуем следующую в цепочке fallback.
      console.warn(`[GEMINI] Модель ${model} не отработала (${err.message.slice(0, 120)}), пробую следующую`);
      continue;
    }
  }
  throw lastErr || new Error('Все модели Gemini недоступны');
}

async function describeImage(base64, mimeType, userPrompt) {
  const buildBody = () => ({
    contents: [{
      parts: [
        { inline_data: { mime_type: mimeType, data: base64 } },
        { text: userPrompt || 'Опиши что на изображении подробно и точно. Если есть текст — процитируй его дословно.' },
      ],
    }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 800 },
    safetySettings: blockNoneSafety(),
  });
  const data = await callWithModelFallback(config.geminiVisionModel, buildBody);
  return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
}

async function describeAudio(base64, mimeType, userPrompt) {
  const defaultPrompt = `Опиши что слышишь подробно:
- Если речь — расшифруй ДОСЛОВНО на языке оригинала.
- Если музыка — опиши жанр, инструменты, темп, настроение, есть ли вокал/слова.
- Если звуки/шум — опиши что это и где могло происходить.
- Если несколько слоёв (например речь на фоне музыки) — опиши все.
Будь точен и подробен.`;
  const buildBody = () => ({
    contents: [{
      parts: [
        { inline_data: { mime_type: mimeType, data: base64 } },
        { text: userPrompt || defaultPrompt },
      ],
    }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 800 },
    safetySettings: blockNoneSafety(),
  });
  const data = await callWithModelFallback(config.geminiAudioModel, buildBody);
  return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
}

async function embed(text) {
  if (!text) return null;
  const truncated = String(text).slice(0, 8000);
  // gemini-embedding-001 по умолчанию отдаёт 3072 dims, но у нас БД vector(768).
  // Просим 768 через output_dimensionality.
  const body = {
    model: `models/${config.geminiEmbedModel}`,
    content: { parts: [{ text: truncated }] },
    outputDimensionality: config.embedDim || 768,
  };
  try {
    const data = await callRest(
      `models/${config.geminiEmbedModel}:embedContent`,
      body,
      config.geminiEmbedModel
    );
    return data.embedding?.values || null;
  } catch (err) {
    // Если основная embed-модель мертва, пробуем gemini-embedding-001 напрямую.
    if (/404|NOT_FOUND|not found/i.test(err.message) && config.geminiEmbedModel !== 'gemini-embedding-001') {
      console.warn(`[GEMINI] embed model ${config.geminiEmbedModel} мертва, пробую gemini-embedding-001`);
      const fallbackBody = {
        model: 'models/gemini-embedding-001',
        content: { parts: [{ text: truncated }] },
        outputDimensionality: config.embedDim || 768,
      };
      const data = await callRest('models/gemini-embedding-001:embedContent', fallbackBody, 'gemini-embedding-001');
      return data.embedding?.values || null;
    }
    throw err;
  }
}

function blockNoneSafety() {
  return [
    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
  ];
}

function isAvailable() {
  return config.geminiKeys.length > 0;
}

module.exports = { describeImage, describeAudio, embed, isAvailable };
