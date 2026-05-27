const gemini = require('../providers/gemini');

async function safeEmbed(text) {
  if (!text || !gemini.isAvailable()) return null;
  try {
    return await gemini.embed(text);
  } catch (err) {
    console.warn('[EMBED]', err.message);
    return null;
  }
}

module.exports = { safeEmbed };
