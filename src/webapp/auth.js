const crypto = require('crypto');
const config = require('../config');

// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
function verifyInitData(initData) {
  if (!initData || typeof initData !== 'string') return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secret = crypto.createHmac('sha256', 'WebAppData').update(config.botToken).digest();
  const computed = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
  if (computed !== hash) return null;

  // Anti-replay: reject auth_date older than 24h
  const authDate = parseInt(params.get('auth_date'), 10);
  if (!authDate || Date.now() / 1000 - authDate > 86400) return null;

  const out = {};
  for (const [k, v] of params.entries()) out[k] = v;
  if (out.user) {
    try { out.user = JSON.parse(out.user); } catch (_) { return null; }
  }
  return out;
}

module.exports = { verifyInitData };
