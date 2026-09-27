'use strict';
// Механики, добавленные для глав после первой: модификаторы на главу, артели из депеши,
// переправа как особенность участка, колея из кампании, триггер «участок не открыт».
const test = require('node:test');
const assert = require('node:assert/strict');
const content = require('../content');
const E = require('../engine');
const { createRng } = require('../engine/rng');

// Копия главы I с правками — чтобы проверять механику без зависимости от будущего контента
function variant(mutate) {
  const ch = structuredClone(content.chapter('chapter1'));
  mutate(ch);
  ch.eventsById = Object.fromEntries(ch.events.map(e => [e.id, e]));
  ch.segmentsById = Object.fromEntries(ch.map.segments.map(s => [s.id, s]));
  return ch;
}
function intro(ch, seed = 1) {
  let { state } = E.createGame(ch.id, ch, seed);
  while (state.pendingEvents.length) {
    const ev = ch.eventsById[state.pendingEvents[0]];
    state = E.applyAction(state, { type: 'CHOOSE', eventId: ev.id, choiceId: ev.history?.choiceId || ev.choices[0].id }, ch).state;
  }
  return state;
}

test('modifier: удешевляет и ускоряет работы, режет скорость поезда, копится умножением', () => {
  const ch = variant(c => {
    c.events.find(e => e.id === 'E05').choices.find(x => x.id === '2').effects.modifier = { costMult: 0.8, workMult: 0.5, speedMult: 0.9 };
  });
  const base = intro(content.chapter('chapter1'));
  const light = intro(ch);
  assert.deepEqual(light.modifiers, { costMult: 0.8, workMult: 0.5, speedMult: 0.9, incidentMult: 1 });
  const seg = ch.segmentsById.tver_klin;
  const a = E._internal.segmentTotals(base, ch, seg), b = E._internal.segmentTotals(light, ch, seg);
  assert.ok(Math.abs(b.cost - a.cost * 0.8) < 1e-6);
  assert.ok(Math.abs(b.work - a.work * 0.5) < 1e-6);
  // Поезд медленнее ровно на множитель скорости (без уклона и происшествий)
  for (const s of [base, light]) {
    for (const sg of E._internal.activeSegments(s, ch)) s.segments[sg.id].opened = true;
    s.segments.vishera_okulovka.features.verebye_grade = 'bypass';
    s.rollingStock.locomotives.domestic_1840s = 1;
  }
  const r1 = E.simulateFirstTrain(base, ch, createRng(1)), r2 = E.simulateFirstTrain(light, ch, createRng(1));
  const moving = r => r.legs.reduce((x, l) => x + l.minutes, 0);
  assert.ok(Math.abs(moving(r2) - moving(r1) / 0.9) < r1.legs.length + 1, 'ходовое время растёт на 1/0,9');
});

test('crews: депеша добавляет артели', () => {
  const ch = variant(c => { c.events.find(e => e.id === 'E06').choices[0].effects.crews = 7; });
  const s = intro(ch);
  assert.equal(s.crewsTotal, ch.balance.chapter1.startCrews + 7);
});

test('crossing: переправа меняет стоимость, объём работ и время рейса', () => {
  const ch = variant(c => {
    c.balance.crossing = {
      ferry: { costMult: 0.5, workMult: 0.25, extraRunMinutes: 300 },
      bridge: { costMult: 1, workMult: 1, extraRunMinutes: 0 },
    };
    c.map.features.lake = { name: 'Переправа', kind: 'crossing', options: ['ferry', 'bridge'], default: 'bridge' };
    c.map.segments.find(s => s.id === 'tver_klin').features = ['lake'];
  });
  const s = intro(ch);
  const seg = ch.segmentsById.tver_klin;
  const full = E._internal.segmentTotals(s, ch, seg);
  const s2 = structuredClone(s);
  s2.segments.tver_klin.features.lake = 'ferry';
  const ferry = E._internal.segmentTotals(s2, ch, seg);
  assert.ok(Math.abs(ferry.work - full.work * 0.25) < 1e-6);
  assert.ok(Math.abs(ferry.cost - full.cost * 0.5) < 1e-6);
  for (const st of [s, s2]) {
    for (const sg of E._internal.activeSegments(st, ch)) st.segments[sg.id].opened = true;
    st.segments.vishera_okulovka.features.verebye_grade = 'bypass';
    st.rollingStock.locomotives.domestic_1840s = 1;
  }
  const t1 = E.simulateFirstTrain(s, ch, createRng(2)).minutes, t2 = E.simulateFirstTrain(s2, ch, createRng(2)).minutes;
  assert.equal(t2 - t1, 300);
});

test('колея из кампании: если в главе нет выбора колеи, берётся колея главы I', () => {
  const pro = content.chapter('prologue');
  assert.equal(E.createGame('prologue', pro, 1).state.gauge, 1829, 'без кампании — историческая колея карты');
  assert.equal(E.createGame('prologue', pro, 1, { gauge: 1524 }).state.gauge, 1524);
  const ch1 = content.chapter('chapter1');
  assert.equal(E.createGame('chapter1', ch1, 1, { gauge: 1435 }).state.gauge, null, 'где колею выбирают — выбирает игрок');
});

test('segmentUnopened: событие ждёт, пока участок не открыт', () => {
  const ch = variant(c => {
    c.events.push({ id: 'X1', type: 'historical', trigger: { atYear: 1850, segmentUnopened: 'spb_kolpino' }, title: 't', text: 't', choices: [{ id: 'ok', label: 'ok', effects: {} }], fact_refs: [] });
  });
  let s = intro(ch);
  assert.ok(!s.pendingEvents.includes('X1') && !s.firedEvents.includes('X1'));
  s.year = 1850;
  // Открыть участок до проверки триггеров — событие не должно прийти
  const s2 = structuredClone(s);
  s2.segments.spb_kolpino.opened = true;
  s = E.applyAction(s, { type: 'SET_PAY', level: 'normal' }, ch).state;
  assert.ok(s.pendingEvents.includes('X1'));
  const r = E.applyAction(s2, { type: 'SET_PAY', level: 'normal' }, ch).state;
  assert.ok(!r.pendingEvents.includes('X1'));
});

test('баланс главы: overrides сливаются с общим балансом', () => {
  const merged = content.deepMerge({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 4 }, e: 5 });
  assert.deepEqual(merged, { a: 1, b: { c: 2, d: 4 }, e: 5 });
});
