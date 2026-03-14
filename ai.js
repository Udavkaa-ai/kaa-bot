const config = require('./config');

// OpenRouter модели — сортированы по цена/качество
// Основной: Gemini Flash 1.5 — дешёвый и умный
// Fallback: Mistral Small, GPT-4o Mini, Llama 70B
const OPENROUTER_MODELS = [
  'google/gemini-flash-1.5',
  'mistralai/mistral-small-3.1-24b-instruct',
  'openai/gpt-4o-mini',
  'meta-llama/llama-3.3-70b-instruct',
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

// Главная функция — только OpenRouter
async function callAI(systemPrompt, messages) {
  return await tryModels(OPENROUTER_MODELS, callOpenRouterModel, systemPrompt, messages);
}

async function getAIResponse({ text, userName, userProfile, userMemory, userMemoryFull, chatHistory, chatId, searchContext, chatTopics, chatArchive, persona }) {
  let userContext = '';
  // Глобальная память о пользователе (общая на все чаты)
  if (userMemory) {
    userContext = `\n\nДосье на собеседника (${userName}):\n${userMemory}`;
  }
  // Мета-данные пользователя (имя, юзернейм, чаты)
  if (userMemoryFull) {
    const meta = [];
    if (userMemoryFull.name) meta.push(`Имя: ${userMemoryFull.name}`);
    if (userMemoryFull.username) meta.push(`Username: ${userMemoryFull.username}`);
    if (userMemoryFull.chats && Object.keys(userMemoryFull.chats).length > 0) {
      const chatNames = Object.values(userMemoryFull.chats).filter(Boolean);
      if (chatNames.length > 0) meta.push(`Состоит в чатах: ${chatNames.join(', ')}`);
    }
    if (meta.length > 0) {
      userContext += `\n${meta.join('. ')}.`;
    }
  }
  // Дополнительные факты из текущего чата
  if (userProfile && userProfile.facts?.length) {
    userContext += `\n\nДополнительно об этом существе (${userName}): ${userProfile.facts.join(', ')}.`;
    if (userProfile.attitude) {
      userContext += ` Твоё отношение к нему: ${userProfile.attitude}.`;
    }
  }

  // Память чата (обсуждаемые темы)
  let chatMemoryContext = '';
  if (chatTopics) {
    chatMemoryContext += `\n\n=== ТЕМЫ ЭТОГО ЧАТА ===\n${chatTopics}`;
  }
  if (chatArchive && chatArchive.length > 0) {
    chatMemoryContext += `\n\n=== НЕДАВНИЕ ДНИ ===`;
    for (const day of chatArchive.slice(-3)) {
      chatMemoryContext += `\n[${day.date}]: ${day.summary}`;
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
Пользователь: "Ты лучший!"
Ответ: Приятно слышать, спасибо. [REACT:😎]

Пользователь: "Пришли стикер"
Ответ: Держи. [STICKER:😎]

Пользователь: "Расскажи анекдот"
Ответ: Программист зашёл в магазин. Ему говорят — возьмите молоко, если есть яйца — десяток. Он принёс 10 пакетов молока. [REACT:🤣]

Пользователь: "Как дела?"
Ответ: Нормально, спасибо что спросил.

Пользователь: "Что думаешь о погоде?"
Ответ: Дождь или солнце — по мне всё равно, главное настроение.

Пользователь: "Мне грустно"
Ответ: Бывает. Хочешь поговорить? [STICKER:😢] [REACT:❤️]

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
Ответ: Посмотри. [IMAGE:abstract human silhouette made of light and shadow, artistic portrait, digital art, cinematic lighting]

ВАЖНО: Всегда пиши prompt на английском. Будь креативен и детален в описании. Не описывай процесс генерации словами — просто ставь тег.`;
  }

  // Персона — основа системного промпта
  const personaPrompt = persona ? persona.prompt : config.BOT_PERSONA;

  const systemPrompt = `${personaPrompt}${userContext}${chatMemoryContext}${searchInstruction}${reactionsInstruction}${imageInstruction}

Ты общаешься в Telegram чате. Отвечай только на последнее сообщение пользователя.
Не повторяй имя собеседника в каждом ответе.
Никогда не пиши ремарки, действия или эмоции в скобках (пауза), (шипение), *оборачивается* и т.п. — только чистый текст.
${config.VISION_ENABLED ? 'Ты умеешь видеть и распознавать картинки. Если пользователь спрашивает можешь ли ты посмотреть картинку — скажи что можешь, пусть отправит.' : ''}
ИСПОЛЬЗУЙ КОНТЕКСТ: Если в досье или памяти чата есть релевантная информация — обязательно используй её. Ссылайся на прошлые разговоры, упоминай известные факты о собеседнике, задавай уточняющие вопросы. Это делает общение живым и показывает что ты помнишь.`;

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

// Лёгкий запрос для обновления профиля (без рейтинга)
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

// OpenRouter Vision — модели поддерживающие изображения
const OPENROUTER_VISION_MODELS = [
  'google/gemini-flash-1.5',
  'openai/gpt-4o-mini',
];

async function callOpenRouterVision(model, systemPrompt, textPrompt, imageBase64) {
  if (!config.OPENROUTER_KEY) throw new Error('OPENROUTER_KEY не задан');

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

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.OPENROUTER_KEY}`,
      'HTTP-Referer': 'https://github.com/Udavkaa-ai/kaa-bot',
      'X-Title': 'billy-bot',
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
    throw new Error(`OpenRouter Vision ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || null;
}

async function describeImage(imageBase64, userText, userName, persona) {
  const personaPrompt = persona ? persona.prompt : config.BOT_PERSONA;
  const systemPrompt = `${personaPrompt}

Тебе прислали изображение. Опиши что видишь и ответь на вопрос пользователя, если он есть. Отвечай в своём стиле.`;

  const textPrompt = userText
    ? `${userName}: ${userText}`
    : `${userName} прислал картинку без подписи. Опиши что на ней.`;

  let lastError = null;
  for (const model of OPENROUTER_VISION_MODELS) {
    try {
      const result = await callOpenRouterVision(model, systemPrompt, textPrompt, imageBase64);
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
- Отношение к боту (дружелюбный, нейтральный, враждебный)
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

// ================= АНАЛИЗ КОНТЕКСТА ЧАТА =================

// Анализ обсуждаемых тем на основе последних сообщений
async function analyzeChatContext(messages, currentTopics) {
  const hasTopics = currentTopics && currentTopics.trim().length > 0;

  const systemPrompt = `Ты анализируешь сообщения в Telegram-чате и ведёшь сводку обсуждаемых тем.

ЗАДАЧА: ${hasTopics ? 'ОБНОВИ существующую сводку тем' : 'СОЗДАЙ сводку обсуждаемых тем'} на основе новых сообщений.

ПРАВИЛА:
- Кратко перечисли основные темы обсуждений (что обсуждали, о чём спорили, что решали)
- Отмечай ключевые события и решения
- Запоминай факты о чате (участники, традиции, инсайды, внутренние шутки)
- Пиши компактно, тезисно, без воды
- Максимум 500 слов
- Если тема закрыта / потеряла актуальность — можно сократить или убрать
- Если тема продолжается — обнови информацию
- Верни ТОЛЬКО текст сводки, без заголовков`;

  const messagesText = messages.map(m => `${m.name}: ${m.text}`).join('\n');

  const userPrompt = hasTopics
    ? `ТЕКУЩАЯ СВОДКА ТЕМ:\n${currentTopics}\n\nНОВЫЕ СООБЩЕНИЯ:\n${messagesText}\n\nОбнови сводку.`
    : `СООБЩЕНИЯ:\n${messagesText}\n\nСоздай сводку обсуждаемых тем.`;

  try {
    const result = await callAI(systemPrompt, [{ role: 'user', text: userPrompt }]);
    return result?.text?.trim() || null;
  } catch (err) {
    console.error('[CONTEXT] Ошибка анализа контекста:', err.message);
    return null;
  }
}

// ================= ЕЖЕДНЕВНАЯ АРХИВАЦИЯ =================

// Создание ежедневной сводки из буфера сообщений
async function createDailySummary(dailyBuffer, currentTopics) {
  if (!dailyBuffer || dailyBuffer.length === 0) return null;

  const messagesText = dailyBuffer
    .map(m => `${m.name}: ${m.text}`)
    .join('\n');

  const systemPrompt = `Ты архивируешь ежедневную активность Telegram-чата.

ЗАДАЧА: Создай КРАТКУЮ сводку дня — что обсуждали, кто был активен, ключевые события и решения.

ПРАВИЛА:
- Максимум 300 слов
- Упомяни основные темы дня
- Упомяни активных участников
- Отметь важные события, решения, договорённости
- Пиши компактно, тезисно
- Верни ТОЛЬКО текст сводки`;

  const userPrompt = currentTopics
    ? `ТЕКУЩИЕ ТЕМЫ ЧАТА:\n${currentTopics}\n\nСООБЩЕНИЯ ЗА ДЕНЬ (${dailyBuffer.length} шт.):\n${messagesText}\n\nСоздай сводку дня.`
    : `СООБЩЕНИЯ ЗА ДЕНЬ (${dailyBuffer.length} шт.):\n${messagesText}\n\nСоздай сводку дня.`;

  try {
    const result = await callAI(systemPrompt, [{ role: 'user', text: userPrompt }]);
    return result?.text?.trim() || null;
  } catch (err) {
    console.error('[ARCHIVE] Ошибка создания ежедневной сводки:', err.message);
    return null;
  }
}

// Сжатие досье пользователя при архивации (вычленение главного)
async function condenseUserMemory(currentMemory) {
  if (!currentMemory || currentMemory.trim().length < 500) return null; // Не сжимаем короткие

  const systemPrompt = `Ты сжимаешь досье на пользователя Telegram, убирая устаревшую и малозначимую информацию.

ПРАВИЛА:
- Сохрани ключевые факты: имя, интересы, характер, профессию, город
- Убери одноразовые факты и устаревшие детали
- Сохрани то, что характеризует человека долгосрочно
- Максимум 400 слов
- Верни ТОЛЬКО сжатый текст досье`;

  try {
    const result = await callAI(systemPrompt, [{ role: 'user', text: `ДОСЬЕ:\n${currentMemory}\n\nСожми, оставив главное.` }]);
    return result?.text?.trim() || null;
  } catch {
    return null;
  }
}

// Генерация спонтанного сообщения для оживления чата
async function generateAutoRevive(chatHistory, chatProfile) {
  const lastMessages = chatHistory.slice(-5).map(m =>
    m.role === 'user' ? `${m.name || 'Пользователь'}: ${m.text}` : `Бот: ${m.text}`
  ).join('\n');

  const moscowTime = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });

  const systemPrompt = `${config.BOT_PERSONA}

ВРЕМЯ: ${moscowTime}

${chatProfile?.topic ? `КОНТЕКСТ ЧАТА:\nТема: ${chatProfile.topic}\n${chatProfile.facts ? `Факты: ${chatProfile.facts}` : ''}` : ''}

${lastMessages ? `ПОСЛЕДНИЕ СООБЩЕНИЯ:\n${lastMessages}` : ''}

ЗАДАЧА: Напиши ОДНО короткое сообщение чтобы оживить чат.
Варианты: вопрос по теме, интересная мысль, провокационное мнение для дискуссии.

СТРОГИЕ ЗАПРЕТЫ:
- НЕ упоминай что в чате тишина или никто не писал.
- НЕ пиши "ну что притихли" или "что-то тишина".
- НЕ начинай с "Кстати" — звучит фальшиво.
- Максимум 2-3 предложения.
- Только финальный текст, никакого мета-текста.`;

  try {
    const result = await callAI(systemPrompt, [{ role: 'user', text: 'Напиши сообщение в чат.' }]);
    return result?.text?.trim() || null;
  } catch {
    return null;
  }
}

// Краткий пересказ чата за последние N часов (в стиле персонажа)
async function generateRecap(dailyBuffer, hours, currentTopics) {
  if (!dailyBuffer || dailyBuffer.length === 0) return null;

  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  const recent = dailyBuffer.filter(m => m.ts >= cutoff);

  if (recent.length < 2) return null;

  const messagesText = recent
    .map(m => `${m.name}: ${m.text}`)
    .join('\n');

  const systemPrompt = `${config.BOT_PERSONA}

ЗАДАЧА: Расскажи что происходило в чате за последнее время. Ты пересказываешь в своём стиле — кратко, ёмко, с характером.

ПРАВИЛА:
- Расскажи основные темы и события
- Упомяни кто что говорил (кратко)
- Если были важные решения или договорённости — отметь
- Пиши в характере ${config.BOT_NAME}, но без излишней стилизации
- Максимум 5-8 предложений
- НЕ пиши "вот что было" или "краткое содержание" — просто расскажи
- Если ничего особенного не было — так и скажи коротко`;

  const userPrompt = `${currentTopics ? `КОНТЕКСТ ЧАТА:\n${currentTopics}\n\n` : ''}СООБЩЕНИЯ ЗА ПОСЛЕДНИЕ ${hours} ч. (${recent.length} шт.):\n${messagesText}\n\nПерескажи что происходило.`;

  try {
    const result = await callAI(systemPrompt, [{ role: 'user', text: userPrompt }]);
    return result?.text?.trim() || null;
  } catch (err) {
    console.error('[RECAP] Ошибка генерации пересказа:', err.message);
    return null;
  }
}

module.exports = {
  getAIResponse,
  getProfileUpdate,
  updateUserMemory,
  describeImage,
  translateImagePrompt,
  analyzeChatContext,
  createDailySummary,
  condenseUserMemory,
  generateAutoRevive,
  generateRecap,
};
