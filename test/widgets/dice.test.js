'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const {
  DICE_HTML,
  secureRoll,
  commentFor,
  targetOf,
  keyOf,
  createDiceService,
} = require('../../src/widgets/dice');

const query = (id = 'q1') => ({
  id,
  data: 'roll:v1',
  chat: { id: -100123 },
  message_id: 42,
  from: { id: 7 },
});

function harness(overrides = {}) {
  const calls = [];
  const states = new Map();
  const api = {
    async call(method, params) {
      calls.push({ method, params });
      if (method === 'editMessageWidgetData') {
        await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 3)));
      }
      return { message_id: 42 };
    },
  };
  const repo = {
    async nextRoll(key) {
      const n = (states.get(key) || 0) + 1;
      states.set(key, n);
      return { rolls: n, revision: n };
    },
  };
  let face = 0;
  const service = createDiceService({
    api,
    repo,
    randomInt(min, max) {
      assert.equal(min, 1);
      assert.equal(max, 7);
      face = face % 6 + 1;
      return face;
    },
    logger: { error() {} },
    ...overrides,
  });
  return { service, calls, states, api, repo };
}

test('secureRoll uses the cryptographic range and comments cover every face', () => {
  const seen = new Set();
  for (let i = 0; i < 600; i++) {
    const value = secureRoll();
    assert.ok(Number.isInteger(value) && value >= 1 && value <= 6);
    assert.ok(commentFor(value).length > 0);
    seen.add(value);
  }
  assert.deepEqual([...seen].sort(), [1, 2, 3, 4, 5, 6]);
});

test('sendWidget contains a fixed static widget with an initial public revision', async () => {
  const { service, calls } = harness();
  await service.sendDice(-100123);
  assert.equal(calls[0].method, 'sendWidget');
  assert.equal(calls[0].params.allow_queries, true);
  assert.equal(calls[0].params.is_shared, undefined);
  assert.equal(calls[0].params.html, DICE_HTML);
  assert.deepEqual(JSON.parse(calls[0].params.public_data), { v: 1, n: 0, r: 0 });
});

test('a chat query edits the same message and privately answers the tapper', async () => {
  const { service, calls } = harness();
  const answer = await service.handleQuery(query());
  assert.equal(answer.value, 1);
  assert.equal(answer.n, 1);
  assert.equal(answer.r, 1);
  const edit = calls.find(call => call.method === 'editMessageWidgetData');
  assert.deepEqual(edit.params, {
    chat_id: -100123,
    message_id: 42,
    public_data: JSON.stringify({ v: 1, n: 1, r: 1 }),
  });
  const privateAnswer = calls.find(call => call.method === 'answerWidgetQuery');
  assert.equal(privateAnswer.params.widget_query_id, 'q1');
  assert.deepEqual(JSON.parse(privateAnswer.params.data), answer);
  assert.ok(Buffer.byteLength(privateAnswer.params.data, 'utf8') <= 1024);
});

test('inline coordinates use inline_message_id and a distinct state key', async () => {
  const { service, calls, states } = harness();
  await service.handleQuery({ id: 'inline', data: 'roll:v1', inline_message_id: 'abc123' });
  const edit = calls.find(call => call.method === 'editMessageWidgetData');
  assert.deepEqual(edit.params, {
    inline_message_id: 'abc123',
    public_data: JSON.stringify({ v: 1, n: 1, r: 1 }),
  });
  assert.ok(states.has('dice:i:abc123'));
});

test('malformed and unknown requests still receive a private error answer', async () => {
  const { service, calls, states } = harness();
  const answer = await service.handleQuery({ ...query('bad'), data: 'other' });
  assert.match(answer.err, /Неизвестный запрос/);
  assert.equal(states.size, 0);
  assert.equal(calls.filter(call => call.method === 'editMessageWidgetData').length, 0);
  const response = calls.find(call => call.method === 'answerWidgetQuery');
  assert.equal(response.params.widget_query_id, 'bad');
  assert.match(JSON.parse(response.params.data).err, /Неизвестный запрос/);
  assert.throws(() => targetOf({ data: 'roll:v1' }), /coordinates/);
  await assert.rejects(service.handleQuery({ data: 'roll:v1' }), /no id/);
});

test('repository failures are answered instead of leaving the widget to time out', async () => {
  const { service, calls } = harness({
    repo: { async nextRoll() { throw new Error('database unavailable'); } },
  });
  const answer = await service.handleQuery(query());
  assert.match(answer.err, /Попробуй ещё раз/);
  const response = calls.find(call => call.method === 'answerWidgetQuery');
  assert.deepEqual(JSON.parse(response.params.data), answer);
});

test('concurrent taps on one message are serialized without lost increments', async () => {
  const { service, calls } = harness();
  const answers = await Promise.all(Array.from({ length: 24 }, (_, i) =>
    service.handleQuery(query(`q${i}`))
  ));
  assert.equal(answers.length, 24);
  assert.deepEqual(answers.map(answer => answer.n).sort((a, b) => a - b),
    Array.from({ length: 24 }, (_, i) => i + 1));
  const revisions = calls.filter(call => call.method === 'editMessageWidgetData')
    .map(call => JSON.parse(call.params.public_data).r);
  assert.deepEqual(revisions, Array.from({ length: 24 }, (_, i) => i + 1));
  assert.equal(calls.filter(call => call.method === 'answerWidgetQuery').length, 24);
});

test('a new service instance continues the persisted counter after restart', async () => {
  const { service, api, repo } = harness();
  await service.handleQuery(query('before'));
  const restarted = createDiceService({ api, repo, logger: { error() {} } });
  const answer = await restarted.handleQuery(query('after'));
  assert.equal(answer.n, 2);
  assert.equal(answer.r, 2);
});

test('message keys cannot collide across chats or inline messages', () => {
  assert.notEqual(keyOf({ chat_id: 1, message_id: 2 }), keyOf({ chat_id: 2, message_id: 1 }));
  assert.notEqual(keyOf({ chat_id: 1, message_id: 2 }), keyOf({ inline_message_id: '1:2' }));
});

test('HTML fits Telegram limits and remains self-contained', () => {
  const raw = Buffer.byteLength(DICE_HTML, 'utf8');
  const packed = zlib.deflateSync(DICE_HTML, { level: 9 }).length;
  assert.ok(raw <= 32768, `raw HTML: ${raw}`);
  assert.ok(packed <= 3800, `compressed HTML: ${packed}`);
  assert.doesNotMatch(DICE_HTML, /(?:src|href)\s*=\s*["'](?:https?:)?\/\//i);
  assert.doesNotMatch(DICE_HTML, /<(?:iframe|video|audio|input|textarea|link)\b/i);
  assert.doesNotMatch(DICE_HTML, /\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/);
  assert.match(DICE_HTML, /TelegramWidget/);
  assert.match(DICE_HTML, /request\('roll:v1'\)/);
  assert.match(DICE_HTML, /prefers-reduced-motion/);
});
