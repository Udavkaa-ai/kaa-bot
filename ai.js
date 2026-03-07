const config = require('./config');

// Gemini модели (перебираются первыми, бесплатно)
const GEMINI_MODELS = [
  config.GEMINI_MODEL || 'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
];

// OpenRouter модели (fallback когда Gemini исчерпан, бесплатные)
const OPENROUTER_MODELS = [
  'meta-llama/llama-3.3-70b-instruct:free',
  'deepseek/deepseek-chat-v3-0324:free',
  'mistralai/mistral-small-3.1-24b-instruct:free',
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Вызов Gemini API
async function callGeminiModel(model, systemPrompt, messages) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.GEMINI_KEY}`;

  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.text }],
  }));

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents,
      generationConfig: { temperature: 0.8, maxOutputTokens: 500 },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
}

// Вызов OpenRouter API (OpenAI-совместимый формат)
async function callOpenRouterModel(model, systemPrompt, messages) {
  if (!config.OPENROUTER_KEY) throw new Error('OPENROUTER_KEY не задан');

  const oaiMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.text,
    })),
  ];

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.OPENROUTER_KEY}`,
      'HTTP-Referer': 'https://github.com/Udavkaa-ai/kaa-bot',
      'X-Title': 'kaa-bot',
    },
    body: JSON.stringify({
      model,
      messages: oaiMessages,
      temperature: 0.8,
      max_tokens: 500,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || null;
}

// Перебирает список моделей одного провайдера
async function tryModels(models, callFn, systemPrompt, messages) {
  let lastError = null;

  for (const model of models) {
    try {
      const result = await callFn(model, systemPrompt, messages);
      return result;
    } catch (err) {
      lastError = err;
      const isQuota = err.message.includes('429') || err.message.includes('RESOURCE_EXHAUSTED');
      const is404 = err.message.includes('404');

      if (isQuota || is404) {
        console.warn(`[AI] ${model}: ${isQuota ? 'квота' : 'не найдена'}, следующая...`);
        await sleep(500);
        continue;
      }

      throw err; // другая ошибка — сразу наружу
    }
  }

  throw lastError;
}

// Главная функция: сначала Gemini, потом OpenRouter
async function callAI(systemPrompt, messages) {
  try {
    return await tryModels(GEMINI_MODELS, callGeminiModel, systemPrompt, messages);
  } catch (err) {
    const isQuota = err.message.includes('429') || err.message.includes('RESOURCE_EXHAUSTED');
    const is404 = err.message.includes('404');
    if (!isQuota && !is404) throw err;
    console.warn('[AI] Все Gemini квоты исчерпаны, переключаюсь на OpenRouter...');
  }

  return await tryModels(OPENROUTER_MODELS, callOpenRouterModel, systemPrompt, messages);
}

async function getAIResponse({ text, userName, userProfile, chatHistory }) {
  let userContext = '';
  if (userProfile && userProfile.facts?.length) {
    userContext = `\n\nЧто ты знаешь об этом существе (${userName}): ${userProfile.facts.join(', ')}.`;
    if (userProfile.attitude) {
      userContext += ` Твоё отношение к нему: ${userProfile.attitude}.`;
    }
  }

  const systemPrompt = `${config.BOT_PERSONA}${userContext}

Ты общаешься в Telegram чате. Отвечай только на последнее сообщение пользователя.
Не повторяй имя собеседника в каждом ответе. Будь краток — максимум 3-4 предложения.`;

  const history = chatHistory.slice(-config.HISTORY_LIMIT);

  const messages = history.length > 0
    ? history.map(m => ({
        role: m.role,
        text: m.role === 'user' ? `${m.name || 'Пользователь'}: ${m.text}` : m.text,
      }))
    : [{ role: 'user', text: `${userName}: ${text}` }];

  return await callAI(systemPrompt, messages);
}

// Лёгкий запрос для обновления профиля
async function getProfileUpdate(userName, userText) {
  const systemPrompt = `Ты анализируешь сообщение пользователя и извлекаешь факты о нём.
Верни JSON объект или null если нечего добавить.
Формат: {"facts": ["факт1", "факт2"], "attitude": "нейтральное|дружелюбное|враждебное"}
Только JSON, без пояснений.`;

  const messages = [{ role: 'user', text: `Пользователь ${userName} написал: "${userText}"` }];

  try {
    const result = await callAI(systemPrompt, messages);
    if (!result) return null;
    const clean = result.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    return null;
  }
}

module.exports = { getAIResponse, getProfileUpdate };
