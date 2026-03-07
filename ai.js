const config = require('./config');

// Список моделей для fallback — основная + резервная
const MODELS = [
  config.GEMINI_MODEL || 'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash-8b',
];

function getUrl(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.GEMINI_KEY}`;
}

// Задержка в мс
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Вызов конкретной модели (без fallback)
async function callModel(model, systemPrompt, messages) {
  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.text }],
  }));

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: {
      temperature: 0.8,
      maxOutputTokens: 500,
    },
  };

  const res = await fetch(getUrl(model), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
}

// Вызов с перебором моделей при 429
async function callGemini(systemPrompt, messages) {
  let lastError = null;

  for (const model of MODELS) {
    try {
      return await callModel(model, systemPrompt, messages);
    } catch (err) {
      lastError = err;

      if (!err.message.includes('429')) {
        // Не квота — пробрасываем сразу
        throw err;
      }

      console.warn(`[AI] Квота исчерпана для ${model}, переключаюсь на следующую...`);
      await sleep(1000);
    }
  }

  // Все модели исчерпаны
  throw lastError;
}

async function getAIResponse({ text, userName, userProfile, chatHistory, chatId }) {
  // Формируем контекст о пользователе
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

  // Берём последние N сообщений как контекст
  const history = chatHistory.slice(-config.HISTORY_LIMIT);

  // Если истории нет — делаем простой запрос
  const messages = history.length > 0
    ? history.map(m => ({
        role: m.role,
        text: m.role === 'user' ? `${m.name || 'Пользователь'}: ${m.text}` : m.text,
      }))
    : [{ role: 'user', text: `${userName}: ${text}` }];

  return await callGemini(systemPrompt, messages);
}

// Лёгкий запрос для обновления профиля
async function getProfileUpdate(userName, userText, botResponse) {
  const systemPrompt = `Ты анализируешь сообщение пользователя и извлекаешь факты о нём.
Верни JSON объект или null если нечего добавить.
Формат: {"facts": ["факт1", "факт2"], "attitude": "нейтральное|дружелюбное|враждебное"}
Только JSON, без пояснений.`;

  const message = `Пользователь ${userName} написал: "${userText}"`;

  try {
    const result = await callGemini(systemPrompt, [{ role: 'user', text: message }]);
    if (!result) return null;
    const clean = result.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    return null;
  }
}

module.exports = { getAIResponse, getProfileUpdate };
