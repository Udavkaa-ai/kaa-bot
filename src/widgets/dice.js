'use strict';

const fs = require('node:fs');
const path = require('node:path');
const defaultResolve = (...args) => require('../handlers/persona').resolvePersona(...args);

const REQUEST = 'persona:v1';
const DICE_HTML = fs.readFileSync(path.join(__dirname, 'dice.html'), 'utf8');

function createDiceService({ api, resolve = defaultResolve, logger = console }) {
  if (!api || typeof api.sendWidget !== 'function' || typeof api.answerWidgetQuery !== 'function') {
    throw new TypeError('persona service requires sendWidget and answerWidgetQuery');
  }
  if (typeof resolve !== 'function') throw new TypeError('persona service requires resolvePersona');

  async function sendDice(chatId) {
    return api.sendWidget(chatId, DICE_HTML, {
      width: 320,
      height: 0,
      caption: 'D10 «Личность дня»: нажми «Узнать личность»',
      allow_queries: true,
      public_data: JSON.stringify({ v: 1 }),
    });
  }

  async function handleQuery(query) {
    if (!query || !query.id || !query.chat || !query.from) {
      throw new TypeError('invalid widget query');
    }
    if (query.data !== REQUEST) {
      await api.answerWidgetQuery(query.id, { err: 'Неизвестная команда виджета' });
      return;
    }
    try {
      const { persona, justAssigned } = await resolve(query.from.id, query.chat.id, '');
      await api.answerWidgetQuery(query.id, {
        v: 1,
        id: persona.id,
        name: persona.name,
        description: persona.description,
        existing: !justAssigned,
      });
    } catch (error) {
      logger.error('persona widget query failed', { error: error.message });
      await api.answerWidgetQuery(query.id, {
        err: 'Не удалось раскрыть личность. Попробуй ещё раз',
      });
    }
  }

  return { sendDice, handleQuery };
}

module.exports = { REQUEST, DICE_HTML, createDiceService };
