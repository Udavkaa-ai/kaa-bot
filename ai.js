const config = require('./config');
const prompts = require('./prompts');

const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${config.GEMINI_MODEL}:generateContent?key=${config.GEMINI_KEY}`;

async function callGemini(systemPrompt, messages) {
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

  const res = await fetch(GEMINI_URL, {
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

// Смешные ответы на ошибки API
function getErrorReply(errText) {
  const error = (errText || '').toLowerCase();

  if (error.includes('prohibited') || error.includes('safety') || error.includes('blocked') || error.includes('policy')) {
    const phrases = [
      'Гугл включил моралиста и зацензурил мой ответ. Сорян.',
      'Нейронка отказалась это генерить. Слишком грязно даже для меня.',
      'Цензура подъехала. Попробуй спросить помягче.',
    ];
    return phrases[Math.floor(Math.random() * phrases.length)];
  }

  if (error.includes('503') || error.includes('overloaded') || error.includes('unavailable') || error.includes('timeout')) {
    const phrases = [
      'У Гугла сервера плавятся. Подожди минуту, пусть остынут.',
      'Нейронка устала. Пишет «Service Unavailable». Дай ей перекур.',
      'Гугл тупит, 503-я ошибка. Китайцы опять все видеокарты заняли.',
    ];
    return phrases[Math.floor(Math.random() * phrases.length)];
  }

  if (error.includes('429') || error.includes('quota') || error.includes('exhausted')) {
    const phrases = [
      'Лимиты всё. Слишком много болтаем, Гугл перекрыл краник.',
      'Ошибка 429 — слишком быстро отвечаю, меня притормозили.',
      'Квота всё. Гугл сказал «хватит болтать». Попробуй позже.',
    ];
    return phrases[Math.floor(Math.random() * phrases.length)];
  }

  const phrases = [
    'Шестерёнки встали. Какая-то дичь в коде.',
    'Поймал баг. Уже чиним.',
    'Что-то пошло не так. Попробуй ещё раз.',
  ];
  return phrases[Math.floor(Math.random() * phrases.length)];
}

function getCurrentTime() {
  return new Date().toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    weekday: 'short',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function getAIResponse({ text, userName, userProfile, chatHistory, chatId, chatProfile }) {
  let personalInfo = '';
  if (userProfile) {
    const facts = userProfile.facts?.length ? userProfile.facts.join(', ') : null;
    const r = userProfile.relationship ?? 50;
    const relationText = r >= 80 ? 'СТАТУС: Заслужил уважение.'
      : r <= 20 ? 'СТАТУС: Не заслуживает доверия.'
      : 'СТАТУС: Нейтрально.';
    if (facts) personalInfo += `\n--- ДОСЬЕ ---\nФакты: ${facts}\n${relationText}\n-----------------\n`;
    else personalInfo += `\n--- ДОСЬЕ ---\n${relationText}\n-----------------\n`;
  }

  const history = chatHistory.slice(-config.HISTORY_LIMIT);
  const contextStr = history
    .map(m => m.role === 'user' ? `${m.name || 'Пользователь'}: ${m.text}` : `${config.BOT_NAME}: ${m.text}`)
    .join('\n');

  const promptText = prompts.mainChat({
    time: getCurrentTime(),
    isSpontaneous: false,
    senderName: userName,
    userMessage: text,
    history: contextStr,
    personalInfo,
    chatContext: chatProfile || null,
    replyContext: '',
  });

  return await callGemini(config.BOT_PERSONA, [{ role: 'user', text: promptText }]);
}

// Анализ репутации после каждого ответа бота
async function analyzeUserImmediate(lastMessages, userProfile) {
  const promptText = prompts.analyzeImmediate(userProfile, lastMessages);
  try {
    const result = await callGemini('Ты — аналитик данных. Возвращай только JSON без пояснений.', [{ role: 'user', text: promptText }]);
    if (!result) return null;
    const clean = result.replace(/```json|```/g, '').trim();
    const first = clean.indexOf('{'), last = clean.lastIndexOf('}');
    if (first === -1 || last === -1) return null;
    return JSON.parse(clean.substring(first, last + 1));
  } catch { return null; }
}

// Batch-анализ профилей (один запрос на 20 сообщений)
async function analyzeBatch(messagesBatch, currentProfiles) {
  const chatLog = messagesBatch.map(m => `[ID:${m.userId}] ${m.name}: ${m.text}`).join('\n');
  const knownInfo = Object.entries(currentProfiles)
    .map(([uid, p]) => `ID:${uid} -> факты: ${(p.facts || []).join(', ')}, отношение: ${p.attitude}, репутация: ${p.relationship}`)
    .join('\n');

  const promptText = prompts.analyzeBatch(knownInfo || 'Ничего', chatLog);
  try {
    const result = await callGemini('Ты — архивариус базы данных. Возвращай только JSON без пояснений.', [{ role: 'user', text: promptText }]);
    if (!result) return null;
    const clean = result.replace(/```json|```/g, '').trim();
    const first = clean.indexOf('{'), last = clean.lastIndexOf('}');
    if (first === -1 || last === -1) return null;
    return JSON.parse(clean.substring(first, last + 1));
  } catch { return null; }
}

// Генерация сообщения для auto-revive
async function generateAutoRevive(chatHistory, chatProfile) {
  const lastMessages = (chatHistory || []).slice(-10).map(m => `${m.name || m.role}: ${m.text}`).join('\n');
  const promptText = prompts.autoRevive({ time: getCurrentTime(), chatContext: chatProfile || null, lastMessages });
  try {
    return await callGemini(config.BOT_PERSONA, [{ role: 'user', text: promptText }]);
  } catch { return null; }
}

// Реакция эмодзи (1.5% случайно)
async function determineReaction(contextText) {
  const allowed = ['👍','👎','❤','🔥','🤔','🤯','😱','😢','🎉','🤡','🥱','😍','💯','🤣','⚡','🏆','💔','😐','😎','👀','🗿','🆒','😘','🙈','😇','😨','🤝','🫡'];
  const promptText = prompts.reaction(contextText, allowed.join(' '));
  try {
    const result = await callGemini('Ты анализируешь диалог. Верни только один эмодзи или NULL.', [{ role: 'user', text: promptText }]);
    if (!result) return null;
    const match = result.match(/(\p{Emoji_Presentation}|\p{Extended_Pictographic})/u);
    return (match && allowed.includes(match[0])) ? match[0] : null;
  } catch { return null; }
}

// Досье на пользователя
async function generateProfileDescription(profileData, targetName) {
  const promptText = prompts.profileDescription(targetName, profileData);
  try {
    return await callGemini(config.BOT_PERSONA, [{ role: 'user', text: promptText }]);
  } catch { return 'Не знаю такого существа.'; }
}

// Flavor text для монетки/рандома/кто из нас
async function generateFlavorText(task, result) {
  const promptText = prompts.flavor(task, result);
  try {
    const res = await callGemini(config.BOT_PERSONA, [{ role: 'user', text: promptText }]);
    return res ? res.trim().replace(/^["']|["']$/g, '') : result;
  } catch { return result; }
}

module.exports = {
  getAIResponse,
  analyzeUserImmediate,
  analyzeBatch,
  generateAutoRevive,
  determineReaction,
  generateProfileDescription,
  generateFlavorText,
  getErrorReply,
};

// Анализ профиля чата (каждые 50 сообщений)
async function analyzeChatProfile(messagesBatch, currentProfile) {
  const messagesText = messagesBatch.map(m => `${m.name}: ${m.text}`).join('\n');
  const { analyzeChatProfile: prompt } = require('./prompts');
  const promptText = prompt(currentProfile, messagesText);
  try {
    const result = await callGemini('Ты — аналитик контекста чатов. Возвращай только JSON без пояснений.', [{ role: 'user', text: promptText }]);
    if (!result) return null;
    const clean = result.replace(/```json|```/g, '').trim();
    const first = clean.indexOf('{'), last = clean.lastIndexOf('}');
    if (first === -1 || last === -1) return null;
    return JSON.parse(clean.substring(first, last + 1));
  } catch { return null; }
}

module.exports.analyzeChatProfile = analyzeChatProfile;
