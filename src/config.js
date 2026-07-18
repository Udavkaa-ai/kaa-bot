require('dotenv').config();
const pkg = require('../package.json');

function collectKeys(prefix) {
  const keys = [];
  if (process.env[prefix]) keys.push(process.env[prefix]);
  let i = 2;
  while (process.env[`${prefix}_${i}`]) {
    keys.push(process.env[`${prefix}_${i}`]);
    i++;
  }
  return keys;
}

// Google убрал старые модели — заменяем на живой аналог, чтобы не было 404 на старте.
function upgradeLegacyGeminiModel(name) {
  if (!name) return null;
  const dead = /^gemini-(1\.5|2\.0)-(flash|pro)(-\w+)?$/i;
  if (dead.test(name)) {
    console.warn(`[CONFIG] Модель ${name} снята с обслуживания, использую gemini-2.5-flash`);
    return 'gemini-2.5-flash';
  }
  return name;
}

const geminiKeys = collectKeys('GEMINI_KEY');
const openrouterKeys = collectKeys('OPENROUTER_KEY');

const config = {
  version: pkg.version,

  // Telegram
  botToken: process.env.BOT_TOKEN,
  adminId: process.env.ADMIN_ID ? parseInt(process.env.ADMIN_ID, 10) : null,
  botName: process.env.BOT_NAME || 'Дух',
  botTriggers: (process.env.BOT_TRIGGER || 'дух,духи,духа,духу,spirit,duh')
    .toLowerCase().split(',').map(s => s.trim()).filter(Boolean),

  // БД
  databaseUrl: process.env.DATABASE_URL,

  // Claude через OpenRouter
  openrouterKeys,
  claudeModel: process.env.CLAUDE_MODEL || 'anthropic/claude-sonnet-4.6',
  fallbackModels: (process.env.FALLBACK_MODELS ||
    'google/gemini-2.5-flash,meta-llama/llama-3.3-70b-instruct:free')
    .split(',').map(s => s.trim()).filter(Boolean),

  // Gemini
  geminiKeys,
  // Легаси-имена gemini-1.5-* / gemini-2.0-* Google отключил — тихо апгрейдим.
  geminiVisionModel: upgradeLegacyGeminiModel(process.env.GEMINI_VISION_MODEL) || 'gemini-2.5-flash',
  geminiAudioModel: upgradeLegacyGeminiModel(process.env.GEMINI_AUDIO_MODEL) || 'gemini-2.5-flash',
  geminiEmbedModel: process.env.GEMINI_EMBED_MODEL || 'text-embedding-004',
  embedDim: 768,

  // STT
  groqKey: process.env.GROQ_KEY,
  groqSttModel: process.env.GROQ_STT_MODEL || 'whisper-large-v3-turbo',

  // Поиск
  tavilyKey: process.env.TAVILY_KEY,
  perplexityModel: process.env.PERPLEXITY_MODEL || 'perplexity/sonar',
  searchProvider: process.env.SEARCH_PROVIDER || 'tavily',
  searchEnabled: process.env.SEARCH !== 'false',

  // Картинки
  imagesEnabled: process.env.IMAGES === 'true',
  imagegenProvider: process.env.IMAGEGEN_PROVIDER || 'pollinations',

  // Модули
  visionEnabled: process.env.VISION !== 'false',
  voiceEnabled: process.env.VOICE !== 'false',
  audioEnabled: process.env.AUDIO !== 'false',
  reactionsEnabled: process.env.REACTIONS === 'true',
  autoReviveEnabled: process.env.AUTO_REVIVE === 'true',
  autoReviveHours: parseInt(process.env.AUTO_REVIVE_HOURS, 10) || 3,
  banEnabled: process.env.BAN_ENABLED !== 'false',

  // Поведение
  historyLimit: parseInt(process.env.HISTORY_LIMIT, 10) || 30,
  promptCache: process.env.PROMPT_CACHE !== 'false',
  privateChatAdminOnly: process.env.PRIVATE_CHAT_ADMIN_ONLY === 'true',
  adminMustBeInGroup: process.env.ADMIN_MUST_BE_IN_GROUP === 'true',
  typingDelay: parseInt(process.env.TYPING_DELAY_MS, 10) || 600,
  semanticRecallK: parseInt(process.env.SEMANTIC_RECALL_K, 10) || 5,

  // Mini-app (eyeball game)
  webappPort: parseInt(process.env.PORT, 10) || 3000,
  eyeballAppShortName: process.env.EYEBALL_APP || 'eyeball',
  botUsername: null,
};

// Базовая валидация
const missing = [];
if (!config.botToken) missing.push('BOT_TOKEN');
if (!config.databaseUrl) missing.push('DATABASE_URL');
if (config.openrouterKeys.length === 0) missing.push('OPENROUTER_KEY');

if (missing.length > 0) {
  console.error(`[CONFIG] Не заданы обязательные переменные: ${missing.join(', ')}`);
  process.exit(1);
}

console.log(`[CONFIG] kaa-bot v${config.version}`);
console.log(`[CONFIG] Claude: ${config.claudeModel} (${openrouterKeys.length} ключей)`);
console.log(`[CONFIG] Gemini: ${geminiKeys.length} ключей`);
console.log(`[CONFIG] Модули: vision=${config.visionEnabled} voice=${config.voiceEnabled} audio=${config.audioEnabled} search=${config.searchEnabled} images=${config.imagesEnabled}`);

if (geminiKeys.length === 0) {
  console.warn('[CONFIG] GEMINI_KEY не задан — vision/audio/embeddings отключатся');
}
if (!config.groqKey) {
  console.warn('[CONFIG] GROQ_KEY не задан — распознавание голоса отключено');
}

module.exports = config;
