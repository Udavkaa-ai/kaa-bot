// Боты-игроки для симулятора баланса и тестов. Играют через публичный API движка
// (applyAction), поэтому проверяют ровно то, что доступно живому игроку.
'use strict';

const E = require('../engine');
const I = E._internal;

// Простой детерминированный ГСЧ для решений бота (не путать с RNG игры)
function botRng(seed) {
  let s = (seed ^ 0x9e3779b9) >>> 0;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

function tryAct(state, ch, action) {
  try { return E.applyAction(state, action, ch).state; } catch (err) {
    if (err instanceof E.GameError) return state;
    throw err;
  }
}

// Стратегии:
//  historical — выбирает как было в истории, планирует артели под срок
//  cautious   — те же решения, но нанимает с запасом казны и платит высоко
//  random     — случайные решения и случайная численность артелей
//  shortcut   — один путь, 1435, прямая: самый дешёвый вариант
function chooseFor(strategy, ev, rnd) {
  if (strategy === 'random') return ev.choices[Math.floor(rnd() * ev.choices.length)].id;
  if (strategy === 'shortcut') {
    const pref = { E03: 'direct', E04: '1435', E05: '1', E10: 'steep', E12: 'wooden', P01b: 'public', T02: 'light', T05: 'ferry', T06: 'kvzhd' };
    if (pref[ev.id]) return pref[ev.id];
  }
  if (ev.history && ev.history.choiceId) return ev.history.choiceId;
  // Игровые события: дешёвый вариант, если он не бьёт по настрою слишком сильно
  const costOf = c => -(c.effects?.treasury || 0) + Math.max(0, -(c.effects?.morale || 0)) * 40;
  return [...ev.choices].sort((a, b) => costOf(a) - costOf(b))[0].id;
}

function planCrews(state, ch, strategy, rnd) {
  const b = ch.balance;
  const cb = b[ch.id];
  const v = E.view(state, ch);
  const segs = I.activeSegments(state, ch).filter(s => !state.segments[s.id].opened);
  if (!segs.length) return 0;
  const workLeft = segs.reduce((a, s) => a + (v.segments[s.id].work - v.segments[s.id].workDone), 0);
  const costLeft = segs.reduce((a, s) => a + v.segments[s.id].costLeft, 0);
  if (strategy === 'random') return Math.floor(10 + rnd() * 90);

  const now = I.dateIndex(ch, state.year, state.season);
  const deadline = cb.deadline ? I.dateIndex(ch, cb.deadline.year, cb.deadline.season) : now + 6;
  const seasonsLeft = Math.max(2, deadline - now - 1);
  const eff = b.crews.workPerCrewPerSeason * 0.7 * (state.morale / 100);
  const needed = Math.ceil(workLeft / seasonsLeft / eff * 1.1);
  // Сколько можем содержать: казна + будущие ассигнования − материалы, делённое на жалованье
  const years = Math.max(0, seasonsLeft / 4);
  // Прошения тоже деньги: раз в cooldown, пока благоволение держится
  const pet = cb.petition && state.favor > 45 ? Math.floor(seasonsLeft / cb.petition.cooldownSeasons) * cb.petition.amount * 0.5 : 0;
  const money = state.treasury + (cb.yearlyAllocation || 0) * years + pet - costLeft - 300;
  const payLevel = b.crews.pay[state.pay].costPerCrew;
  const affordable = Math.floor(money / (payLevel * seasonsLeft));
  const cap = segs.reduce((a, s) => a + I.maxCrewsFor(state, ch, s), 0);
  const perCrew = b.crews.workPerCrewPerSeason * (state.morale / 100);
  const tail = segs.reduce((a, s) => {
    const left = v.segments[s.id].work - v.segments[s.id].workDone;
    return a + Math.min(I.maxCrewsFor(state, ch, s), Math.ceil(left / Math.max(0.1, perCrew * v.segments[s.id].seasonMult)));
  }, 0);
  let target = Math.max(1, Math.min(Math.max(needed, Math.min(tail, 60)), Math.max(affordable, 8), cap));
  if (strategy === 'cautious') target = Math.max(1, Math.floor(target * 0.85));
  return target;
}

function playTurn(state, ch, strategy, rnd) {
  const b = ch.balance;
  // Депеши
  let guard = 0;
  while (state.pendingEvents.length && !state.finished && guard++ < 20) {
    const ev = ch.eventsById[state.pendingEvents[0]];
    state = E.applyAction(state, { type: 'CHOOSE', eventId: ev.id, choiceId: chooseFor(strategy, ev, rnd) }, ch).state;
  }
  if (state.finished) return state;

  // Настрой: поднимать оплату, когда он проседает, и возвращать обычную, когда восстановился
  if (strategy === 'cautious' && state.pay !== 'high' && state.morale < 60) state = tryAct(state, ch, { type: 'SET_PAY', level: 'high' });
  if (strategy === 'historical') {
    if (state.pay !== 'high' && state.morale < 75) state = tryAct(state, ch, { type: 'SET_PAY', level: 'high' });
    else if (state.pay === 'high' && state.morale > 95) state = tryAct(state, ch, { type: 'SET_PAY', level: 'normal' });
  }
  if (strategy === 'random' && rnd() < 0.1) state = tryAct(state, ch, { type: 'SET_PAY', level: ['low', 'normal', 'high'][Math.floor(rnd() * 3)] });

  if (state.unlocked.construction) {
    const target = planCrews(state, ch, strategy, rnd);
    // Снять всех, нанять/распустить до цели, расставить по участкам
    for (const seg of I.activeSegments(state, ch)) {
      if (!state.segments[seg.id].opened && state.segments[seg.id].crews) {
        state = tryAct(state, ch, { type: 'ASSIGN_CREWS', segmentId: seg.id, crews: 0 });
      }
    }
    if (state.crewsTotal < target) {
      const n = Math.min(target - state.crewsTotal, b.crews.maxHirePerSeason);
      state = tryAct(state, ch, { type: 'HIRE_CREWS', amount: n });
    } else if (state.crewsTotal > target) {
      state = tryAct(state, ch, { type: 'DISMISS_CREWS', amount: state.crewsTotal - target });
    }
    // Сначала добиваем почти готовые участки (им нужно мало людей, а открытие даёт доход
    // и благоволение), остаток — на участки с наибольшим объёмом работы.
    const v = E.view(state, ch);
    const perCrew = b.crews.workPerCrewPerSeason * (state.morale / 100);
    const segs = I.activeSegments(state, ch).filter(s => !state.segments[s.id].opened).map(s => {
      const left = v.segments[s.id].work - v.segments[s.id].workDone;
      const finishNow = Math.ceil(left / Math.max(0.1, perCrew * v.segments[s.id].seasonMult));
      return { s, left, finishNow, cap: I.maxCrewsFor(state, ch, s) };
    });
    let free = state.crewsTotal;
    const give = {};
    for (const x of [...segs].sort((a, c) => a.left - c.left)) {
      if (free <= 0) break;
      if (x.finishNow > x.cap) continue;
      const n = Math.min(free, x.finishNow);
      give[x.s.id] = n; free -= n;
    }
    for (const x of [...segs].sort((a, c) => c.left * v.segments[c.s.id].seasonMult - a.left * v.segments[a.s.id].seasonMult)) {
      if (free <= 0) break;
      const n = Math.min(free, x.cap - (give[x.s.id] || 0));
      if (n > 0) { give[x.s.id] = (give[x.s.id] || 0) + n; free -= n; }
    }
    for (const [id, n] of Object.entries(give)) state = tryAct(state, ch, { type: 'ASSIGN_CREWS', segmentId: id, crews: n });
    // Прошение, если казна пустеет, а благоволение позволяет
    if (state.treasury < 8000 && state.favor > 40) state = tryAct(state, ch, { type: 'PETITION_FUNDS' });
  }

  if (state.unlocked.rollingStock && !E.view(state, ch).hasRollingStock) {
    const locos = Object.entries(b.train.locomotives).filter(([, l]) => l.chapter === ch.id).map(([id]) => id);
    if (!Object.values(state.rollingStock.locomotives).some(n => n > 0)) state = tryAct(state, ch, { type: 'BUY', itemId: locos[0], qty: 1 });
    const need = (b.train.minCarriages[ch.id] || 1) - state.rollingStock.carriages;
    if (need > 0) state = tryAct(state, ch, { type: 'BUY', itemId: 'carriage', qty: need });
  }

  if (state.pendingEvents.length) return state;
  return E.applyAction(state, { type: 'END_SEASON' }, ch).state;
}

function playGame(ch, seed, strategy) {
  const rnd = botRng(seed * 7919 + strategy.length);
  let { state } = E.createGame(ch.id, ch, seed);
  let guard = 0;
  while (!state.finished && guard++ < 400) state = playTurn(state, ch, strategy, rnd);
  return state;
}

module.exports = { playGame, playTurn, chooseFor, botRng };
