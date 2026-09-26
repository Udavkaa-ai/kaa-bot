'use strict';
// Тесты движка Koleya: node --test koleya/test
const test = require('node:test');
const assert = require('node:assert/strict');
const content = require('../content');
const E = require('../engine');
const { createRng } = require('../engine/rng');
const { playGame } = require('../scripts/bots');

const ch1 = content.chapter('chapter1');
const pro = content.chapter('prologue');
const act = (s, a, ch = ch1) => E.applyAction(s, a, ch).state;

// Прогнать стартовые депеши главы 1 историческими решениями
function afterIntro(seed = 1) {
  let { state } = E.createGame('chapter1', ch1, seed);
  while (state.pendingEvents.length) {
    const ev = ch1.eventsById[state.pendingEvents[0]];
    state = act(state, { type: 'CHOOSE', eventId: ev.id, choiceId: ev.history?.choiceId || ev.choices[0].id });
  }
  return state;
}

test('rng: одинаковый сид — одинаковая последовательность', () => {
  const a = createRng(123), b = createRng(123);
  for (let i = 0; i < 100; i++) assert.equal(a.next(), b.next());
  const c = createRng(124);
  assert.notEqual(createRng(123).next(), c.next());
});

test('контент проходит валидацию', () => {
  assert.deepEqual(content.validate(), []);
});

test('createGame: стартовые значения из balance и первая депеша', () => {
  const { state } = E.createGame('chapter1', ch1, 7);
  const cb = ch1.balance.chapter1;
  assert.equal(state.treasury, cb.startTreasury);
  assert.equal(state.favor, cb.startFavor);
  assert.equal(state.year, cb.startYear);
  assert.deepEqual(state.pendingEvents, ['E01']);
  assert.equal(state.gauge, null, 'колею выбирает игрок');
});

test('пролог: колея и пути — исторические, выбора нет', () => {
  const { state } = E.createGame('prologue', pro, 1);
  assert.equal(state.gauge, 1829);
  assert.equal(state.tracks, 1);
  assert.deepEqual(state.pendingEvents, ['P01']);
});

test('цепочка депеш: E01 → E03 → E04 → E05 → E06, стройка с лета 1843', () => {
  let { state } = E.createGame('chapter1', ch1, 1);
  const order = [];
  while (state.pendingEvents.length) {
    const id = state.pendingEvents[0];
    order.push(id);
    const ev = ch1.eventsById[id];
    state = act(state, { type: 'CHOOSE', eventId: id, choiceId: ev.history?.choiceId || ev.choices[0].id });
  }
  assert.deepEqual(order, ['E01', 'E03', 'E04', 'E05', 'E06']);
  assert.equal(state.routeVariant, 'direct');
  assert.equal(state.gauge, 1524);
  assert.equal(state.tracks, 2);
  assert.ok(state.unlocked.construction);
  assert.equal(state.year, 1843);
  assert.equal(state.season, 'summer');
});

test('нельзя действовать, пока на столе депеша', () => {
  const { state } = E.createGame('chapter1', ch1, 1);
  assert.throws(() => act(state, { type: 'END_SEASON' }), /депеш/);
  assert.throws(() => act(state, { type: 'CHOOSE', eventId: 'E04', choiceId: '1524' }), /не на столе/);
});

test('детерминизм: один сид и одни действия — один результат', () => {
  const a = playGame(ch1, 99, 'random');
  const b = playGame(ch1, 99, 'random');
  assert.deepEqual(a, b);
});

test('состояние не мутируется: applyAction возвращает новый объект', () => {
  const s = afterIntro();
  const copy = JSON.stringify(s);
  act(s, { type: 'HIRE_CREWS', amount: 5 });
  assert.equal(JSON.stringify(s), copy);
});

test('артели: наём, лимит за сезон, распределение, роспуск', () => {
  let s = afterIntro();
  const c = ch1.balance.crews;
  const t0 = s.treasury;
  s = act(s, { type: 'HIRE_CREWS', amount: 10 });
  assert.equal(s.crewsTotal, 10);
  assert.equal(s.treasury, t0 - 10 * c.hireCostPerCrew);
  assert.throws(() => act(s, { type: 'HIRE_CREWS', amount: c.maxHirePerSeason }), /не больше/);
  s = act(s, { type: 'ASSIGN_CREWS', segmentId: 'spb_kolpino', crews: 6 });
  assert.throws(() => act(s, { type: 'ASSIGN_CREWS', segmentId: 'kolpino_tosno', crews: 5 }), /свободных/);
  assert.throws(() => act(s, { type: 'DISMISS_CREWS', amount: 5 }), /свободные/);
  s = act(s, { type: 'DISMISS_CREWS', amount: 4 });
  assert.equal(s.crewsTotal, 6);
  assert.throws(() => act(s, { type: 'ASSIGN_CREWS', segmentId: 'chudovo_novgorod', crews: 1 }), /нет/);
  assert.throws(() => act(s, { type: 'ASSIGN_CREWS', segmentId: 'spb_kolpino', crews: 999 }), /не больше/);
});

test('сезон: жалованье, прогресс по формуле, календарь', () => {
  let s = afterIntro();
  s = act(s, { type: 'HIRE_CREWS', amount: 10 });
  s = act(s, { type: 'ASSIGN_CREWS', segmentId: 'spb_kolpino', crews: 10 });
  const b = ch1.balance;
  const seg = ch1.segmentsById.spb_kolpino;
  const expected = 10 * b.crews.workPerCrewPerSeason * E._internal.seasonMultiplier(ch1, seg, 'summer') * (s.morale / 100);
  const before = s.treasury;
  const { cost, work } = E._internal.segmentTotals(s, ch1, seg);
  const r = E.applyAction(s, { type: 'END_SEASON' }, ch1);
  const s2 = r.state;
  assert.ok(Math.abs(s2.segments.spb_kolpino.workDone - expected) < 1e-6);
  const paid = 10 * b.crews.pay.normal.costPerCrew;
  assert.ok(Math.abs(before - paid - expected * cost / work - s2.treasury) < 1e-6);
  assert.equal(s2.season, 'autumn');
  assert.equal(s2.turn, s.turn + 1);
});

test('без денег работы встают, без жалованья падает настрой', () => {
  let s = afterIntro();
  s = act(s, { type: 'HIRE_CREWS', amount: 10 });
  s = act(s, { type: 'ASSIGN_CREWS', segmentId: 'spb_kolpino', crews: 10 });
  s.treasury = 100; // меньше жалованья 10 артелей
  const morale = s.morale;
  const r = E.applyAction(s, { type: 'END_SEASON' }, ch1);
  assert.equal(r.state.segments.spb_kolpino.workDone, 0);
  assert.ok(r.state.morale < morale);
  assert.ok(r.log.some(l => l.kind === 'unpaid'));
});

test('участок открывается, артели освобождаются, благоволение растёт', () => {
  let s = afterIntro();
  s = act(s, { type: 'HIRE_CREWS', amount: 12 });
  s = act(s, { type: 'ASSIGN_CREWS', segmentId: 'spb_kolpino', crews: 12 });
  const { work } = E._internal.segmentTotals(s, ch1, ch1.segmentsById.spb_kolpino);
  s.segments.spb_kolpino.workDone = work - 1;
  const favor = s.favor;
  const r = E.applyAction(s, { type: 'END_SEASON' }, ch1);
  assert.ok(r.state.segments.spb_kolpino.opened);
  assert.equal(r.state.segments.spb_kolpino.crews, 0);
  assert.ok(r.state.favor >= favor + ch1.balance.chapter1.favor.milestoneBonus - ch1.balance.chapter1.behindSchedule.favorPenalty);
  assert.ok(r.log.some(l => l.kind === 'opened' && l.segment === 'spb_kolpino'));
});

test('колея и число путей меняют стоимость и объём работ', () => {
  const s = afterIntro();
  const seg = ch1.segmentsById.tver_klin;
  const t2 = E._internal.segmentTotals(s, ch1, seg);
  const one = { ...s, tracks: 1, gauge: 1435 };
  const t1 = E._internal.segmentTotals(one, ch1, seg);
  assert.ok(t1.cost < t2.cost);
  assert.ok(t1.work < t2.work);
});

test('Веребье: обход удлиняет участок и стоит денег; решение попадает в журнал', () => {
  let s = afterIntro();
  const { work } = E._internal.segmentTotals(s, ch1, ch1.segmentsById.vishera_okulovka);
  s.segments.vishera_okulovka.workDone = work * 0.25;
  s = act(s, { type: 'SET_PAY', level: 'normal' }); // любое действие — проверка триггеров
  assert.equal(s.pendingEvents[0], 'E10');
  const t = s.treasury;
  s = act(s, { type: 'CHOOSE', eventId: 'E10', choiceId: 'bypass' });
  assert.equal(s.segments.vishera_okulovka.extraKm, 5);
  assert.equal(s.segments.vishera_okulovka.features.verebye_grade, 'bypass');
  assert.equal(s.treasury, t - 1500);
  assert.equal(s.pendingEvents[0], 'E11', 'легенда о пальце идёт следом');
  assert.deepEqual(s.decisionsLog.at(-1), { eventId: 'E10', choiceId: 'bypass', turn: s.turn, historicalChoiceId: 'steep' });
});

test('новгородский вариант: другие участки, Веребья нет', () => {
  let { state: s } = E.createGame('chapter1', ch1, 1);
  s = act(s, { type: 'CHOOSE', eventId: 'E01', choiceId: 'ok' });
  s = act(s, { type: 'CHOOSE', eventId: 'E03', choiceId: 'novgorod' });
  const ids = E._internal.activeSegments(s, ch1).map(x => x.id);
  assert.ok(ids.includes('novgorod_volochek'));
  assert.ok(!ids.includes('vishera_okulovka'));
  assert.ok(s.flags.includes('novgorod_served'));
});

test('мосты без депеши выбираются игроком до середины работ', () => {
  let s = afterIntro();
  s = act(s, { type: 'SET_FEATURE', segmentId: 'spirovo_tver', feature: 'volga_bridge', value: 'iron' });
  assert.equal(s.segments.spirovo_tver.features.volga_bridge, 'iron');
  assert.throws(() => act(s, { type: 'SET_FEATURE', segmentId: 'vishera_okulovka', feature: 'msta_bridge', value: 'iron' }), /депешей/);
  const { work } = E._internal.segmentTotals(s, ch1, ch1.segmentsById.spirovo_tver);
  s.segments.spirovo_tver.workDone = work * 0.6;
  assert.throws(() => act(s, { type: 'SET_FEATURE', segmentId: 'spirovo_tver', feature: 'volga_bridge', value: 'wooden' }), /поздно/);
});

test('прошение: деньги за благоволение, кулдаун', () => {
  let s = afterIntro();
  const p = ch1.balance.chapter1.petition;
  const t = s.treasury, f = s.favor;
  s = act(s, { type: 'PETITION_FUNDS' });
  assert.equal(s.treasury, t + p.amount);
  assert.equal(s.favor, f - p.favorCost);
  assert.throws(() => act(s, { type: 'PETITION_FUNDS' }), /через/);
});

test('благоволение до нуля — отстранение', () => {
  let s = afterIntro();
  s.favor = 1;
  s.treasury = 0;
  s.crewsTotal = 5; // жалованье не выплатить → штраф благоволения
  const r = E.applyAction(s, { type: 'END_SEASON' }, ch1);
  assert.ok(r.state.finished);
  assert.equal(r.state.outcome, 'removed');
  assert.throws(() => act(r.state, { type: 'END_SEASON' }), /завершена/);
});

test('ревизия при низком благоволении пропускает сезон работ', () => {
  let s = afterIntro();
  s.favor = 15;
  assert.equal(act(s, { type: 'SET_PAY', level: 'normal' }).pendingEvents.length, 0, 'ревизия приходит только на границе сезона');
  s = act(s, { type: 'END_SEASON' });
  assert.equal(s.pendingEvents[0], 'E18');
  s = act(s, { type: 'CHOOSE', eventId: 'E18', choiceId: 'report' });
  assert.ok(s.skipNextSeason);
  s = act(s, { type: 'HIRE_CREWS', amount: 5 });
  s = act(s, { type: 'ASSIGN_CREWS', segmentId: 'spb_kolpino', crews: 5 });
  const r = E.applyAction(s, { type: 'END_SEASON' }, ch1);
  assert.equal(r.state.segments.spb_kolpino.workDone, 0);
  assert.ok(r.log.some(l => l.kind === 'skipped'));
});

test('подвижной состав: закупки только после открытия, паровоз своей эпохи', () => {
  let s = afterIntro();
  assert.throws(() => act(s, { type: 'BUY', itemId: 'carriage', qty: 1 }), /не открыты/);
  s.unlocked.rollingStock = true;
  assert.throws(() => act(s, { type: 'BUY', itemId: 'english_early', qty: 1 }), /эпоху/);
  s = act(s, { type: 'BUY', itemId: 'domestic_1840s', qty: 1 });
  s = act(s, { type: 'BUY', itemId: 'carriage', qty: 3 });
  assert.ok(E.view(s, ch1).hasRollingStock);
});

test('первый поезд: время по формуле, крутой уклон режет скорость', () => {
  const s = afterIntro();
  for (const seg of E._internal.activeSegments(s, ch1)) s.segments[seg.id].opened = true;
  s.rollingStock.locomotives.domestic_1840s = 1;
  s.rollingStock.carriages = 3;
  const steep = E.simulateFirstTrain(s, ch1, createRng(1));
  const s2 = structuredClone(s);
  s2.segments.vishera_okulovka.features.verebye_grade = 'bypass';
  const bypass = E.simulateFirstTrain(s2, ch1, createRng(1));
  assert.equal(steep.historicalMinutes, 1305);
  assert.ok(steep.km > 600 && steep.km < 700);
  const steepNoIncident = steep.minutes - steep.incidents * ch1.balance.train.incidentDelayMinutes;
  assert.ok(steepNoIncident > bypass.minutes - 30, 'уклон медленнее обхода на сопоставимом пути');
  assert.equal(bypass.incidents, 0);
});

test('оценка главы: пять шкал, звёзды 0..5', () => {
  const s = playGame(ch1, 3, 'historical');
  assert.equal(s.outcome, 'won');
  assert.ok(s.firstRun);
  const ids = s.score.scales.map(x => x.id);
  assert.deepEqual(ids, ['deadline', 'treasury', 'reliability', 'speed', 'history']);
  for (const sc of s.score.scales) assert.ok(sc.stars >= 0 && sc.stars <= 5);
  const hist = s.score.scales.find(x => x.id === 'history');
  assert.equal(hist.stars, 5, 'исторические решения — пять звёзд «как у Мельникова»');
});

test('пролог проходится до первого рейса', () => {
  const s = playGame(pro, 1, 'historical');
  assert.equal(s.outcome, 'won');
  assert.equal(s.firstRun.historicalMinutes, 35);
  assert.ok(s.firedEvents.includes('P03'));
});

test('главу можно выиграть и можно проиграть (симулятор)', () => {
  const outs = new Set();
  for (let seed = 1; seed <= 60; seed++) outs.add(playGame(ch1, seed, 'random').outcome);
  assert.ok(outs.has('won'));
  assert.ok(outs.has('removed') || outs.has('timeout'));
});

test('факты, которые видел игрок, — из решённых депеш', () => {
  const s = afterIntro();
  const seen = E.seenFactIds(s, ch1);
  assert.ok(seen.includes('F004') && seen.includes('F008'));
  assert.ok(!seen.includes('F011'));
});
