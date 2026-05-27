const stats = require('../db/repo/stats');

async function generateImage(prompt, opts = {}) {
  const seed = Math.floor(Math.random() * 1e9);
  const params = new URLSearchParams({
    nologo: 'true',
    width: String(opts.width || 1024),
    height: String(opts.height || 1024),
    seed: String(seed),
    model: opts.model || 'flux',
  });
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${params}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`Pollinations ${res.status}`);
  stats.increment('pollinations', 'flux').catch(() => {});
  return Buffer.from(await res.arrayBuffer());
}

module.exports = { generateImage };
