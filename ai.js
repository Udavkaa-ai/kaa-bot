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

// Вызов с fallback по моделям и retry при 429
async function callGemini(systemPrompt, messages) {
  for (const model of MODELS) {
    try {
      // Пробуем модель с одним retry при 429
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const result = await callModel(model, systemPrompt, messages);
          return result;
        } catch (err) {
          const is429 = err.message.includes('429');
          const isLast = attempt === 1;

          if (is429 && !isLast) {
            // Извлекаем retryDelay из сообщения если есть, иначе 30 сек
            const match = err.message.match(/retry in (\d+)/i);
            const delay = match ? parseInt(match[1]) * 1000 : 30000;
            const waitSec = Math.min(delay, 60000); // не больше 60 сек
            console.warn(`[AI] 429 на ${model}, жду ${waitSec / 1000}с...`);
            await sleep(waitSec);
            continue;
          }

          throw err; // не 429 или второй attempt — пробрасываем
        }
      }
    } catch (err) {
      const is429 = err.message.includes('429');
      const isLastModel = model === MODELS[MODELS.length - 1];

      if (is429 && !isLastModel) {
        console.warn(`[AI] Квота исчерпана для ${model}, пробуем следующую модель...`);
        continue; // переходим к следующей модели
      }

      throw err; // последняя модель или другая ошибка
    }
  }
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
