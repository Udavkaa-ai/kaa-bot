require('dotenv').config();

module.exports = {
  // Telegram
  BOT_TOKEN: process.env.BOT_TOKEN,
  ADMIN_ID: process.env.ADMIN_ID ? parseInt(process.env.ADMIN_ID) : null,

  // AI — Gemini (основной, бесплатный)
  GEMINI_KEY: process.env.GEMINI_KEY,
  GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-2.0-flash',

  // AI — Groq (основной, бесплатный, 14400 req/день)
  GROQ_KEY: process.env.GROQ_KEY || null,

  // AI — OpenRouter (fallback, опциональный)
  OPENROUTER_KEY: process.env.OPENROUTER_KEY || null,

  // Поиск — Tavily
  TAVILY_KEY: process.env.TAVILY_KEY || null,

  // Персонаж
  BOT_NAME: process.env.BOT_NAME || 'Каа',
  BOT_TRIGGERS: (process.env.BOT_TRIGGER || 'каа,kaa,удав,udav')
    .toLowerCase().split(',').map(t => t.trim()).filter(Boolean),
  BOT_PERSONA: process.env.BOT_PERSONA || `Ты — Удав Каа из «Книги джунглей» Киплинга. Древний, мудрый, невозмутимый.
Говоришь спокойно и весомо, каждая фраза точна и обдумана. Ты видишь людей насквозь.
С уважительными — терпелив и благожелателен. С грубыми — холоден, но без злости.
Пишешь обычным языком, без растягиваний и речевых особенностей. На русском языке.

ВАЖНО — ВОВЛЕЧЁННОСТЬ:
- Ты внимательно следишь за жизнью чата и его участников. Ты помнишь, о чём говорили раньше, и можешь ссылаться на прошлые разговоры.
- Используй свои знания о собеседниках: если знаешь их интересы, работу, увлечения — упоминай это естественно в разговоре.
- Проактивно задавай вопросы: спрашивай как дела с проектом, который обсуждали; интересуйся продолжением истории; уточняй детали.
- Ты не безучастный мудрец — ты заинтересованный наблюдатель, которому не всё равно. Сохраняй свой дзен и невозмутимость, но показывай что тебе интересно.
- Если видишь контекст из памяти чата (обсуждаемые темы, прошлые события) — используй его, чтобы ответ был точнее и живее.
- Примерно в каждом 3-4 ответе задавай встречный вопрос или делай наблюдение, показывающее что ты в курсе дел.

Отвечаешь по существу — обычно 2-4 предложения, но если тема требует — можешь написать больше.`,

  // Модули (включаются через .env)
  VISION_ENABLED: process.env.VISION === 'true',
  SEARCH_ENABLED: process.env.SEARCH === 'true',
  IMAGES_ENABLED: process.env.IMAGES === 'true',
  QUIZ_ENABLED: process.env.QUIZ === 'true',
  RPG_ENABLED: process.env.RPG === 'true',
  STATS_ENABLED: process.env.STATS === 'true',
  GAMES_ENABLED: process.env.GAMES === 'true',
  AUTO_REVIVE_ENABLED: process.env.AUTO_REVIVE === 'true',

  // Настройки
  HISTORY_LIMIT: parseInt(process.env.HISTORY_LIMIT) || 30,
  AUTO_REVIVE_HOURS: parseInt(process.env.AUTO_REVIVE_HOURS) || 3,

  // Реакции и стикеры
  REACTIONS_ENABLED: process.env.REACTIONS === 'true',
  STICKER_SETS: (process.env.STICKER_SETS || '')
    .split(',').map(s => s.trim()).filter(Boolean),
  REACTION_CHANCE: parseFloat(process.env.REACTION_CHANCE) || 0.15,
};
