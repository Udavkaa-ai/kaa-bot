const Anthropic = require('@anthropic-ai/sdk');
const config = require('../config');
const stats = require('../db/repo/stats');

// Прямой доступ к Claude через API Anthropic. Модели с голым id «claude-…»
// (без префикса OpenRouter «anthropic/») идут сюда, остальные — в OpenRouter.

// $ за миллион токенов: ввод, вывод, чтение кэша. Запись в кэш — 1.25× ввода.
const PRICES = {
  'claude-fable-5-1': { in: 10, out: 50, cacheRead: 1 },
  'claude-opus-5-5': { in: 4, out: 20, cacheRead: 0.2 },
  'claude-sonnet-5-5': { in: 2, out: 10, cacheRead: 0.2 },
  'claude-haiku-5-5': { in: 0.1, out: 0.5, cacheRead: 0.01 },
};
const DEFAULT_PRICE = PRICES['claude-opus-5-5'];

// Сверх ответа — запас на размышления: у Claude Opus 5.5 они не отключаются,
// а max_tokens считает их вместе с текстом.
const THINKING_HEADROOM = 4000;

let client = null;
function getClient() {
  if (!client) client = new Anthropic({ apiKey: config.anthropicKey, timeout: 90000, maxRetries: 1 });
  return client;
}

function isDirect(model) {
  return !!config.anthropicKey && /^claude-/.test(model || '');
}

// Дневной бюджет (московские сутки, в памяти процесса): после потолка цепочка
// уходит в OpenRouter, чтобы бесплатные кредиты не кончились за один вечер.
let spentDay = null;
let spentUsd = 0;

function moscowDay() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });
}

function budgetLeft() {
  const today = moscowDay();
  if (today !== spentDay) { spentDay = today; spentUsd = 0; }
  return config.anthropicDailyUsd <= 0 || spentUsd < config.anthropicDailyUsd;
}

function addSpend(model, usage) {
  if (!usage) return;
  const p = PRICES[model] || DEFAULT_PRICE;
  const usd = ((usage.input_tokens || 0) * p.in
    + (usage.cache_creation_input_tokens || 0) * p.in * 1.25
    + (usage.cache_read_input_tokens || 0) * p.cacheRead
    + (usage.output_tokens || 0) * p.out) / 1e6;
  budgetLeft();
  spentUsd += usd;
}

function spendToday() {
  budgetLeft();
  return { usd: spentUsd, cap: config.anthropicDailyUsd };
}

// ---------- перевод сообщений из формата OpenAI в формат Messages API ----------

function textBlocks(content) {
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : [];
  return (content || []).filter(b => b.type === 'text' && b.text).map(b => ({
    type: 'text',
    text: b.text,
    ...(b.cache_control ? { cache_control: b.cache_control } : {}),
  }));
}

function convertPart(part) {
  if (part.type === 'text') return part.text ? { type: 'text', text: part.text } : null;
  if (part.type === 'image_url') {
    const url = part.image_url?.url || '';
    const m = url.match(/^data:([^;]+);base64,(.+)$/);
    if (m) return { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } };
    return url ? { type: 'image', source: { type: 'url', url } } : null;
  }
  return null;
}

function convertMessages(messages) {
  const system = [];
  const out = [];
  for (const m of messages) {
    if (m.role === 'system') { system.push(...textBlocks(m.content)); continue; }
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const content = typeof m.content === 'string'
      ? m.content
      : (m.content || []).map(convertPart).filter(Boolean);
    if (!content || content.length === 0) continue;
    out.push({ role, content });
  }
  // API требует начинать с реплики пользователя и не принимает готовое начало ответа
  if (out.length === 0 || out[0].role !== 'user') out.unshift({ role: 'user', content: '(начало разговора)' });
  if (out[out.length - 1].role !== 'user') out.push({ role: 'user', content: '(продолжай)' });
  return { system, messages: out };
}

function buildParams(model, messages, opts) {
  const { system, messages: msgs } = convertMessages(messages);
  return {
    model,
    max_tokens: (opts.maxTokens ?? 1200) + THINKING_HEADROOM,
    ...(system.length ? { system } : {}),
    messages: msgs,
    output_config: { effort: opts.effort || config.anthropicEffort },
    // Если классификатор безопасности отклонит запрос, API сам повторит его на подходящей модели
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  };
}

// Текст ответа — блоки после последней смены модели (частичный ответ отказавшей модели отбрасываем)
function replyText(content) {
  let start = 0;
  (content || []).forEach((b, i) => { if (b.type === 'fallback') start = i + 1; });
  return (content || []).slice(start).filter(b => b.type === 'text').map(b => b.text).join('');
}

function checkBudget() {
  if (!budgetLeft()) {
    throw new Error(`дневной бюджет Anthropic $${config.anthropicDailyUsd} исчерпан, дальше OpenRouter`);
  }
}

function finish(model, msg) {
  addSpend(model, msg.usage);
  stats.increment('anthropic', model).catch(() => {});
  if (msg.stop_reason === 'refusal') throw new Error(`отказ модели (${msg.stop_details?.category || 'без категории'})`);
  const text = replyText(msg.content);
  if (!text) throw new Error(`пустой ответ (stop_reason=${msg.stop_reason})`);
  return text;
}

async function callOnce(model, messages, opts = {}) {
  checkBudget();
  const msg = await getClient().beta.messages.create(buildParams(model, messages, opts));
  return { text: finish(model, msg), model, raw: msg };
}

async function streamOnce(model, messages, opts, onProgress) {
  checkBudget();
  const stream = getClient().beta.messages.stream(buildParams(model, messages, opts));
  let full = '';
  for await (const event of stream) {
    if (event.type === 'content_block_start' && event.content_block.type === 'fallback') {
      full = '';
    } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      full += event.delta.text;
      try { onProgress(full); } catch (_) {}
    }
  }
  const msg = await stream.finalMessage();
  return { text: finish(model, msg), model };
}

module.exports = { isDirect, callOnce, streamOnce, spendToday, convertMessages, replyText };
