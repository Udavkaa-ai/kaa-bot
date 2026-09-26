// Детерминированный генератор mulberry32. Состояние — одно 32-битное число,
// хранится в GameState.rngState и продвигается только через next().
'use strict';

function createRng(state) {
  let s = state >>> 0;
  return {
    next() {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    state() { return s; },
  };
}

module.exports = { createRng };
