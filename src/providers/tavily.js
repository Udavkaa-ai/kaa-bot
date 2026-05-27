const config = require('../config');
const stats = require('../db/repo/stats');

const SEARCH_TRIGGERS = [
  'найди', 'найти', 'поищи', 'погугли', 'загугли',
  'что такое', 'кто такой', 'кто такая', 'кто такие',
  'расскажи про', 'расскажи о',
  'сколько стоит', 'как называется', 'когда выходит', 'когда состоится',
  'последние новости', 'новости про', 'новости о',
  'search', 'find', 'google', 'look up',
];

function needsSearch(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return SEARCH_TRIGGERS.some(t => lower.includes(t));
}

function extractQuery(text) {
  let q = text;
  q = q.replace(/^(дух|духи|spirit|duh)[,!\s]+/i, '');
  const phrases = [
    'последние новости про', 'последние новости о', 'последние новости',
    'расскажи про', 'расскажи о',
    'что такое', 'кто такой', 'кто такая', 'кто такие',
    'новости про', 'новости о',
    'сколько стоит', 'как называется', 'когда выходит', 'когда состоится',
    'найди', 'найти', 'поищи', 'погугли', 'загугли',
    'search for', 'look up', 'find',
  ];
  for (const p of phrases) {
    q = q.replace(new RegExp(p + '\\s*', 'gi'), '');
  }
  return q.trim();
}

async function searchRaw(query) {
  if (!config.tavilyKey) throw new Error('TAVILY_KEY не задан');
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: config.tavilyKey,
      query,
      search_depth: 'basic',
      include_answer: true,
      max_results: 4,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Tavily ${res.status}: ${(await res.text()).slice(0, 200)}`);
  stats.increment('tavily', 'search').catch(() => {});
  return res.json();
}

async function trySearch(text) {
  if (!needsSearch(text)) return null;
  if (!config.tavilyKey) return null;
  try {
    const q = extractQuery(text);
    if (!q || q.length < 2) return null;
    const data = await searchRaw(q);
    if (!data.results?.length) return null;
    const snippets = data.results.map((r, i) =>
      `[${i + 1}] ${r.title}\n${r.content}\nИсточник: ${r.url}`
    );
    const answer = data.answer ? `Краткий ответ: ${data.answer}\n\n` : '';
    return answer + snippets.join('\n\n');
  } catch (err) {
    console.error('[TAVILY]', err.message);
    return null;
  }
}

module.exports = { trySearch, needsSearch, extractQuery, searchRaw };
