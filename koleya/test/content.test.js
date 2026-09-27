'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const content = require('../content');

function broken(mutate) {
  const all = structuredClone(content.loadAll({ fresh: true }));
  mutate(all);
  return content.validate(all);
}

test('check:facts ловит ссылку на несуществующий факт', () => {
  const errs = broken(a => { a.chapters.chapter1.events[0].fact_refs.push('F999'); });
  assert.ok(errs.some(e => /F999/.test(e)));
});

test('check:facts не пускает в викторину факт to_verify', () => {
  const errs = broken(a => {
    const f = a.facts.find(x => x.id === a.chapters.chapter1.quiz[0].fact_ref);
    f.status = 'to_verify';
  });
  assert.ok(errs.some(e => /to_verify|legend|verified/.test(e)));
});

test('check:facts требует источник у verified', () => {
  const errs = broken(a => { a.facts[0].sources = []; });
  assert.ok(errs.some(e => /без источников/.test(e)));
});

test('check:facts ловит неизвестный эффект и сломанный afterEvent', () => {
  const errs = broken(a => {
    const ev = a.chapters.chapter1.events.find(e => e.id === 'E04');
    ev.choices[0].effects.teleport = true;
    ev.trigger = { afterEvent: 'E404' };
  });
  assert.ok(errs.some(e => /teleport/.test(e)));
  assert.ok(errs.some(e => /E404/.test(e)));
});

test('check:facts ловит неверную сумму долей рельефа', () => {
  const errs = broken(a => { a.chapters.chapter1.map.segments[0].terrain = { plain: 0.5 }; });
  assert.ok(errs.some(e => /доли рельефа/.test(e)));
});
