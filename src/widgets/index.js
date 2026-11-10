'use strict';

const config = require('../config');
const { createWidgetApi, registerWidgetQueryHandler } = require('./api');
const { createDiceService } = require('./dice');

const api = createWidgetApi({ token: config.botToken });
const dice = createDiceService({ api });
let unregister = null;

function start(bot) {
  if (!config.widgetsEnabled || unregister) return;
  unregister = registerWidgetQueryHandler(bot, dice.handleQuery);
  console.log('[WIDGETS] Bot API 10.4 production widgets enabled');
}

function stop() {
  if (unregister) unregister();
  unregister = null;
}

module.exports = { start, stop, sendDice: dice.sendDice, handleQuery: dice.handleQuery };
