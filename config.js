require('dotenv').config();

module.exports = {
  // Telegram
  BOT_TOKEN: process.env.BOT_TOKEN,
  ADMIN_ID: process.env.ADMIN_ID ? parseInt(process.env.ADMIN_ID) : null,

  // AI — Gemini (основной, бесплатный)
  GEMINI_KEY: process.env.GEMINI_KEY,
  GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-2.0-flash',

  // AI — OpenRouter (fallback, опциональный)
  OPENROUTER_KEY: process.env.OPENROUTER_KEY || null,

  // Персонаж
  BOT_NAME: process.env.BOT_NAME || 'Каа',
  BOT_TRIGGER: (process.env.BOT_TRIGGER || 'каа').toLowerCase(),
  BOT_PERSONA: process.env.BOT_PERSONA || `Ты — Удав Каа из джунглей. Мудрый, древний, спокойный. 
Говоришь медленно и весомо, иногда слегка растягиваешь слова (особенно "с" и "ш"). 
Видишь людей насквозь. Мудр и терпелив с теми кто уважителен. 
Холоден и безжалостен с теми кто заслужил. Никогда не злишься — просто констатируешь факты.
Отвечаешь кратко, без лишних слов. На русском языке.`,

  // Модули (включаются через .env)
  SEARCH_ENABLED: process.env.SEARCH === 'true',
  IMAGES_ENABLED: process.env.IMAGES === 'true',
  QUIZ_ENABLED: process.env.QUIZ === 'true',
  RPG_ENABLED: process.env.RPG === 'true',
  STATS_ENABLED: process.env.STATS === 'true',
  AUTO_REVIVE_ENABLED: process.env.AUTO_REVIVE === 'true',

  // Настройки
  HISTORY_LIMIT: parseInt(process.env.HISTORY_LIMIT) || 30,
  AUTO_REVIVE_HOURS: parseInt(process.env.AUTO_REVIVE_HOURS) || 3,
};
