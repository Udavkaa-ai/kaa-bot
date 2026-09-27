// Игровой движок Koleya. Чистые функции: никакого I/O, времени и Math.random.
// Случайность — только через createRng(state.rngState); состояние генератора
// сохраняется обратно в state, поэтому один сид и одна последовательность действий
// всегда дают один и тот же результат.
//
// ch — контент главы из koleya/content: { id, map, events, advisors, eventsById,
//      segmentsById, nodesById, facts, balance }.
'use strict';

const { createRng } = require('./rng');

class GameError extends Error {}
const fail = (msg) => { throw new GameError(msg); };

// ---------------- календарь ----------------

function seasonsOf(ch) { return ch.balance.seasons; }
function dateIndex(ch, year, season) { return year * 4 + seasonsOf(ch).indexOf(season); }
function stateDate(ch, state) { return dateIndex(ch, state.year, state.season); }
function chapterBalance(ch) { return ch.balance[ch.id]; }

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round1 = v => Math.round(v * 10) / 10;

// ---------------- участки: геометрия, стоимость, работа ----------------

function segmentIsActive(state, seg) {
  if (!seg.variant || seg.variant === 'both') return true;
  return seg.variant === state.routeVariant;
}

function activeSegments(state, ch) {
  return ch.map.segments.filter(s => segmentIsActive(state, s));
}

function featureValue(state, ch, seg, fid) {
  const own = state.segments[seg.id].features[fid];
  return own !== undefined ? own : ch.map.features[fid].default;
}

function segmentLength(state, seg) {
  return seg.length_km + (state.segments[seg.id].extraKm || 0);
}

function currentGauge(state, ch) { return state.gauge || ch.map.historical.gauge_mm; }
function currentTracks(state, ch) { return state.tracks || ch.map.historical.tracks; }

// Полная стоимость и объём работ участка при текущих решениях (колея, пути, мосты, обход).
function segmentTotals(state, ch, seg) {
  const b = ch.balance;
  const gauge = b.gauge[String(currentGauge(state, ch))];
  const tracks = b.tracks[String(currentTracks(state, ch))];
  const len = segmentLength(state, seg);
  let cost = 0, work = 0;
  for (const [t, share] of Object.entries(seg.terrain)) {
    cost += len * share * b.terrain[t].costPerKm;
    work += len * share * b.terrain[t].workPerKm;
  }
  cost *= gauge.costMult * tracks.costMult;
  work *= tracks.workMult;
  // Решения на всю главу (например, облегчённые технические условия)
  const mod = state.modifiers || {};
  cost *= mod.costMult || 1;
  work *= mod.workMult || 1;
  for (const fid of seg.features || []) {
    const f = ch.map.features[fid];
    if (f.kind === 'bridge') {
      const br = b.bridges[featureValue(state, ch, seg, fid)];
      cost += br.cost;
      work += br.work;
    }
  }
  // Переправа (паром или обходная дорога) меняет весь участок целиком
  for (const fid of seg.features || []) {
    const f = ch.map.features[fid];
    if (f.kind !== 'crossing') continue;
    const cr = b.crossing[featureValue(state, ch, seg, fid)];
    cost = cost * (cr.costMult ?? 1) + (cr.extraCost || 0);
    work *= cr.workMult ?? 1;
  }
  return { cost, work };
}

// Сезонный множитель участка — среднее по рельефу, взвешенное по объёму работ
function seasonMultiplier(ch, seg, season) {
  const b = ch.balance;
  let wSum = 0, mSum = 0;
  for (const [t, share] of Object.entries(seg.terrain)) {
    const w = share * b.terrain[t].workPerKm;
    wSum += w;
    mSum += w * b.seasonMultiplier[t][season];
  }
  return wSum ? mSum / wSum : 1;
}

function segmentProgress(state, ch, seg) {
  const s = state.segments[seg.id];
  if (s.opened) return 1;
  const { work } = segmentTotals(state, ch, seg);
  return work ? Math.min(1, s.workDone / work) : 0;
}

function overallProgress(state, ch) {
  let done = 0, total = 0;
  for (const seg of activeSegments(state, ch)) {
    const { work } = segmentTotals(state, ch, seg);
    total += work;
    done += state.segments[seg.id].opened ? work : Math.min(work, state.segments[seg.id].workDone);
  }
  return total ? done / total : 0;
}

function routeDecided(state, ch) {
  const hasVariants = ch.map.segments.some(s => s.variant && s.variant !== 'both');
  return !hasVariants || !!state.routeVariant;
}

function allOpened(state, ch) {
  return routeDecided(state, ch) && activeSegments(state, ch).every(s => state.segments[s.id].opened);
}

function assignedCrews(state) {
  return Object.values(state.segments).reduce((a, s) => a + s.crews, 0);
}

function maxCrewsFor(state, ch, seg) {
  return Math.max(1, Math.floor(segmentLength(state, seg) * ch.balance.crews.maxCrewsPerKm));
}

function hasRollingStock(state, ch) {
  const locos = Object.values(state.rollingStock.locomotives).reduce((a, n) => a + n, 0);
  const minCar = ch.balance.train.minCarriages[ch.id] || 1;
  return locos >= 1 && state.rollingStock.carriages >= minCar;
}

// ---------------- создание игры ----------------

// campaign — итоги прошлых глав (например, колея главы I переходит в следующие)
function createGame(chapterId, ch, seed, campaign = {}) {
  if (ch.id !== chapterId) fail('Контент не той главы');
  const cb = chapterBalance(ch);
  const hasGaugeDecision = ch.events.some(e => e.choices.some(c => c.effects?.set?.gauge));
  const segments = {};
  for (const seg of ch.map.segments) {
    segments[seg.id] = { crews: 0, workDone: 0, extraKm: 0, features: {}, opened: false, openedTurn: null };
  }
  const state = {
    v: 1,
    chapterId,
    seed: seed >>> 0,
    rngState: seed >>> 0,
    year: cb.startYear,
    season: cb.startSeason,
    turn: 0,
    treasury: cb.startTreasury,
    favor: cb.startFavor,
    morale: cb.startMorale,
    crewsTotal: cb.startCrews,
    pay: 'normal',
    decisions: {},
    flags: [],
    unlocked: { construction: false, rollingStock: false, quiz: false },
    routeVariant: null,
    modifiers: { costMult: 1, workMult: 1, speedMult: 1, incidentMult: 1 },
    gauge: hasGaugeDecision ? null : (campaign.gauge || ch.map.historical.gauge_mm),
    tracks: hasGaugeDecision ? null : ch.map.historical.tracks,
    segments,
    rollingStock: { locomotives: {}, carriages: 0 },
    pendingEvents: [],
    firedEvents: [],
    lastFired: {},
    decisionsLog: [],
    incidents: 0,
    extraRunRisk: 0,
    hiredThisSeason: 0,
    petitionCooldown: 0,
    skipNextSeason: false,
    spent: { construction: 0, pay: 0, hire: 0, events: 0, stock: 0 },
    income: { allocation: 0, revenue: 0, petition: 0 },
    completedAt: null,
    firstRun: null,
    finished: false,
    outcome: null,
    score: null,
  };
  const rng = createRng(state.rngState);
  const log = [];
  queueEvents(state, ch, rng, { phase: 'start' }, log);
  state.rngState = rng.state();
  return { state, log };
}

// ---------------- события: триггеры ----------------

function isRepeatable(ch, id) { return (ch.balance.events?.repeatable || []).includes(id); }

function eventAvailable(state, ch, ev) {
  if (state.pendingEvents.includes(ev.id)) return false;
  if (!state.firedEvents.includes(ev.id)) return true;
  if (!isRepeatable(ch, ev.id)) return false;
  const last = state.lastFired[ev.id];
  return last === undefined || state.turn - last >= (ch.balance.events.repeatCooldownTurns || 1);
}

// ctx.phase: 'start' | 'chain' (ctx.after — id решённого события) | 'action' | 'season'
function triggerMet(state, ch, ev, ctx, rng) {
  const t = ev.trigger || {};
  if (t.atTurn !== undefined) return ctx.phase === 'start' && state.turn === t.atTurn;
  if (t.afterEvent !== undefined) return ctx.phase === 'chain' && ctx.after === t.afterEvent;
  if (ctx.phase === 'start' || ctx.phase === 'chain') return false;

  // Случайные события и всё с шансом — только на границе сезона и только когда стройка идёт
  const needsSeason = t.chance !== undefined || ev.type === 'random';
  if (needsSeason && ctx.phase !== 'season') return false;
  if (ev.type === 'random' && !state.unlocked.construction) return false;

  if (t.variant !== undefined && state.routeVariant !== t.variant) return false;
  if (t.season !== undefined && t.atYear === undefined && state.season !== t.season) return false;
  if (t.atYear !== undefined) {
    if (stateDate(ch, state) < dateIndex(ch, t.atYear, t.season || seasonsOf(ch)[0])) return false;
  }
  if (t.moraleLte !== undefined && !(state.morale <= t.moraleLte)) return false;
  if (t.favorLte !== undefined && !(state.favor <= t.favorLte)) return false;
  if (t.segmentUnopened) {
    const seg = ch.segmentsById[t.segmentUnopened];
    if (!seg || !segmentIsActive(state, seg) || state.segments[seg.id].opened) return false;
  }
  if (t.segmentProgress) {
    const seg = ch.segmentsById[t.segmentProgress.segment];
    if (!seg || !segmentIsActive(state, seg)) return false;
    if (segmentProgress(state, ch, seg) < t.segmentProgress.gte) return false;
  }
  if (t.openedSegmentsGte !== undefined) {
    const opened = activeSegments(state, ch).filter(s => state.segments[s.id].opened);
    if (opened.length < t.openedSegmentsGte) return false;
    if (t.segment && !state.segments[t.segment]?.opened) return false;
  }
  if (t.overallProgressGte !== undefined) {
    if (!routeDecided(state, ch) || overallProgress(state, ch) < t.overallProgressGte) return false;
  }
  if (t.allSegmentsOpened && !allOpened(state, ch)) return false;
  if (t.firstRunReady && !(allOpened(state, ch) && hasRollingStock(state, ch))) return false;
  // Событие с отправкой поезда без паровоза и вагонов бессмысленно — ждём состав
  if (ev.choices.some(c => c.effects?.runFirstTrain) && !hasRollingStock(state, ch)) return false;
  if (t.terrainActive) {
    const any = activeSegments(state, ch).some(s => {
      const ss = state.segments[s.id];
      return !ss.opened && ss.crews > 0 && (s.terrain[t.terrainActive] || 0) > 0;
    });
    if (!any) return false;
  }
  if (t.chance !== undefined && !(rng.next() < t.chance)) return false;
  return true;
}

function queueEvents(state, ch, rng, ctx, log) {
  const found = [];
  for (const ev of ch.events) {
    if (state.finished) break;
    if (!eventAvailable(state, ch, ev)) continue;
    if (triggerMet(state, ch, ev, ctx, rng)) found.push(ev.id);
  }
  if (!found.length) return;
  // Цепочку (afterEvent) ставим в начало очереди — она продолжает только что решённое
  if (ctx.phase === 'chain') state.pendingEvents.unshift(...found);
  else state.pendingEvents.push(...found);
  for (const id of found) log.push({ kind: 'event', eventId: id });
}

// ---------------- эффекты ----------------

function applyEffects(state, ch, effects, rng, log) {
  const b = ch.balance;
  for (const [k, v] of Object.entries(effects || {})) {
    switch (k) {
      case 'treasury':
        state.treasury += v;
        if (v < 0) state.spent.events += -v;
        break;
      case 'favor': state.favor = clamp(state.favor + v, b.favorMin, b.favorMax); break;
      case 'morale': state.morale = clamp(state.morale + v, b.moraleMin, b.moraleMax); break;
      case 'set':
        for (const [sk, sv] of Object.entries(v)) {
          if (sk === 'gauge' || sk === 'tracks') state[sk] = Number(sv);
          else state[sk] = sv;
        }
        break;
      case 'flag': if (!state.flags.includes(v)) state.flags.push(v); break;
      case 'unlock':
        state.unlocked[v] = true;
        if (v === 'construction') jumpToConstructionStart(state, ch, log);
        break;
      case 'segmentFeature':
        state.segments[v.segment].features[v.feature] = v.value;
        break;
      case 'addLengthKm':
        state.segments[v.segment].extraKm += v.km;
        break;
      case 'segmentWork': {
        const seg = pickSegmentForWork(state, ch, v.target);
        if (seg) {
          const ss = state.segments[seg.id];
          ss.workDone = Math.max(0, ss.workDone + v.delta);
          log.push({ kind: 'segmentWork', segment: seg.id, delta: v.delta });
        }
        break;
      }
      case 'incidentRisk': state.extraRunRisk += v; break;
      case 'modifier':
        state.modifiers = state.modifiers || { costMult: 1, workMult: 1, speedMult: 1, incidentMult: 1 };
        for (const [mk, mv] of Object.entries(v)) state.modifiers[mk] = (state.modifiers[mk] || 1) * mv;
        break;
      case 'crews':
        state.crewsTotal = Math.max(0, state.crewsTotal + v);
        log.push({ kind: 'crews', amount: v });
        break;
      case 'skipSeason': state.skipNextSeason = true; break;
      case 'runFirstTrain': {
        const run = simulateFirstTrain(state, ch, rng);
        state.firstRun = run;
        if (run.incidents) {
          state.incidents += run.incidents;
          state.favor = clamp(state.favor - run.incidents * (chapterBalance(ch).favor?.incidentPenalty || 0), b.favorMin, b.favorMax);
        }
        log.push({ kind: 'firstRun', minutes: run.minutes, historicalMinutes: run.historicalMinutes, incidents: run.incidents });
        break;
      }
      default: fail(`Неизвестный эффект ${k}`);
    }
  }
}

function pickSegmentForWork(state, ch, target) {
  if (target !== 'activeSwamp') return ch.segmentsById[target] || null;
  const cands = activeSegments(state, ch).filter(s => !state.segments[s.id].opened && (s.terrain.swamp || 0) > 0);
  cands.sort((a, b) => state.segments[b.id].crews - state.segments[a.id].crews || (b.terrain.swamp - a.terrain.swamp));
  return cands[0] || null;
}

// Изыскания и проект занимают время: при открытии стройки календарь переводится
// на начало работ из balance (для главы 1 — лето 1843).
function jumpToConstructionStart(state, ch, log) {
  const cs = chapterBalance(ch).constructionStart;
  if (!cs) return;
  if (stateDate(ch, state) >= dateIndex(ch, cs.year, cs.season)) return;
  state.year = cs.year;
  state.season = cs.season;
  log.push({ kind: 'timeJump', year: cs.year, season: cs.season });
}

// ---------------- действия ----------------

function applyAction(stateIn, action, ch) {
  if (!action || typeof action.type !== 'string') fail('Нет действия');
  const state = structuredClone(stateIn);
  const rng = createRng(state.rngState);
  const log = [];
  if (state.finished && action.type !== 'NOOP') fail('Глава уже завершена');
  if (state.pendingEvents.length && action.type !== 'CHOOSE') fail('Сначала ответьте на депешу');

  switch (action.type) {
    case 'CHOOSE': choose(state, ch, action, rng, log); break;
    case 'ASSIGN_CREWS': assignCrews(state, ch, action); break;
    case 'HIRE_CREWS': hireCrews(state, ch, action, log); break;
    case 'DISMISS_CREWS': dismissCrews(state, action, log); break;
    case 'SET_PAY':
      if (!ch.balance.crews.pay[action.level]) fail('Нет такого уровня оплаты');
      state.pay = action.level;
      break;
    case 'BUY': buy(state, ch, action, log); break;
    case 'PETITION_FUNDS': petition(state, ch, log); break;
    case 'SET_FEATURE': setFeature(state, ch, action); break;
    case 'END_SEASON': endSeason(state, ch, rng, log); break;
    default: fail(`Неизвестное действие ${action.type}`);
  }
  if (!state.finished && action.type !== 'END_SEASON') queueEvents(state, ch, rng, { phase: 'action' }, log);
  state.rngState = rng.state();
  return { state, log };
}

function choose(state, ch, action, rng, log) {
  const evId = state.pendingEvents[0];
  if (!evId || action.eventId !== evId) fail('Эта депеша сейчас не на столе');
  const ev = ch.eventsById[evId];
  const choice = ev.choices.find(c => c.id === action.choiceId);
  if (!choice) fail('Нет такого варианта');
  state.pendingEvents.shift();
  applyEffects(state, ch, choice.effects, rng, log);
  state.decisions[ev.id] = choice.id;
  if (!state.firedEvents.includes(ev.id)) state.firedEvents.push(ev.id);
  state.lastFired[ev.id] = state.turn;
  if (ev.type === 'decision') {
    state.decisionsLog.push({
      eventId: ev.id, choiceId: choice.id, turn: state.turn,
      historicalChoiceId: ev.history ? ev.history.choiceId : null,
    });
  }
  log.push({ kind: 'resolved', eventId: ev.id, choiceId: choice.id });

  // Финал главы: викторина открыта или отправлен поезд, за которым уже ничего не следует
  const hasFollowUp = ch.events.some(e => e.trigger?.afterEvent === ev.id);
  if (choice.effects?.unlock === 'quiz' || (choice.effects?.runFirstTrain && !hasFollowUp)) {
    finishChapter(state, ch, 'won', log);
    return;
  }
  queueEvents(state, ch, rng, { phase: 'chain', after: ev.id }, log);
}

function requireConstruction(state) {
  if (!state.unlocked.construction) fail('Строительство ещё не открыто');
}

function assignCrews(state, ch, { segmentId, crews }) {
  requireConstruction(state);
  const seg = ch.segmentsById[segmentId];
  if (!seg || !segmentIsActive(state, seg)) fail('Такого участка на трассе нет');
  const ss = state.segments[segmentId];
  if (ss.opened) fail('Участок уже открыт');
  if (!Number.isInteger(crews) || crews < 0) fail('Число артелей — целое и не отрицательное');
  const cap = maxCrewsFor(state, ch, seg);
  if (crews > cap) fail(`На этом участке помещается не больше ${cap} артелей`);
  const freeAfter = state.crewsTotal - (assignedCrews(state) - ss.crews) - crews;
  if (freeAfter < 0) fail('Столько свободных артелей нет — наймите ещё');
  ss.crews = crews;
}

function hireCrews(state, ch, { amount }, log) {
  requireConstruction(state);
  const c = ch.balance.crews;
  if (!Number.isInteger(amount) || amount < 1) fail('Сколько артелей нанять?');
  if (state.hiredThisSeason + amount > c.maxHirePerSeason) {
    fail(`За сезон можно нанять не больше ${c.maxHirePerSeason} артелей`);
  }
  const cost = amount * c.hireCostPerCrew;
  if (state.treasury < cost) fail('В казне не хватает денег на наём');
  state.treasury -= cost;
  state.spent.hire += cost;
  state.crewsTotal += amount;
  state.hiredThisSeason += amount;
  log.push({ kind: 'hired', amount, cost });
}

function dismissCrews(state, { amount }, log) {
  if (!Number.isInteger(amount) || amount < 1) fail('Сколько артелей распустить?');
  const free = state.crewsTotal - assignedCrews(state);
  if (amount > free) fail('Распустить можно только свободные артели — сначала снимите их с участков');
  state.crewsTotal -= amount;
  log.push({ kind: 'dismissed', amount });
}

function buy(state, ch, { itemId, qty }, log) {
  if (!state.unlocked.rollingStock) fail('Закупки подвижного состава ещё не открыты');
  if (!Number.isInteger(qty) || qty < 1 || qty > 50) fail('Количество — от 1 до 50');
  const t = ch.balance.train;
  let unit;
  if (itemId === 'carriage') unit = t.carriageCost;
  else {
    const loco = t.locomotives[itemId];
    if (!loco || loco.chapter !== ch.id) fail('Такой паровоз в эту эпоху не купить');
    unit = loco.cost;
  }
  const cost = unit * qty;
  if (state.treasury < cost) fail('В казне не хватает денег');
  state.treasury -= cost;
  state.spent.stock += cost;
  if (itemId === 'carriage') state.rollingStock.carriages += qty;
  else state.rollingStock.locomotives[itemId] = (state.rollingStock.locomotives[itemId] || 0) + qty;
  log.push({ kind: 'bought', itemId, qty, cost });
}

function petition(state, ch, log) {
  const p = chapterBalance(ch).petition;
  if (!p) fail('В этой главе прошений нет');
  if (!state.unlocked.construction) fail('Сначала начните строительство');
  if (state.petitionCooldown > 0) fail(`Новое прошение можно подать через ${state.petitionCooldown} сез.`);
  state.treasury += p.amount;
  state.income.petition += p.amount;
  state.favor = clamp(state.favor - p.favorCost, ch.balance.favorMin, ch.balance.favorMax);
  state.petitionCooldown = p.cooldownSeasons;
  log.push({ kind: 'petition', amount: p.amount, favorCost: p.favorCost });
  checkRemoval(state, ch, log);
}

function setFeature(state, ch, { segmentId, feature, value }) {
  const seg = ch.segmentsById[segmentId];
  if (!seg || !segmentIsActive(state, seg)) fail('Такого участка на трассе нет');
  if (!(seg.features || []).includes(feature)) fail('У участка нет такой особенности');
  const f = ch.map.features[feature];
  if (f.event) fail('Это решение принимается депешей');
  if (!f.options.includes(value)) fail('Нет такого варианта');
  if (state.segments[segmentId].opened || segmentProgress(state, ch, seg) >= ch.balance.featureLockProgress) {
    fail('Работы зашли слишком далеко, переделывать поздно');
  }
  state.segments[segmentId].features[feature] = value;
}

// ---------------- сезон ----------------

function endSeason(state, ch, rng, log) {
  const b = ch.balance;
  const cb = chapterBalance(ch);
  const c = b.crews;
  const season = state.season;
  const report = { kind: 'season', year: state.year, season, pay: 0, materials: 0, revenue: 0, allocation: 0, progress: {} };
  log.push(report);

  // 1. Жалованье всем артелям, включая резерв
  const pay = c.pay[state.pay];
  const payCost = state.crewsTotal * pay.costPerCrew;
  if (state.treasury >= payCost) {
    state.treasury -= payCost;
    state.spent.pay += payCost;
    report.pay = payCost;
  } else {
    const paid = Math.max(0, state.treasury);
    state.treasury -= paid;
    state.spent.pay += paid;
    report.pay = paid;
    state.morale -= c.unpaidMoralePenalty;
    state.favor -= c.unpaidFavorPenalty || 0;
    log.push({ kind: 'unpaid', owed: payCost - paid });
  }
  state.morale = clamp(state.morale + pay.moraleDeltaPerSeason, b.moraleMin, b.moraleMax);

  // 2. Работы на участках
  if (state.unlocked.construction) {
    if (state.skipNextSeason) {
      state.skipNextSeason = false;
      log.push({ kind: 'skipped' });
    } else {
      const jobs = [];
      for (const seg of activeSegments(state, ch)) {
        const ss = state.segments[seg.id];
        if (ss.opened || ss.crews <= 0) continue;
        const { cost, work } = segmentTotals(state, ch, seg);
        const potential = ss.crews * c.workPerCrewPerSeason * seasonMultiplier(ch, seg, season) * (state.morale / 100);
        const delta = Math.max(0, Math.min(potential, work - ss.workDone));
        if (delta > 0) jobs.push({ seg, delta, materials: delta * (cost / work) });
      }
      const need = jobs.reduce((a, j) => a + j.materials, 0);
      const available = Math.max(0, state.treasury);
      const k = need > available ? (need ? available / need : 0) : 1;
      if (k < 1) log.push({ kind: 'noMoney', share: round1(k * 100) });
      for (const j of jobs) {
        const ss = state.segments[j.seg.id];
        ss.workDone += j.delta * k;
        state.treasury -= j.materials * k;
        state.spent.construction += j.materials * k;
        report.materials += j.materials * k;
        report.progress[j.seg.id] = round1(j.delta * k);
      }
      // Открытие готовых участков
      for (const seg of activeSegments(state, ch)) {
        const ss = state.segments[seg.id];
        if (ss.opened) continue;
        const { work } = segmentTotals(state, ch, seg);
        if (ss.workDone >= work - 1e-6) {
          ss.workDone = work;
          ss.opened = true;
          ss.openedTurn = state.turn;
          const freed = ss.crews;
          ss.crews = 0;
          state.favor = clamp(state.favor + (cb.favor?.milestoneBonus || 0), b.favorMin, b.favorMax);
          log.push({ kind: 'opened', segment: seg.id, freed });
        }
      }
    }
  }

  // 3. Доход с открытых участков
  const tracksB = b.tracks[String(currentTracks(state, ch))];
  let revenue = 0;
  for (const seg of activeSegments(state, ch)) {
    if (!state.segments[seg.id].opened) continue;
    let r = segmentLength(state, seg) * (cb.revenuePerOpenKmPerSeason || 0) * tracksB.revenueMult;
    if (seg.variant === 'novgorod') r *= cb.novgorodRevenueBonus || 1;
    revenue += r;
  }
  state.treasury += revenue;
  state.income.revenue += revenue;
  report.revenue = revenue;

  // 4. Счётчики сезона
  if (state.petitionCooldown > 0) state.petitionCooldown--;
  state.hiredThisSeason = 0;

  // 5. Календарь
  const seasons = seasonsOf(ch);
  const idx = seasons.indexOf(state.season);
  if (idx === seasons.length - 1) { state.year++; state.season = seasons[0]; }
  else state.season = seasons[idx + 1];
  state.turn++;

  if (!state.completedAt && allOpened(state, ch)) {
    state.completedAt = { year: state.year, season: state.season, turn: state.turn };
    log.push({ kind: 'allOpened' });
  }

  // Ежегодные ассигнования — весной, пока идёт стройка
  if (state.season === seasons[0] && state.unlocked.construction && cb.yearlyAllocation) {
    state.treasury += cb.yearlyAllocation;
    state.income.allocation += cb.yearlyAllocation;
    report.allocation = cb.yearlyAllocation;
  }

  // 6. Сроки: после дедлайна благоволение тает каждый сезон, до него — если сильно отстаём
  if (cb.deadline && state.unlocked.construction && !state.completedAt) {
    const now = stateDate(ch, state);
    const deadline = dateIndex(ch, cb.deadline.year, cb.deadline.season);
    if (now > deadline) {
      state.favor -= cb.favor?.seasonLatePenalty || 0;
      log.push({ kind: 'late', seasons: now - deadline });
    } else if (cb.behindSchedule && cb.constructionStart) {
      const start = dateIndex(ch, cb.constructionStart.year, cb.constructionStart.season);
      const expected = (now - start) / Math.max(1, deadline - start);
      if (overallProgress(state, ch) < expected - cb.behindSchedule.lagShare) {
        state.favor -= cb.behindSchedule.favorPenalty;
        log.push({ kind: 'behind', expected: round1(expected * 100), actual: round1(overallProgress(state, ch) * 100) });
      }
    }
  }
  state.favor = clamp(state.favor, b.favorMin, b.favorMax);
  state.morale = clamp(state.morale, b.moraleMin, b.moraleMax);

  // 7. Поражение
  if (checkRemoval(state, ch, log)) return;
  if (state.turn >= cb.maxTurns) {
    finishChapter(state, ch, 'timeout', log);
    return;
  }

  // 8. События сезона
  queueEvents(state, ch, rng, { phase: 'season' }, log);
}

function checkRemoval(state, ch, log) {
  if (state.favor > ch.balance.favorMin) return false;
  finishChapter(state, ch, 'removed', log);
  return true;
}

function finishChapter(state, ch, outcome, log) {
  state.finished = true;
  state.outcome = outcome;
  state.pendingEvents = [];
  state.score = outcome === 'won' ? scoreChapter(state, ch) : null;
  log.push({ kind: 'finished', outcome });
}

// ---------------- первый поезд ----------------

// Путь по открытым участкам трассы от узла до узла (BFS по графу участков).
function findPath(state, ch, from, to) {
  const segs = activeSegments(state, ch);
  const prev = { [from]: null };
  const queue = [from];
  while (queue.length) {
    const node = queue.shift();
    if (node === to) break;
    for (const s of segs) {
      const next = s.from === node ? s.to : s.to === node ? s.from : null;
      if (next && !(next in prev)) { prev[next] = { node, seg: s }; queue.push(next); }
    }
  }
  if (!(to in prev)) return null;
  const path = [];
  for (let n = to; prev[n]; n = prev[n].node) path.unshift({ seg: prev[n].seg, from: prev[n].node, to: n });
  return path;
}

function simulateFirstTrain(state, ch, rng) {
  const b = ch.balance;
  const fr = ch.map.historical.firstRun;
  const path = findPath(state, ch, fr.from, fr.to);
  if (!path) fail('Трасса не связана — поезду не пройти');
  if (!path.every(p => state.segments[p.seg.id].opened)) fail('Не все участки на пути открыты');
  const owned = Object.entries(state.rollingStock.locomotives).filter(([, n]) => n > 0).map(([id]) => id);
  if (!owned.length) fail('Нет паровоза');
  const locoId = owned.sort((a, bb) => b.train.locomotives[bb].baseSpeedKmh - b.train.locomotives[a].baseSpeedKmh)[0];
  const loco = b.train.locomotives[locoId];
  const tracks = String(currentTracks(state, ch));
  const mod = state.modifiers || {};
  const speed = loco.baseSpeedKmh * b.gauge[String(currentGauge(state, ch))].speedMult * (mod.speedMult || 1);

  let minutes = 0, km = 0, incidents = 0;
  const legs = [];
  for (const { seg, to } of path) {
    const len = segmentLength(state, seg);
    let capped = 0, cap = speed, risk = 0;
    for (const fid of seg.features || []) {
      const f = ch.map.features[fid];
      if (f.kind !== 'grade') continue;
      const g = b.grade[featureValue(state, ch, seg, fid)];
      if (g.speedCapKmh) { capped += Math.min(len, g.cappedKm || 0); cap = Math.min(cap, g.speedCapKmh); }
      risk += (g.incidentRiskPerRun || 0) * b.tracks[tracks].incidentMult;
    }
    risk *= mod.incidentMult || 1;
    let legMin = ((len - capped) / speed + capped / cap) * 60;
    for (const fid of seg.features || []) {
      const f = ch.map.features[fid];
      if (f.kind !== 'crossing') continue;
      const cr = b.crossing[featureValue(state, ch, seg, fid)];
      legMin += cr.extraRunMinutes || 0;
      if (cr.incidentRiskPerRun && rng.next() < cr.incidentRiskPerRun * (mod.incidentMult || 1)) {
        incidents++; legMin += b.train.incidentDelayMinutes;
      }
    }
    let incident = false;
    if (risk > 0 && rng.next() < risk) {
      incident = true;
      incidents++;
      legMin += b.train.incidentDelayMinutes;
    }
    minutes += legMin;
    km += len;
    legs.push({ segment: seg.id, to, km: round1(len), minutes: Math.round(legMin), incident });
  }
  // Общий риск (например, от ранних поездок с публикой)
  if (state.extraRunRisk > 0 && rng.next() < state.extraRunRisk) {
    incidents++;
    minutes += b.train.incidentDelayMinutes;
    legs.push({ segment: null, to: null, km: 0, minutes: b.train.incidentDelayMinutes, incident: true });
  }
  const stops = Math.max(0, path.length - 1);
  minutes += stops * (b.train.stopMinutesPerStation + (b.train.meetDelayMinutesPerStation[tracks] || 0));
  return {
    minutes: Math.round(minutes),
    historicalMinutes: fr.minutes,
    km: round1(km),
    locomotive: locoId,
    stops,
    incidents,
    legs,
  };
}

// ---------------- итог главы ----------------

function starsFor(value, thresholds) {
  return Math.max(0, 5 - thresholds.filter(th => value > th).length);
}

function scoreChapter(state, ch) {
  const b = ch.balance;
  const th = b.score.thresholds;
  const cb = chapterBalance(ch);
  const scales = [];

  if (cb.deadline && state.completedAt) {
    const late = Math.max(0, dateIndex(ch, state.completedAt.year, state.completedAt.season) - dateIndex(ch, cb.deadline.year, cb.deadline.season));
    scales.push({ id: 'deadline', stars: starsFor(late, th.deadlineLateSeasons), value: late });
  }
  const spent = Object.values(state.spent).reduce((a, v) => a + v, 0);
  const plan = b.score.treasuryPlan[ch.id];
  if (plan) scales.push({ id: 'treasury', stars: starsFor(spent / plan, th.treasurySpentToPlan), value: Math.round(spent), plan });
  scales.push({ id: 'reliability', stars: starsFor(state.incidents, th.incidents), value: state.incidents });
  if (state.firstRun && state.firstRun.historicalMinutes) {
    const ratio = state.firstRun.minutes / state.firstRun.historicalMinutes;
    scales.push({ id: 'speed', stars: starsFor(ratio, th.trainTimeToHistorical), value: state.firstRun.minutes, historical: state.firstRun.historicalMinutes });
  }
  // «Как у Мельникова»: сколько ключевых решений совпало с историческими (из тех, что игрок видел)
  let keyIds = (b.score.historicalDecisions || []).filter(id => ch.eventsById[id]);
  if (!keyIds.length) keyIds = ch.events.filter(e => e.type === 'decision' && e.history?.choiceId).map(e => e.id);
  const seen = state.decisionsLog.filter(d => keyIds.includes(d.eventId));
  const matched = seen.filter(d => d.choiceId === d.historicalChoiceId);
  if (seen.length) {
    scales.push({ id: 'history', stars: Math.round(5 * matched.length / seen.length), value: matched.length, of: seen.length });
  }
  const total = scales.reduce((a, s) => a + s.stars, 0);
  return { scales, total, max: scales.length * 5 };
}

// ---------------- что видел игрок ----------------

// Факты, которые игрок встретил: ссылки решённых событий и их участков.
function seenFactIds(state, ch) {
  const ids = new Set();
  for (const evId of state.firedEvents) for (const r of ch.eventsById[evId]?.fact_refs || []) ids.add(r);
  return [...ids];
}

// Сводка для клиента: всё, что вычисляется, чтобы клиент не дублировал формулы.
function view(state, ch) {
  const segs = {};
  for (const seg of ch.map.segments) {
    const active = segmentIsActive(state, seg);
    const { cost, work } = segmentTotals(state, ch, seg);
    const ss = state.segments[seg.id];
    segs[seg.id] = {
      active,
      opened: ss.opened,
      crews: ss.crews,
      progress: round1(segmentProgress(state, ch, seg) * 100),
      workDone: round1(ss.opened ? work : ss.workDone),
      work: round1(work),
      cost: Math.round(cost),
      costLeft: Math.round(ss.opened ? 0 : cost * (1 - Math.min(1, ss.workDone / work))),
      lengthKm: round1(segmentLength(state, seg)),
      maxCrews: maxCrewsFor(state, ch, seg),
      seasonMult: round1(seasonMultiplier(ch, seg, state.season) * 100) / 100,
      features: Object.fromEntries((seg.features || []).map(f => [f, featureValue(state, ch, seg, f)])),
      featureLocked: ss.opened || segmentProgress(state, ch, seg) >= ch.balance.featureLockProgress,
    };
  }
  const cb = chapterBalance(ch);
  const pay = ch.balance.crews.pay[state.pay];
  const spentTotal = Object.values(state.spent).reduce((a, v) => a + v, 0);
  return {
    segments: segs,
    overallProgress: round1(overallProgress(state, ch) * 100),
    assignedCrews: assignedCrews(state),
    freeCrews: state.crewsTotal - assignedCrews(state),
    payPerSeason: state.crewsTotal * pay.costPerCrew,
    hireLeft: ch.balance.crews.maxHirePerSeason - state.hiredThisSeason,
    hasRollingStock: hasRollingStock(state, ch),
    allOpened: allOpened(state, ch),
    deadline: cb.deadline || null,
    spentTotal: Math.round(spentTotal),
  };
}

module.exports = {
  GameError,
  createGame,
  applyAction,
  simulateFirstTrain,
  scoreChapter,
  seenFactIds,
  view,
  // для тестов и симулятора
  _internal: { segmentTotals, seasonMultiplier, overallProgress, activeSegments, allOpened, hasRollingStock, dateIndex, maxCrewsFor },
};
