#!/usr/bin/env node
// Бот-симулятор баланса: N прохождений каждой стратегией, отчёт по победам,
// поражениям, году открытия, звёздам. Запуск: node koleya/scripts/simulate.js [N] [глава]
'use strict';
const content = require('../content');
const { playGame } = require('./bots');

const N = parseInt(process.argv[2], 10) || 1000;
const only = process.argv[3];
const STRATEGIES = ['historical', 'cautious', 'shortcut', 'random'];

for (const chId of content.chapterIds()) {
  if (only && only !== chId) continue;
  const ch = content.chapter(chId);
  console.log(`\n=== ${chId}: ${N} прохождений на стратегию ===`);
  for (const strat of STRATEGIES) {
    const out = { won: 0, removed: 0, timeout: 0, halted: 0 };
    const years = [], stars = [], minutes = [], turns = [];
    for (let seed = 1; seed <= N; seed++) {
      const s = playGame(ch, seed, strat);
      out[s.outcome] = (out[s.outcome] || 0) + 1;
      turns.push(s.turn);
      if (s.completedAt) years.push(s.completedAt.year + ['spring', 'summer', 'autumn', 'winter'].indexOf(s.completedAt.season) / 4);
      if (s.score) stars.push(s.score.total / s.score.max * 5);
      if (s.firstRun) minutes.push(s.firstRun.minutes);
    }
    const avg = a => a.length ? (a.reduce((x, y) => x + y, 0) / a.length) : NaN;
    const pct = k => (100 * (out[k] || 0) / N).toFixed(1) + '%';
    console.log(
      `${strat.padEnd(11)} победы ${pct('won').padStart(6)}  отстранён ${pct('removed').padStart(6)}  не успел ${pct('timeout').padStart(6)}` +
      (out.halted ? `  остановлено ${pct('halted').padStart(6)}` : '') +
      `  | открытие ≈ ${avg(years).toFixed(2)}  ходов ${avg(turns).toFixed(1)}  поезд ${Math.round(avg(minutes))} мин  звёзды ${avg(stars).toFixed(2)}/5`
    );
  }
}
