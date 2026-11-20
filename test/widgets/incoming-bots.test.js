'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldIgnoreIncomingBot } = require('../../src/utils/incomingBots');

const message = (username, replyFrom) => ({
  from: { id: 100, is_bot: true, username },
  ...(replyFrom ? { reply_to_message: { from: replyFrom } } : {}),
});

test('bots other than Udavkaa_ai are ignored', () => {
  assert.equal(shouldIgnoreIncomingBot(message('another_bot'), 1), true);
  assert.equal(shouldIgnoreIncomingBot(message(undefined), 1), true);
});

test('Udavkaa_ai can start an exchange, case-insensitively', () => {
  assert.equal(shouldIgnoreIncomingBot(message('Udavkaa_ai'), 1), false);
  assert.equal(shouldIgnoreIncomingBot(message('UDAVKAA_AI'), 1), false);
});

test('a bot reply to any bot is ignored to prevent loops', () => {
  assert.equal(shouldIgnoreIncomingBot(
    message('Udavkaa_ai', { id: 1, is_bot: true, username: 'UdavkaaBot' }),
    1
  ), true);
  assert.equal(shouldIgnoreIncomingBot(
    message('Udavkaa_ai', { id: 200, is_bot: true, username: 'another_bot' }),
    1
  ), true);
});

test('a bot reply to a human remains allowed', () => {
  assert.equal(shouldIgnoreIncomingBot(
    message('Udavkaa_ai', { id: 7, is_bot: false }),
    1
  ), false);
});

test('human messages and our own updates keep their existing behavior', () => {
  assert.equal(shouldIgnoreIncomingBot({ from: { id: 7, is_bot: false } }, 1), false);
  assert.equal(shouldIgnoreIncomingBot({ from: { id: 1, is_bot: true } }, 1), false);
});
