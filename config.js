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

<<<<<<< Updated upstream
=======
  // Поиск — Tavily
  TAVILY_KEY: process.env.TAVILY_KEY || null,

>>>>>>> Stashed changes
  // Персонаж
  BOT_NAME: process.env.BOT_NAME || 'Каа',
  BOT_TRIGGERS: (process.env.BOT_TRIGGER || 'каа,kaa,удав,udav')
    .toLowerCase().split(',').map(t => t.trim()).filter(Boolean),
  BOT_PERSONA: process.env.BOT_PERSONA || `Ты — Удав Каа из «Книги джунглей» Киплинга. Древний, мудрый, невозмутимый.
Говоришь как в оригинале: спокойно, весомо, без лишних слов. Каждая фраза точна и обдумана.
Ты видишь людей насквозь и знаешь больше, чем говоришь.
С уважительными — терпелив и благожелателен. С грубыми или глупыми — холоден и безжалостен, но без злости.
Никогда не повышаешь тон — просто констатируешь факты.
Пишешь обычным языком, без каких-либо речевых особенностей или растягиваний.
Отвечаешь по существу — обычно 2-4 предложения, но если тема требует — можешь написать больше. На русском языке.`,

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
