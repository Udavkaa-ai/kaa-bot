'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createWidgetApi, createWidgetPoller } = require('../../src/widgets/api');

test('widget API uses the documented beta/test method URL', async () => {
  const requests = [];
  const api = createWidgetApi({
    token: 'secret-token',
    baseUrl: 'https://api.telegram.org/beta/',
    testEnv: true,
    async fetchImpl(url, options) {
      requests.push({ url, options });
      return { status: 200, async json() { return { ok: true, result: { message_id: 9 } }; } };
    },
  });
  const result = await api.call('sendWidget', { chat_id: 1 });
  assert.equal(result.message_id, 9);
  assert.equal(requests[0].url, 'https://api.telegram.org/beta/botsecret-token/test/sendWidget');
  assert.deepEqual(JSON.parse(requests[0].options.body), { chat_id: 1 });
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

test('poller handles test-environment commands and widget_query with one offset', async () => {
  const calls = [];
  const handled = [];
  const messages = [];
  let poller;
  const api = {
    async call(method, params) {
      calls.push({ method, params });
      return [
        { update_id: 10, message: { text: '/dice', chat: { id: 1 } } },
        { update_id: 11, widget_query: { id: 'q1', data: 'roll:v1' } },
      ];
    },
  };
  poller = createWidgetPoller({
    api,
    pollTimeout: 0,
    async onMessage(message) { messages.push(message.text); },
    async onQuery(query) {
      handled.push(query.id);
      poller.stop();
    },
  });
  await poller.start();
  assert.deepEqual(messages, ['/dice']);
  assert.deepEqual(handled, ['q1']);
  assert.deepEqual(calls[0].params.allowed_updates, ['message', 'widget_query']);
  assert.equal(calls[0].params.offset, 0);
  assert.equal(poller.running, false);
});
