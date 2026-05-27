const claude = require('./claude');
const config = require('../config');

async function searchViaPerplexity(query) {
  try {
    const result = await claude.callWithFallback(
      [
        { role: 'system', content: 'Найди свежие и точные факты по запросу. Дай краткий ответ с ссылками.' },
        { role: 'user', content: query },
      ],
      { temperature: 0.2, maxTokens: 600 }
    );
    return result?.text || null;
  } catch (err) {
    console.error('[PERPLEXITY]', err.message);
    return null;
  }
}

module.exports = { searchViaPerplexity };
