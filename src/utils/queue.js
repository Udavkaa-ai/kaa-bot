const chatQueues = new Map();

function enqueue(chatId, fn) {
  const prev = chatQueues.get(chatId) || Promise.resolve();
  const next = prev.then(fn).catch(err => {
    console.error(`[QUEUE] chat=${chatId}: ${err?.message || err}`);
    if (err?.stack) console.error(err.stack);
  });
  chatQueues.set(chatId, next);
  // Очистка старых цепочек
  if (chatQueues.size > 1000) {
    const keep = [...chatQueues.entries()].slice(-500);
    chatQueues.clear();
    for (const [k, v] of keep) chatQueues.set(k, v);
  }
  return next;
}

module.exports = { enqueue };
