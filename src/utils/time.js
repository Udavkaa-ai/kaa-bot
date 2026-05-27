function moscowToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });
}

function moscowYesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });
}

function moscowHour() {
  return parseInt(
    new Date().toLocaleString('en-US', { timeZone: 'Europe/Moscow', hour: '2-digit', hour12: false }),
    10
  );
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

module.exports = { moscowToday, moscowYesterday, moscowHour, sleep };
