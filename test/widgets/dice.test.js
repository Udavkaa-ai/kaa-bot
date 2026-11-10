'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const { REQUEST, DICE_HTML, createDiceService } = require('../../src/widgets/dice');

const query = (id = 'q1') => ({
  id,
  data: REQUEST,
  chat: { id: -100123 },
  message_id: 42,
  from: { id: 7 },
});

const persona = {
  id: 'masha',
  name: 'Маша',
  description: 'Тёплая и внимательная',
  systemPrompt: 'must stay private',
};

function harness(overrides = {}) {
  const calls = [];
  const resolutions = [];
  const api = {
    async sendWidget(chatId, html, options) {
      calls.push({ method: 'sendWidget', params: { chat_id: chatId, html, ...options } });
      return { message_id: 42 };
    },
    async answerWidgetQuery(id, data) {
      calls.push({ method: 'answerWidgetQuery', params: { widget_query_id: id, data: JSON.stringify(data) } });
      return true;
    },
  };
  const service = createDiceService({
    api,
    async resolve(userId, chatId, text) {
      resolutions.push({ userId, chatId, text });
      return { persona, justAssigned: resolutions.length === 1 };
    },
    logger: { error() {} },
    ...overrides,
  });
  return { service, calls, resolutions };
}

test('sendWidget contains the static D10 persona widget without shared state', async () => {
  const { service, calls } = harness();
  await service.sendDice(-100123);
  assert.equal(calls[0].method, 'sendWidget');
  assert.equal(calls[0].params.allow_queries, true);
  assert.equal(calls[0].params.is_shared, undefined);
  assert.equal(calls[0].params.width, 320);
  assert.equal(calls[0].params.height, 0);
  assert.equal(calls[0].params.html, DICE_HTML);
  assert.deepEqual(JSON.parse(calls[0].params.public_data), { v: 1 });
});

test('a tap resolves the daily persona for the tapper and answers only privately', async () => {
  const { service, calls, resolutions } = harness();
  await service.handleQuery(query());
  assert.deepEqual(resolutions, [{ userId: 7, chatId: -100123, text: '' }]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'answerWidgetQuery');
  const data = JSON.parse(calls[0].params.data);
  assert.deepEqual(data, {
    v: 1,
    id: 'masha',
    name: 'Маша',
    description: 'Тёплая и внимательная',
    existing: false,
  });
  assert.doesNotMatch(calls[0].params.data, /systemPrompt|must stay private/);
  assert.ok(Buffer.byteLength(calls[0].params.data, 'utf8') <= 1024);
});

test('repeated taps keep the same persona and mark it as already assigned', async () => {
  const { service, calls } = harness();
  await service.handleQuery(query('first'));
  await service.handleQuery(query('second'));
  const answers = calls.map(call => JSON.parse(call.params.data));
  assert.equal(answers[0].id, answers[1].id);
  assert.equal(answers[0].existing, false);
  assert.equal(answers[1].existing, true);
  assert.equal(calls.filter(call => call.method === 'editMessageWidgetData').length, 0);
});

test('malformed and unknown requests still receive a private error answer', async () => {
  const { service, calls, resolutions } = harness();
  await service.handleQuery({ ...query('bad'), data: 'roll:v1' });
  assert.equal(resolutions.length, 0);
  assert.match(JSON.parse(calls[0].params.data).err, /Неизвестная команда/);
  await assert.rejects(service.handleQuery({ data: REQUEST }), /invalid widget query/);
});

test('persona resolution failures are answered instead of timing out', async () => {
  const { service, calls } = harness({
    async resolve() { throw new Error('database unavailable'); },
  });
  await service.handleQuery(query());
  assert.match(JSON.parse(calls[0].params.data).err, /Попробуй ещё раз/);
});

test('real daily resolver assigns once and reuses the stored persona', async () => {
  const usersPath = require.resolve('../../src/db/repo/users');
  const handlerPath = require.resolve('../../src/handlers/persona');
  const previousUsers = require.cache[usersPath];
  const previousHandler = require.cache[handlerPath];
  let stored = null;
  let writes = 0;
  require.cache[usersPath] = {
    id: usersPath,
    filename: usersPath,
    loaded: true,
    exports: {
      async getUserPersona() { return stored; },
      async setUserPersona(userId, chatId, personaId, dateAssigned) {
        writes += 1;
        stored = { persona_id: personaId, date_assigned: dateAssigned };
      },
    },
  };
  delete require.cache[handlerPath];
  try {
    const { resolvePersona } = require(handlerPath);
    const first = await resolvePersona(7, -100123, '');
    const second = await resolvePersona(7, -100123, '');
    assert.equal(first.justAssigned, true);
    assert.equal(second.justAssigned, false);
    assert.equal(first.persona.id, second.persona.id);
    assert.equal(writes, 1);
  } finally {
    delete require.cache[handlerPath];
    if (previousHandler) require.cache[handlerPath] = previousHandler;
    if (previousUsers) require.cache[usersPath] = previousUsers;
    else delete require.cache[usersPath];
  }
});

test('service validates its dependencies', () => {
  assert.throws(() => createDiceService({}), /sendWidget and answerWidgetQuery/);
  assert.throws(() => createDiceService({
    api: { sendWidget() {}, answerWidgetQuery() {} },
    resolve: null,
  }), /resolvePersona/);
});

test('all ten portraits use vector shapes over one common face layer', () => {
  const ids = JSON.parse(DICE_HTML.match(/ids=(\[[^\]]+\]),D=/)[1].replaceAll("'", '"'));
  const [, rawPortraits, rawBase] = DICE_HTML.match(/,D=(\[[\s\S]*\]),B=(\[.*\]);let/);
  const portraits = JSON.parse(rawPortraits);
  const base = JSON.parse(rawBase);
  assert.deepEqual(ids.sort(), ['artvednik', 'babushka', 'detective', 'filosof', 'kolyan', 'masha', 'polkovnik', 'professor', 'rapper', 'vitya'].sort());
  assert.equal(portraits.length, 10);
  assert.equal(new Set(portraits.map(JSON.stringify)).size, 10);
  assert.deepEqual(base[1][1], [21, 13, 43, 47]);
  assert.equal(base.filter(command => command[0] === 'l').length, 2);
  for (const [before, after] of portraits) {
    assert.ok(Array.isArray(before) && Array.isArray(after));
    for (const command of [...before, ...after]) {
      assert.ok(['e', 'r', 'p', 'l'].includes(command[0]));
      assert.ok(Array.isArray(command[1]));
    }
  }
});

test('HTML fits Telegram limits and remains self-contained', () => {
  const raw = Buffer.byteLength(DICE_HTML, 'utf8');
  const packed = zlib.deflateSync(DICE_HTML, { level: 9 }).length;
  assert.ok(raw <= 32768, `raw HTML: ${raw}`);
  assert.ok(packed <= 4096, `compressed HTML: ${packed}`);
  assert.doesNotMatch(DICE_HTML, /(?:src|href)\s*=\s*["'](?:https?:)?\/\//i);
  assert.doesNotMatch(DICE_HTML, /<(?:iframe|video|audio|input|textarea|link)\b/i);
  assert.doesNotMatch(DICE_HTML, /\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/);
  assert.match(DICE_HTML, /TelegramWidget/);
  assert.match(DICE_HTML, /request\('persona:v1'\)/);
  assert.match(DICE_HTML, /prefers-reduced-motion/);
});
