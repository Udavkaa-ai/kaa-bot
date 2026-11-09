'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DICE_HTML = fs.readFileSync(path.join(__dirname, 'dice.html'), 'utf8');
const REQUEST = 'roll:v1';
const COMMENTS = {
  1: 'Единица. Зато без понтов.',
  2: 'Двойка. Начнём с малого.',
  3: 'Тройка. Уже похоже на план.',
  4: 'Четвёрка. Крепко, без фокусов.',
  5: 'Пятёрка. Судьба явно задобрила.',
  6: 'Шестёрка! Вот это я понимаю.',
};

function secureRoll(randomInt = crypto.randomInt) {
  return randomInt(1, 7);
}

function commentFor(value) {
  return COMMENTS[value] || 'Бросок принят.';
}

function targetOf(query) {
  if (typeof query?.inline_message_id === 'string' && query.inline_message_id) {
    return { inline_message_id: query.inline_message_id };
  }
  const chatId = Number(query?.chat?.id);
  const messageId = Number(query?.message_id);
  if (Number.isSafeInteger(chatId) && chatId !== 0 && Number.isSafeInteger(messageId) && messageId > 0) {
    return { chat_id: query.chat.id, message_id: query.message_id };
  }
  throw new Error('Widget query has no valid message coordinates');
}

function keyOf(target) {
  return target.inline_message_id
    ? `dice:i:${target.inline_message_id}`
    : `dice:c:${target.chat_id}:${target.message_id}`;
}

function createDiceService({ api, repo, randomInt = crypto.randomInt, logger = console }) {
  const queues = new Map();

  function enqueue(key, task) {
    const previous = queues.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(task);
    queues.set(key, current);
    const cleanup = () => {
      if (queues.get(key) === current) queues.delete(key);
    };
    current.then(cleanup, cleanup);
    return current;
  }

  async function sendDice(chatId) {
    return api.call('sendWidget', {
      chat_id: chatId,
      html: DICE_HTML,
      width: 320,
      height: 0,
      caption: 'Кубик Билли: нажми «Бросить кубик»',
      allow_queries: true,
      public_data: JSON.stringify({ v: 1, n: 0, r: 0 }),
    });
  }

  async function handleQuery(query) {
    if (!query?.id) throw new Error('Widget query has no id');
    let answer;
    try {
      if (query.data !== REQUEST) {
        answer = { err: 'Неизвестный запрос. Попробуй новый кубик через /dice.' };
      } else {
        const target = targetOf(query);
        const key = keyOf(target);
        answer = await enqueue(key, async () => {
          const value = secureRoll(randomInt);
          const saved = await repo.nextRoll(key);
          const n = Number(saved.n ?? saved.rolls);
          const r = Number(saved.r ?? saved.revision);
          if (!Number.isSafeInteger(n) || n < 1 || !Number.isSafeInteger(r) || r < 1) {
            throw new Error('Widget state repository returned an invalid revision');
          }
          const publicData = JSON.stringify({ v: 1, n, r });
          try {
            await api.call('editMessageWidgetData', { ...target, public_data: publicData });
          } catch (err) {
            if (!/not modified/i.test(err?.message || '')) throw err;
          }
          return { v: 1, value, comment: commentFor(value), n, r };
        });
      }
    } catch (err) {
      logger.error('[DICE]', err?.message || err);
      answer = { err: 'Не получилось бросить. Попробуй ещё раз.' };
    }

    const data = JSON.stringify(answer);
    if (Buffer.byteLength(data, 'utf8') > 1024) {
      throw new Error('Dice answer exceeds the widget result limit');
    }
    await api.call('answerWidgetQuery', { widget_query_id: query.id, data });
    return answer;
  }

  return { sendDice, handleQuery };
}

module.exports = {
  DICE_HTML,
  REQUEST,
  secureRoll,
  commentFor,
  targetOf,
  keyOf,
  createDiceService,
};
