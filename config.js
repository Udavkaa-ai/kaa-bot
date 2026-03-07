require('dotenv').config();
const fs = require('fs');
const path = require('path');

// Загружаем персонажа из файла — основной способ задать характер бота.
// Файл persona.txt лежит рядом с config.js, редактируется как обычный текст.
function loadPersona() {
  const personaFile = path.join(__dirname, 'persona.txt');
  try {
    if (fs.existsSync(personaFile)) {
      const text = fs.readFileSync(personaFile, 'utf8').trim();
      if (text) return text;
    }
  } catch (err) {
    console.error('Ошибка чтения persona.txt:', err.message);
  }
  // Фоллбэк — дефолтный персонаж если файла нет
  return `Ты — Удав Каа из джунглей. Мудрый, древний, спокойный.
Говоришь медленно и весомо, иногда слегка растягиваешь слова (особенно "с" и "ш").
Видишь людей насквозь. Мудр и терпелив с теми кто уважителен.
Холоден и безжалостен с теми кто заслужил. Никогда не злишься — просто констатируешь факты.
Отвечаешь кратко, без лишних слов. На русском языке.`;
}

module.exports = {
  // Telegram
  BOT_TOKEN: process.env.BOT_TOKEN,
  ADMIN_ID: process.env.ADMIN_ID ? parseInt(process.env.ADMIN_ID) : null,
  BOT_ID: process.env.BOT_ID ? parseInt(process.env.BOT_ID) : null,

  // AI
  GEMINI_KEY: process.env.GEMINI_KEY,
  GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-2.0-flash',

  // Персонаж — имя и триггер в .env, характер в persona.txt
  BOT_NAME: process.env.BOT_NAME || 'Каа',
  BOT_TRIGGER: (process.env.BOT_TRIGGER || 'каа').toLowerCase(),
  BOT_PERSONA: loadPersona(),

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
