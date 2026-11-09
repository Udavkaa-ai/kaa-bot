'use strict';

const config = require('../config');
const usersRepo = require('../db/repo/users');
const { getPersonaById } = require('../ai/personas');
const { buildPersonaKeyboard } = require('../handlers/persona');
const { moscowToday } = require('../utils/time');
const { createWidgetApi, createWidgetPoller } = require('./api');
const { createDiceService } = require('./dice');

const api = createWidgetApi({
  token: config.widgetBotToken,
  baseUrl: config.widgetApiBase,
  testEnv: true,
});
const dice = createDiceService({ api });

async function onMessage(message) {
  const text = String(message.text || '').trim();
  const command = text.split(/\s+/)[0].split('@')[0].toLowerCase();
  if (command === '/d10') {
    await dice.sendDice(message.chat.id);
  } else if (command === '/persona') {
    await api.call('sendMessage', {
      chat_id: message.chat.id,
      text: 'Выбери личность на сегодня. «🎲 Случайный» запустит интерактивный D10.',
      reply_to_message_id: message.message_id,
      reply_markup: { inline_keyboard: buildPersonaKeyboard() },
    });
  } else if (command === '/start' || command === '/help') {
    await api.call('sendMessage', {
      chat_id: message.chat.id,
      text: 'D10 «Личность дня»: отправь /d10 или нажми «🎲 Случайный» в меню /persona. Результат виден только тебе; повторный бросок не меняет личность.',
    });
  }
}

async function onCallback(callback) {
  const chatId = callback.message?.chat?.id;
  const userId = callback.from?.id;
  if (!chatId || !userId) return;
  const match = /^persona:(random|[a-z]+)$/.exec(String(callback.data || ''));
  if (!match) {
    await api.call('answerCallbackQuery', { callback_query_id: callback.id });
    return;
  }
  if (match[1] === 'random') {
    await api.call('answerCallbackQuery', {
      callback_query_id: callback.id,
      text: 'Запускаем D10…',
    });
    await dice.sendDice(chatId);
    return;
  }
  const persona = getPersonaById(match[1]);
  if (!persona) {
    await api.call('answerCallbackQuery', { callback_query_id: callback.id, text: 'Личность не найдена' });
    return;
  }
  await usersRepo.setUserPersona(userId, chatId, persona.id, moscowToday());
  await api.call('answerCallbackQuery', {
    callback_query_id: callback.id,
    text: `${persona.name} — твоя личность до 00:00 МСК`,
  });
}

const poller = createWidgetPoller({ api, onQuery: dice.handleQuery, onMessage, onCallback });

function start() {
  if (!config.widgetsEnabled) return;
  poller.start();
  console.log('[WIDGETS] Bot API 10.4 beta/test polling enabled');
}

function stop() {
  poller.stop();
}

module.exports = { start, stop, sendDice: dice.sendDice, handleQuery: dice.handleQuery };
