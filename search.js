// search.js — Веб-поиск через Tavily API
// Включается через SEARCH=true + TAVILY_KEY в .env

const config = require('./config');

const SEARCH_TRIGGERS = [
  'найди', 'найти', 'поищи', 'погугли', 'загугли',
  'что такое', 'кто такой', 'кто такая', 'кто такие',
  'расскажи про', 'расскажи о',
  'когда', 'где', 'сколько стоит', 'как называется',
  'последние новости', 'новости про', 'новости о',
  'search', 'find', 'google', 'look up',
];

function needsSearch(text) {
  if (!text || !config.TAVILY_KEY) return false;
  const lower = text.toLowerCase();
  return SEARCH_TRIGGERS.some(trigger => lower.includes(trigger));
}

function extractQuery(text) {
  let query = text;

  // Убираем имена бота
  query = query.replace(/^(каа|удав|kaa|udav)[,!]?\s*/i, '');

  // Убираем триггерные фразы (длинные сначала)
  const phrases = [
    'последние новости про', 'последние новости о', 'последние новости',
    'расскажи про', 'расскажи о',
    'что такое', 'кто такой', 'кто такая', 'кто такие',
    'новости про', 'новости о',
    'сколько стоит', 'как называется',
    'найди', 'найти', 'поищи', 'погугли', 'загугли',
    'search for', 'look up', 'find',
  ];

  for (const phrase of phrases) {
    const re = new RegExp(phrase + '\\s*', 'gi');
    query = query.replace(re, '');
  }

  return query.trim();
}

async function searchTavily(query) {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: config.TAVILY_KEY,
      query,
      search_depth: 'basic',
      include_answer: false,
      max_results: 3,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Tavily ${res.status}: ${err}`);
  }

  const data = await res.json();

  if (!data.results?.length) return null;

  // Формируем контекст для AI
  const snippets = data.results.map((r, i) =>
    `[${i + 1}] ${r.title}\n${r.content}\nИсточник: ${r.url}`
  );

  return snippets.join('\n\n');
}

async function trySearch(text) {
  if (!needsSearch(text)) return null;

  try {
    const query = extractQuery(text);
    if (!query || query.length < 2) return null;

    return await searchTavily(query);
  } catch (err) {
    console.error('[Search] Tavily error:', err.message);
    return null;
  }
}

module.exports = { trySearch, needsSearch, extractQuery };
