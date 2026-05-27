// Юмористические ответы в характере персон при ошибках API

const RATE_LIMIT_LINES = [
  'Сейчас джунгли шумят слишком громко, потерял мысль. Подойди позже.',
  'Слишком много голосов. Дай минуту переварить.',
  'Сегодня я уже наговорился. Завтра спросишь то же — отвечу.',
  'Квота моей мудрости на исходе. Перезайди.',
];

const TIMEOUT_LINES = [
  'Думал слишком долго. Спроси короче.',
  'Связь с джунглями оборвалась. Повтори.',
  'Тишина дольше чем нужно. Снова, но кратко.',
];

const CENSOR_LINES = [
  'Молчу. На это не отвечу.',
  'Тема не моя. Другое спроси.',
  'Об этом — не здесь.',
];

const GENERIC_LINES = [
  'Что-то пошло не так в моих мыслях. Повтори?',
  'Сейчас не могу сформулировать. Через минуту.',
  'Шум в эфире. Спроси ещё раз.',
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function humorReply(err) {
  if (!err) return pick(GENERIC_LINES);
  const msg = (err.message || '').toLowerCase();
  if (/429|rate.?limit|quota|resource_exhausted|insufficient.?balance/.test(msg)) return pick(RATE_LIMIT_LINES);
  if (/timeout|aborted|etimedout|econnreset/.test(msg)) return pick(TIMEOUT_LINES);
  if (/blocked|safety|content.?policy|moderation/.test(msg)) return pick(CENSOR_LINES);
  return pick(GENERIC_LINES);
}

module.exports = { humorReply };
