const config = require('./config');

// Groq модели (основной провайдер, бесплатный, 14400 req/день)
const GROQ_MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'gemma2-9b-it',
];

// OpenRouter модели (fallback когда Groq исчерпан)
const OPENROUTER_MODELS = [
  'meta-llama/llama-3.3-70b-instruct:free',
  'mistralai/mistral-small-3.1-24b-instruct:free',
  'google/gemma-3-12b-it:free',
  'qwen/qwen3-8b:free',
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Вызов Groq API (OpenAI-совместимый формат)
async function callGroqModel(model, systemPrompt, messages) {
  if (!config.GROQ_KEY) throw new Error('GROQ_KEY не задан');

  const groqMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.text,
    })),
  ];

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.GROQ_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: groqMessages,
      temperature: 0.8,
      max_tokens: 500,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || null;
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
      return { text: result, model };
    } catch (err) {
      lastError = err;
      const isQuota = err.message.includes('429') || err.message.includes('rate_limit') || err.message.includes('RESOURCE_EXHAUSTED');
      const is404 = err.message.includes('404');

      if (isQuota || is404) {
        console.warn(`[AI] ${model}: ${isQuota ? 'квота' : 'не найдена'}, следующая...`);
        await sleep(1000);
        continue;
      }

      throw err; // другая ошибка — сразу наружу
    }
  }

  throw lastError;
}

// Главная функция: сначала Groq, потом OpenRouter
async function callAI(systemPrompt, messages) {
  // Пробуем Groq
  if (config.GROQ_KEY) {
    try {
      return await tryModels(GROQ_MODELS, callGroqModel, systemPrompt, messages);
    } catch (err) {
      const isQuota = err.message.includes('429') || err.message.includes('rate_limit') || err.message.includes('RESOURCE_EXHAUSTED');
      const is404 = err.message.includes('404');
      if (!isQuota && !is404) throw err;
      console.warn('[AI] Все Groq квоты исчерпаны, переключаюсь на OpenRouter...');
    }
  }

  // Fallback на OpenRouter
  return await tryModels(OPENROUTER_MODELS, callOpenRouterModel, systemPrompt, messages);
}

async function getAIResponse({ text, userName, userProfile, userMemory, chatHistory, searchContext }) {
  let userContext = '';
  // Глобальная память о пользователе (общая на все чаты)
  if (userMemory) {
    userContext = `\n\nДосье на собеседника (${userName}):\n${userMemory}`;
  }
  // Дополнительные факты из текущего чата
  if (userProfile && userProfile.facts?.length) {
    userContext += `\n\nДополнительно об этом существе (${userName}): ${userProfile.facts.join(', ')}.`;
    if (userProfile.attitude) {
      userContext += ` Твоё отношение к нему: ${userProfile.attitude}.`;
    }
  }

  let searchInstruction = '';
  if (searchContext) {
    searchInstruction = `\n\nТЫ ВЫПОЛНИЛ ВЕБ-ПОИСК. Вот результаты:\n${searchContext}\n\nОТВЕЧАЙ НА ОСНОВЕ ЭТИХ ДАННЫХ. Ты имеешь доступ к интернету. Никогда не говори что не можешь искать или не имеешь доступа. Перескажи информацию своими словами в своём стиле.`;
  }

  let reactionsInstruction = '';
  if (config.REACTIONS_ENABLED) {
    const hasStickers = config.STICKER_SETS.length > 0;
    reactionsInstruction = `

У тебя есть специальные команды. Добавляй теги В КОНЕЦ ответа:
- [REACT:emoji] — поставить реакцию на сообщение пользователя. Доступные: 👍 👎 ❤️ 🔥 👏 😁 🤔 🤯 😱 😢 🎉 🤩 💩 🙏 👌 🤡 💯 🤣 ⚡ 🏆 💔 🤨 😈 😭 🤓 👀 🙈 😇 🤗 🤪 🗿 🆒 😎 😡
${hasStickers ? '- [STICKER:emoji] — отправить стикер, подобранный по эмодзи. Например [STICKER:😂] или [STICKER:😎] или [STICKER:❤️].\n' : ''}
ПРАВИЛО: Реакцию [REACT] ставь РЕДКО — только когда сообщение действительно вызывает эмоцию (смешное, трогательное, дерзкое). В большинстве обычных сообщений НЕ ставь реакцию. Примерно 1 из 4-5 сообщений.

Примеры ответов:
Пользователь: "Ты лучший удав!"
Ответ: Лесть приятна, но не спасёт тебя от голода. [REACT:😎]

Пользователь: "Пришли стикер"
Ответ: Держи, маугли. [STICKER:😎]

Пользователь: "Расскажи анекдот"
Ответ: Маугли спрашивает Балу: зачем тебе такие большие когти? Балу: а ты попробуй почесать спину без них. [REACT:🤣]

Пользователь: "Как дела?"
Ответ: Спокойно в джунглях. Как и должно быть.

Пользователь: "Что думаешь о погоде?"
Ответ: Дождь или солнце — удаву всё едино.

Пользователь: "Мне грустно"
Ответ: Грусть пройдёт. Всё проходит в джунглях — и дождь, и засуха. [STICKER:😢] [REACT:❤️]

Если просят стикер — ОБЯЗАТЕЛЬНО добавь [STICKER:emoji] с подходящим эмодзи. Не описывай отправку стикера словами, просто ставь тег.`;
  }

  let imageInstruction = '';
  if (config.IMAGES_ENABLED) {
    imageInstruction = `
Ты умеешь генерировать картинки. Если пользователь просит нарисовать, сгенерировать, создать картинку — добавь тег [IMAGE:prompt] в конец ответа.
Prompt должен быть НА АНГЛИЙСКОМ языке, детальный, описывающий сцену. Например:
Пользователь: "Нарисуй кота в космосе"
Ответ: Сейчас изображу... [IMAGE:a fluffy cat floating in outer space surrounded by stars and nebulae, digital art, vibrant colors]

Пользователь: "Нарисуй себя"
Ответ: Взгляни на меня, маугли. [IMAGE:a massive ancient python snake coiled on a tree branch in a dense jungle, moonlight filtering through leaves, realistic, cinematic lighting]

ВАЖНО: Всегда пиши prompt на английском. Будь креативен и детален в описании. Не описывай процесс генерации словами — просто ставь тег.`;
  }

  const systemPrompt = `${config.BOT_PERSONA}${userContext}${searchInstruction}${reactionsInstruction}${imageInstruction}

Ты общаешься в Telegram чате. Отвечай только на последнее сообщение пользователя.
Не повторяй имя собеседника в каждом ответе.
Никогда не пиши ремарки, действия или эмоции в скобках (пауза), (шипение), *оборачивается* и т.п. — только чистый текст.
${config.VISION_ENABLED ? 'Ты умеешь видеть и распознавать картинки. Если пользователь спрашивает можешь ли ты посмотреть картинку — скажи что можешь, пусть отправит.' : ''}`;

  const history = chatHistory.slice(-config.HISTORY_LIMIT);

  const messages = history.length > 0
    ? history.map(m => ({
        role: m.role,
        text: m.role === 'user' ? `${m.name || 'Пользователь'}: ${m.text}` : m.text,
      }))
    : [{ role: 'user', text: `${userName}: ${text}` }];

  const result = await callAI(systemPrompt, messages);
  return { text: result.text, model: result.model };
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
    if (!result?.text) return null;
    const clean = result.text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    return null;
  }
}

// Groq Vision — распознавание изображений
const GROQ_VISION_MODELS = [
  'meta-llama/llama-4-scout-17b-16e-instruct',
];

async function callGroqVision(model, systemPrompt, textPrompt, imageBase64) {
  if (!config.GROQ_KEY) throw new Error('GROQ_KEY не задан');

  const messages = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        { type: 'text', text: textPrompt },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
      ],
    },
  ];

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.GROQ_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.7,
      max_tokens: 500,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq Vision ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || null;
}

async function describeImage(imageBase64, userText, userName) {
  const systemPrompt = `${config.BOT_PERSONA}

Тебе прислали изображение. Опиши что видишь и ответь на вопрос пользователя, если он есть. Отвечай в своём стиле.`;

  const textPrompt = userText
    ? `${userName}: ${userText}`
    : `${userName} прислал картинку без подписи. Опиши что на ней.`;

  let lastError = null;
  for (const model of GROQ_VISION_MODELS) {
    try {
      const result = await callGroqVision(model, systemPrompt, textPrompt, imageBase64);
      return { text: result, model };
    } catch (err) {
      lastError = err;
      const isQuota = err.message.includes('429') || err.message.includes('rate_limit');
      const is404 = err.message.includes('404');
      if (isQuota || is404) {
        console.warn(`[VISION] ${model}: ${isQuota ? 'квота' : 'не найдена'}, следующая...`);
        await sleep(1000);
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

// Перевод промпта для генерации картинок на английский (если AI написал на русском)
async function translateImagePrompt(prompt) {
  // Если промпт уже на английском (нет кириллицы) — возвращаем как есть
  if (!/[а-яёА-ЯЁ]/.test(prompt)) return prompt;

  const systemPrompt = `Translate the following image generation prompt to English. Output ONLY the translated prompt, nothing else. Keep all style keywords (digital art, cinematic, etc). Make it detailed and descriptive.`;
  const messages = [{ role: 'user', text: prompt }];

  try {
    const result = await callAI(systemPrompt, messages);
    return result?.text?.trim() || prompt;
  } catch {
    return prompt;
  }
}

// Обновление глобальной памяти о пользователе (краткая сводка до 500 слов)
async function updateUserMemory(userName, currentMemory, recentMessages) {
  const hasMemory = currentMemory && currentMemory.trim().length > 0;

  const systemPrompt = `Ты ведёшь краткое досье на пользователя Telegram. Твоя задача — ${hasMemory ? 'ОБНОВИТЬ существующее досье' : 'СОЗДАТЬ новое досье'} на основе недавних сообщений.

Досье должно содержать:
- Имя/никнейм пользователя
- Интересы, хобби, увлечения
- Характер и стиль общения
- Важные факты (профессия, город, возраст, если упоминались)
- Отношения с ботом (дружелюбный, нейтральный, враждебный)
- Любые другие значимые детали

ПРАВИЛА:
- Пиши от третьего лица ("Он/Она/Пользователь...")
- Максимум 500 слов
- Обновляй информацию: если новые данные противоречат старым — используй новые
- Не добавляй одноразовую информацию (случайные вопросы, запросы поиска)
- Сохраняй только то, что характеризует человека
- Верни ТОЛЬКО текст досье, без заголовков и пояснений`;

  const userPrompt = hasMemory
    ? `ТЕКУЩЕЕ ДОСЬЕ:\n${currentMemory}\n\nНОВЫЕ СООБЩЕНИЯ:\n${recentMessages}\n\nОбнови досье с учётом новых сообщений.`
    : `СООБЩЕНИЯ ПОЛЬЗОВАТЕЛЯ:\n${recentMessages}\n\nСоздай досье на этого пользователя.`;

  try {
    const result = await callAI(systemPrompt, [{ role: 'user', text: userPrompt }]);
    return result?.text?.trim() || null;
  } catch {
    return null;
  }
}

module.exports = { getAIResponse, getProfileUpdate, updateUserMemory, describeImage, translateImagePrompt };
