// Тонкий адаптер Koleya под стек «Билли»: Express + node-telegram-bot-api + Postgres.
// «Билли» делает ровно три вещи: koleya.setBot(bot), koleya.mount(app) и
// вызывает koleya.handleCommand(bot, msg) на команду /koleya. Вся логика — здесь и в koleya/.
'use strict';

const { createKoleya } = require('./core');
const { mountHttp } = require('./http');

const billyConfig = require('../src/config');
const billyDb = require('../src/db/pool');

const APP_SHORT_NAME = process.env.KOLEYA_APP || 'koleya';

let botRef = null;
let core = null;

function publicUrl() {
  const raw = process.env.KOLEYA_PUBLIC_URL || process.env.PUBLIC_URL
    || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '');
  return raw ? raw.replace(/\/+$/, '') : null;
}

function directLink() {
  return billyConfig.botUsername ? `https://t.me/${billyConfig.botUsername}/${APP_SHORT_NAME}` : null;
}

// Кнопка «Открыть игру»: в личке — web_app (открывает прямо в Telegram), иначе — Direct Link
function openButton(isPrivate) {
  const base = publicUrl();
  if (isPrivate && base) return { text: '🚂 Открыть игру', web_app: { url: `${base}/koleya/` } };
  const link = directLink();
  return link ? { text: '🚂 Открыть игру', url: link } : null;
}

function getCore() {
  if (!core) {
    core = createKoleya({
      botToken: billyConfig.botToken,
      db: billyDb,
      notify: async (tgId, text, opts = {}) => {
        if (!botRef) return;
        const btn = opts.button === 'open_game' ? openButton(true) : null;
        await botRef.sendMessage(tgId, text, btn ? { reply_markup: { inline_keyboard: [[btn]] } } : {});
      },
      log: (msg, meta) => console.error('[KOLEYA]', msg, meta?.message || '', meta?.stack || ''),
    });
  }
  return core;
}

function setBot(bot) { botRef = bot; }

function mount(app) {
  const c = getCore();
  c.migrate().then(() => console.log('[KOLEYA] таблицы готовы')).catch(err => console.error('[KOLEYA] миграция:', err.message));

  mountHttp(app, c);
}

async function handleCommand(bot, msg) {
  const chatId = msg.chat.id;
  const isPrivate = msg.chat.type === 'private';
  const progress = msg.from ? await getCore().progressText(msg.from.id) : null;
  const lines = [
    '🚂 «Пять футов» — историческая стратегия о первых русских железных дорогах.',
    'Вы — главный инженер: трасса, колея, артели, мосты и сроки. Ход — один сезон. В конце главы — «как было на самом деле» и викторина.',
    'Пролог: Царскосельская дорога (1836–1838). Глава I: Петербург — Москва (1842–1851).',
  ];
  if (progress) lines.push('', `Ваша игра: ${progress}`);
  const btn = openButton(isPrivate);
  if (!btn) lines.push('', 'Мини-приложение ещё не подключено: владельцу бота нужно зарегистрировать его в BotFather (/newapp, короткое имя koleya).');
  else if (!isPrivate) lines.push('', 'Игра одиночная и сохраняется за вами — можно открывать и из лички со мной.');
  await bot.sendMessage(chatId, lines.join('\n'), {
    reply_to_message_id: msg.message_id,
    ...(btn ? { reply_markup: { inline_keyboard: [[btn]] } } : {}),
  });
  return true;
}

module.exports = { setBot, mount, handleCommand, APP_SHORT_NAME };
