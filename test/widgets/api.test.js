'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createWidgetApi, createWidgetPoller, registerWidgetQueryHandler } = require('../../src/widgets/api');

test('widget API uses the production method URL by default', async () => {
  const requests = [];
  const api = createWidgetApi({
    token: 'secret-token',
    async fetchImpl(url, options) {
      requests.push({ url, options });
      return { status: 200, async json() { return { ok: true, result: { message_id: 9 } }; } };
    },
  });
  const result = await api.sendWidget(1, '<b>D10</b>', { height: 0 });
  assert.equal(result.message_id, 9);
  assert.equal(requests[0].url, 'https://api.telegram.org/botsecret-token/sendWidget');
  assert.deepEqual(JSON.parse(requests[0].options.body), { chat_id: 1, html: '<b>D10</b>', height: 0 });
  await api.answerWidgetQuery('q1', { id: 'masha' });
  assert.equal(requests[1].url, 'https://api.telegram.org/botsecret-token/answerWidgetQuery');
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    widget_query_id: 'q1',
    data: '{"id":"masha"}',
  });
});

test('API errors never leak the bot token', async () => {
  const api = createWidgetApi({
    token: 'secret-token',
    async fetchImpl() {
      return { status: 400, async json() { return { ok: false, description: 'bad secret-token value' }; } };
    },
  });
  await assert.rejects(api.call('sendWidget'), error => {
    assert.match(error.message, /bad <token> value/);
    assert.doesNotMatch(error.message, /secret-token value/);
    return true;
  });
});

test('standalone poller handles commands and widget_query with one offset', async () => {
  const calls = [];
  const handled = [];
  const messages = [];
  const callbacks = [];
  let poller;
  const api = {
    async call(method, params) {
      calls.push({ method, params });
      return [
        { update_id: 10, message: { text: '/d10', chat: { id: 1 } } },
        { update_id: 11, callback_query: { id: 'c1', data: 'persona:random' } },
        { update_id: 12, widget_query: { id: 'q1', data: 'persona:v1' } },
      ];
    },
  };
  poller = createWidgetPoller({
    api,
    pollTimeout: 0,
    async onMessage(message) { messages.push(message.text); },
    async onCallback(callback) { callbacks.push(callback.data); },
    async onQuery(query) {
      handled.push(query.id);
      poller.stop();
    },
  });
  await poller.start();
  assert.deepEqual(messages, ['/d10']);
  assert.deepEqual(callbacks, ['persona:random']);
  assert.deepEqual(handled, ['q1']);
  assert.deepEqual(calls[0].params.allowed_updates, ['message', 'callback_query', 'widget_query']);
  assert.equal(calls[0].params.offset, 0);
  assert.equal(poller.running, false);
});


test('widget_query joins the existing production polling without a second getUpdates', async () => {
  const delegated = [];
  const handled = [];
  const errors = [];
  const bot = {
    processUpdate(update) { delegated.push(update); },
  };
  const unregister = registerWidgetQueryHandler(bot, async query => {
    handled.push(query.id);
  }, { error: (...args) => errors.push(args) });

  bot.processUpdate({ update_id: 1, message: { text: '/d10' } });
  bot.processUpdate({ update_id: 2, widget_query: { id: 'q-production' } });
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(delegated, [{ update_id: 1, message: { text: '/d10' } }]);
  assert.deepEqual(handled, ['q-production']);
  assert.deepEqual(errors, []);
  unregister();
  bot.processUpdate({ update_id: 3, widget_query: { id: 'after-stop' } });
  assert.equal(delegated.length, 2);
});
