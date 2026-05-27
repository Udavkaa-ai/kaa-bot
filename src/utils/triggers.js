const config = require('../config');

function isMentioned(text, botUsername, chatTriggers) {
  if (!text) return false;
  if (botUsername && text.toLowerCase().includes(`@${botUsername.toLowerCase()}`)) return true;
  const triggers = (chatTriggers && chatTriggers.length > 0) ? chatTriggers : config.botTriggers;
  return triggers.some(trigger => {
    const escaped = trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?<![а-яёa-z0-9_])${escaped}(?![а-яёa-z0-9_])`, 'i');
    return re.test(text);
  });
}

module.exports = { isMentioned };
