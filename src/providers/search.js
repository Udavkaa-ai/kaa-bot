const config = require('../config');
const tavily = require('./tavily');
const perplexity = require('./perplexity');

async function trySearch(text) {
  if (!config.searchEnabled) return null;
  if (!tavily.needsSearch(text)) return null;

  if (config.searchProvider === 'tavily' && config.tavilyKey) {
    return tavily.trySearch(text);
  }
  if (config.searchProvider === 'perplexity') {
    const q = tavily.extractQuery(text);
    if (!q || q.length < 2) return null;
    return perplexity.searchViaPerplexity(q);
  }
  // По умолчанию пробуем Tavily если ключ есть, иначе Perplexity
  if (config.tavilyKey) return tavily.trySearch(text);
  const q = tavily.extractQuery(text);
  return perplexity.searchViaPerplexity(q);
}

module.exports = { trySearch, needsSearch: tavily.needsSearch };
