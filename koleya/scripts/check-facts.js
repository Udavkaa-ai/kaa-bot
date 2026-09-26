#!/usr/bin/env node
// Проверка исторической базы и контента Koleya (аналог `pnpm check:facts` из CLAUDE.md).
// Падает, если: ссылка на несуществующий fact_id; вопрос викторины не по verified-факту;
// verified без источников; в data/ есть запрещённые слова; сломаны перекрёстные ссылки.
'use strict';
const { validate, loadAll } = require('../content');

const errors = validate(loadAll({ fresh: true }));
if (errors.length) {
  console.error(`check:facts — ошибок: ${errors.length}`);
  for (const e of errors) console.error('  ✗ ' + e);
  process.exit(1);
}
const all = loadAll();
const by = s => all.facts.filter(f => f.status === s).length;
console.log(`check:facts — ок. Фактов: ${all.facts.length} (verified ${by('verified')}, to_verify ${by('to_verify')}, legend ${by('legend')})`);
