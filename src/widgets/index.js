'use strict';

const config = require('../config');
const repo = require('../db/repo/widgets');
const { createWidgetApi, createWidgetPoller } = require('./api');
const { createDiceService } = require('./dice');

const api = createWidgetApi({
  token: config.widgetBotToken,
  baseUrl: config.widgetApiBase,
  testEnv: true,
});
const dice = createDiceService({ api, repo });

async function onMessage(message) {
  const text = String(message.text || '').trim();
  const command = text.split(/\s+/)[0].split('@')[0].toLowerCase();
  if (['/dice', '/widget', '/кубик'].includes(command)) {
    await dice.sendDice(message.chat.id);
  } else if (command === '/start' || command === '/help') {
    await api.call('sendMessage', {
      chat_id: message.chat.id,
      text: 'Кубик Билли: /dice, /widget или /кубик. Результат броска виден только нажавшему, а общий счётчик обновляется в том же сообщении.',
    });
  }
}

const poller = createWidgetPoller({ api, onQuery: dice.handleQuery, onMessage });

function start() {
  if (!config.widgetsEnabled) return;
  poller.start();
  console.log('[WIDGETS] Bot API 10.4 beta/test polling enabled');
}

function stop() {
  poller.stop();
}

module.exports = { start, stop, sendDice: dice.sendDice, handleQuery: dice.handleQuery };
