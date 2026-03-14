require('dotenv').config();

module.exports = {
  // Telegram
  BOT_TOKEN: process.env.BOT_TOKEN,
  ADMIN_ID: process.env.ADMIN_ID ? parseInt(process.env.ADMIN_ID) : null,

  // AI — OpenRouter (основной провайдер)
  OPENROUTER_KEY: process.env.OPENROUTER_KEY || null,

  // Поиск — Tavily
  TAVILY_KEY: process.env.TAVILY_KEY || null,

  // Имя и триггеры бота
  BOT_NAME: process.env.BOT_NAME || 'Билли',
  BOT_TRIGGERS: (process.env.BOT_TRIGGER || 'билли,billy')
    .toLowerCase().split(',').map(t => t.trim()).filter(Boolean),

  // Fallback-персона (используется если персона не назначена — быть не должно)
  BOT_PERSONA: process.env.BOT_PERSONA || `Ты — умный и живой собеседник. Отвечай естественно, кратко и по делу. На русском языке.`,

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
