'use strict';

const DEFAULT_BASE = 'https://api.telegram.org';

function createWidgetApi({
  token,
  baseUrl = DEFAULT_BASE,
  testEnv = false,
  fetchImpl = globalThis.fetch,
}) {
  if (!token) throw new Error('BOT_TOKEN is required for widgets');
  if (typeof fetchImpl !== 'function') throw new Error('fetch is required for widgets');

  const root = `${String(baseUrl).replace(/\/+$/, '')}/bot${token}${testEnv ? '/test' : ''}`;

  async function call(method, params = {}, options = {}) {
    const timeoutMs = options.timeoutMs || 10_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('request timeout')), timeoutMs);
    const externalSignal = options.signal;
    const abort = () => controller.abort(externalSignal.reason);
    if (externalSignal) {
      if (externalSignal.aborted) abort();
      else externalSignal.addEventListener('abort', abort, { once: true });
    }

    let response;
    let body;
    try {
      response = await fetchImpl(`${root}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(params),
        signal: controller.signal,
      });
      body = await response.json().catch(() => null);
    } catch (err) {
      const message = String(err?.message || err).split(token).join('<token>');
      throw new Error(`${method}: ${message}`);
    } finally {
      clearTimeout(timer);
      if (externalSignal) externalSignal.removeEventListener('abort', abort);
    }

    if (!body || !body.ok) {
      const description = String(body?.description || `HTTP ${response.status}`).split(token).join('<token>');
      const error = new Error(`${method}: ${description}`);
      error.retryAfter = Number(body?.parameters?.retry_after) || 0;
      throw error;
    }
    return body.result;
  }

  return {
    call,
    sendWidget(chatId, html, options = {}) {
      return call('sendWidget', { chat_id: chatId, html, ...options });
    },
    answerWidgetQuery(id, data) {
      return call('answerWidgetQuery', { widget_query_id: id, data: JSON.stringify(data) });
    },
  };
}

function createWidgetPoller({ api, onQuery, onMessage, onCallback, logger = console, pollTimeout = 30 }) {
  let running = false;
  let loopPromise = null;
  let controller = null;
  let offset = 0;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  async function run() {
    while (running) {
      try {
        controller = new AbortController();
        const updates = await api.call('getUpdates', {
          offset,
          timeout: pollTimeout,
          allowed_updates: ['message', 'callback_query', 'widget_query'],
        }, { timeoutMs: (pollTimeout + 10) * 1000, signal: controller.signal });

        for (const update of updates || []) {
          offset = Math.max(offset, Number(update.update_id) + 1);
          try {
            if (update.widget_query) await onQuery(update.widget_query);
            else if (update.callback_query && onCallback) await onCallback(update.callback_query);
            else if (update.message && onMessage) await onMessage(update.message);
          } catch (err) {
            logger.error('[WIDGET UPDATE]', err?.message || err);
          }
        }
      } catch (err) {
        if (!running) break;
        logger.error('[WIDGET POLLING]', err?.message || err);
        await sleep(Math.min(10, Math.max(1, err?.retryAfter || 2)) * 1000);
      } finally {
        controller = null;
      }
    }
  }

  function start() {
    if (running) return loopPromise;
    running = true;
    loopPromise = run();
    return loopPromise;
  }

  function stop() {
    running = false;
    if (controller) controller.abort(new Error('widget polling stopped'));
  }

  return { start, stop, get running() { return running; } };
}

// node-telegram-bot-api 0.66 does not emit widget_query yet. Intercept only
// this new update kind and leave every existing update on the library's path.
// The library method is processUpdate (without an underscore).
function registerWidgetQueryHandler(bot, onQuery, logger = console) {
  if (!bot || typeof bot.processUpdate !== 'function') {
    throw new TypeError('a TelegramBot polling instance is required');
  }
  const original = bot.processUpdate;
  let active = true;
  bot.processUpdate = function routeWidgetUpdate(update) {
    if (active && update && update.widget_query) {
      Promise.resolve(onQuery(update.widget_query)).catch(err => {
        logger.error('[WIDGET QUERY]', err?.message || err);
      });
      return;
    }
    return original.call(this, update);
  };
  return () => {
    active = false;
    bot.processUpdate = original;
  };
}

module.exports = { DEFAULT_BASE, createWidgetApi, createWidgetPoller, registerWidgetQueryHandler };
