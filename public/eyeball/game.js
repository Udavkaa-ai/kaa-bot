(function () {
  'use strict';

  const tg = window.Telegram && window.Telegram.WebApp;
  if (tg) {
    tg.ready();
    tg.expand();
    try {
      tg.setHeaderColor('#f5f3ef');
      tg.setBackgroundColor('#f5f3ef');
    } catch (_) {}
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const HIT_THRESHOLD_PCT = 5;
  const FRACTIONS = [
    [1,2], [1,3], [2,3], [1,4], [3,4],
    [1,5], [2,5], [3,5], [4,5],
    [1,6], [5,6],
    [3,8], [5,8],
  ];
  const PENTATONIC = [
    220.00, 246.94, 277.18, 329.63, 369.99,
    440.00, 493.88, 554.37, 659.25, 739.99,
    880.00,
  ];

  const $ = id => document.getElementById(id);

  const state = {
    target: 0,              // 0..100 percent
    targetFraction: null,   // {n,d} or null (percent mode)
    mode: null,             // current mode object
    track: null,            // mode-specific geometry
    svgRefs: null,          // mode-specific SVG element refs
    best: null,
    avgSum: 0,
    streak: 0,
    rounds: 0,
    awaiting: false,
    showingResult: false,
  };

  // ---- Audio ----
  let audioCtx = null;
  function ensureAudio() {
    if (audioCtx) return audioCtx;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (_) {}
    return audioCtx;
  }
  function playTone(freq, gainPeak = 0.18, duration = 0.7) {
    const ctx = ensureAudio();
    if (!ctx) return;
    try {
      if (ctx.state === 'suspended') ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = ctx.currentTime;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(gainPeak, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + duration + 0.05);
    } catch (_) {}
  }
  function playAccuracyChord(accuracy) {
    const idx = Math.min(PENTATONIC.length - 1,
      Math.max(0, Math.floor((accuracy / 100) * (PENTATONIC.length - 1))));
    const f = PENTATONIC[idx];
    playTone(f, 0.18, 0.7);
    if (accuracy >= 95) setTimeout(() => playTone(f * 1.5, 0.10, 0.6), 80);
    if (accuracy >= 99.5) setTimeout(() => playTone(f * 2.0, 0.08, 0.8), 160);
  }

  // ---- Common helpers ----
  function clientToSvgPoint(clientX, clientY) {
    const svg = $('track');
    const rect = svg.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }
  function clamp01(v) { return Math.min(1, Math.max(0, v)); }

  function makeSvgEl(name, attrs) {
    const el = document.createElementNS(SVG_NS, name);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  function clearSvg() {
    const svg = $('track');
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    return svg;
  }

  function addDefs(svg) {
    const defs = document.createElementNS(SVG_NS, 'defs');
    defs.innerHTML = `
      <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="2"/>
        <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
      <clipPath id="jarClip">
        <rect id="jarClipRect" x="0" y="0" width="0" height="0"/>
      </clipPath>
    `;
    svg.appendChild(defs);
  }

  function colorClassFor(error) {
    if (error <= 2) return 'mint';
    if (error <= 5) return 'amber';
    if (error <= 10) return 'orange';
    return 'coral';
  }
  function colorFor(error) {
    if (error <= 2) return '#10b981';
    if (error <= 5) return '#f59e0b';
    if (error <= 10) return '#fb923c';
    return '#ef4444';
  }
  function statusFor(error) {
    if (error <= 0.3) return 'идеально';
    if (error <= 2)   return 'глаз-алмаз';
    if (error <= 5)   return 'точное попадание';
    if (error <= 10)  return 'почти';
    if (error <= 20)  return 'нужно сфокусироваться';
    return 'мимо';
  }

  // ====================================================
  // MODE: LINE — горизонтальная линия, тап по X-координате
  // ====================================================
  const modeLine = {
    id: 'line',
    name: 'Линия',
    icon: '─',
    verbFrac: 'Отмерь',
    verbPct: 'Поставь точку на',
    build(svg, rect) {
      const padX = 20;
      const x0 = padX;
      const x1 = rect.width - padX;
      const y = rect.height / 2;
      return { x0, x1, y, len: x1 - x0 };
    },
    drawIdle(svg, t) {
      const line = makeSvgEl('line', {
        x1: (t.x0 + t.x1) / 2, y1: t.y, x2: (t.x0 + t.x1) / 2, y2: t.y,
        stroke: '#1a1a1a', 'stroke-width': '2.5', 'stroke-linecap': 'round',
      });
      svg.appendChild(line);
      const tickL = makeSvgEl('line', {
        x1: t.x0, x2: t.x0, y1: t.y - 7, y2: t.y + 7,
        stroke: '#1a1a1a', 'stroke-width': '2', opacity: '0',
      });
      const tickR = makeSvgEl('line', {
        x1: t.x1, x2: t.x1, y1: t.y - 7, y2: t.y + 7,
        stroke: '#1a1a1a', 'stroke-width': '2', opacity: '0',
      });
      svg.appendChild(tickL);
      svg.appendChild(tickR);
      requestAnimationFrame(() => {
        line.style.transition = 'all 0.55s cubic-bezier(0.22, 1, 0.36, 1)';
        tickL.style.transition = tickR.style.transition = 'opacity 0.4s ease-out 0.45s';
        line.setAttribute('x1', t.x0);
        line.setAttribute('x2', t.x1);
        tickL.setAttribute('opacity', '0.6');
        tickR.setAttribute('opacity', '0.6');
      });
      return { line, tickL, tickR };
    },
    clientToValue(cx, _cy, t) {
      const p = clientToSvgPoint(cx, _cy);
      const clamped = Math.min(t.x1, Math.max(t.x0, p.x));
      return (clamped - t.x0) / t.len;
    },
    showAim(svg, t, value) {
      const x = t.x0 + value * t.len;
      const guide = makeSvgEl('line', {
        x1: x, x2: x, y1: t.y - 20, y2: t.y + 20,
        stroke: '#1a1a1a', 'stroke-width': '1', opacity: '0.25',
      });
      const dot = makeSvgEl('circle', {
        cx: x, cy: t.y, r: '0', fill: '#1a1a1a', filter: 'url(#glow)',
      });
      svg.appendChild(guide);
      svg.appendChild(dot);
      requestAnimationFrame(() => {
        dot.style.transition = 'r 0.15s cubic-bezier(0.34, 1.56, 0.64, 1)';
        dot.setAttribute('r', '9');
      });
      return { guide, dot };
    },
    updateAim(refs, t, value) {
      const x = t.x0 + value * t.len;
      if (refs.guide) { refs.guide.setAttribute('x1', x); refs.guide.setAttribute('x2', x); }
      if (refs.dot) refs.dot.setAttribute('cx', x);
    },
    drawResult(svg, t, userVal, targetVal, errColor) {
      const ux = t.x0 + userVal * t.len;
      const tx = t.x0 + targetVal * t.len;

      const base = makeSvgEl('line', {
        x1: t.x0, y1: t.y, x2: t.x1, y2: t.y,
        stroke: '#1a1a1a', 'stroke-width': '1', opacity: '0.18',
      });
      const filled = makeSvgEl('line', {
        x1: t.x0, y1: t.y, x2: t.x0, y2: t.y,
        stroke: '#1a1a1a', 'stroke-width': '2.5', 'stroke-linecap': 'round',
      });
      const errLow = Math.min(ux, tx), errHigh = Math.max(ux, tx);
      const errZone = makeSvgEl('line', {
        x1: errLow, y1: t.y, x2: errLow, y2: t.y,
        stroke: errColor, 'stroke-width': '5', 'stroke-linecap': 'round', opacity: '0.55',
      });
      const tick = makeSvgEl('line', {
        x1: tx, x2: tx, y1: t.y - 14, y2: t.y + 14,
        stroke: '#1a1a1a', 'stroke-width': '2', opacity: '0',
      });
      const dot = makeSvgEl('circle', {
        cx: ux, cy: t.y, r: '0', fill: errColor, filter: 'url(#glow)',
      });
      svg.appendChild(base); svg.appendChild(filled); svg.appendChild(errZone);
      svg.appendChild(tick); svg.appendChild(dot);

      requestAnimationFrame(() => {
        filled.style.transition = 'all 0.5s cubic-bezier(0.22, 1, 0.36, 1)';
        errZone.style.transition = 'all 0.5s cubic-bezier(0.22, 1, 0.36, 1) 0.1s';
        tick.style.transition = 'opacity 0.35s ease-out 0.25s';
        dot.style.transition = 'r 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
        filled.setAttribute('x2', ux);
        errZone.setAttribute('x2', errHigh);
        tick.setAttribute('opacity', '1');
        dot.setAttribute('r', '8');
      });
    },
    aimPoint(t, value) {
      return { x: t.x0 + value * t.len, y: t.y };
    },
  };

  // ====================================================
  // MODE: JAR — вертикальная банка, заливка водой снизу
  // ====================================================
  const modeJar = {
    id: 'jar',
    name: 'Банка',
    icon: '🫙',
    verbFrac: 'Налей',
    verbPct: 'Наполни на',
    build(svg, rect) {
      const jw = Math.min(rect.width * 0.42, 220);
      const jh = Math.min(rect.height * 0.86, 460);
      const jx = (rect.width - jw) / 2;
      const jy = (rect.height - jh) / 2;
      return { jx, jy, jw, jh };
    },
    drawIdle(svg, t) {
      // Стенки банки (открытая сверху, две вертикали + дно + горлышко)
      const neckW = t.jw * 0.55;
      const neckX = t.jx + (t.jw - neckW) / 2;
      const neckH = 14;

      // Горлышко-ободок (маленькая полоса сверху)
      const neck = makeSvgEl('path', {
        d: `M ${neckX} ${t.jy} L ${neckX} ${t.jy + neckH} L ${neckX + neckW} ${t.jy + neckH} L ${neckX + neckW} ${t.jy}`,
        stroke: '#1a1a1a', 'stroke-width': '2.5', fill: 'none', 'stroke-linecap': 'round', opacity: '0',
      });
      // Тело банки — плечо + вертикальные стенки + дно
      const body = makeSvgEl('path', {
        d:
          `M ${neckX} ${t.jy + neckH} ` +
          `Q ${neckX} ${t.jy + neckH + 22} ${t.jx} ${t.jy + neckH + 22} ` +
          `L ${t.jx} ${t.jy + t.jh} ` +
          `L ${t.jx + t.jw} ${t.jy + t.jh} ` +
          `L ${t.jx + t.jw} ${t.jy + neckH + 22} ` +
          `Q ${t.jx + t.jw} ${t.jy + neckH + 22} ${neckX + neckW} ${t.jy + neckH}`,
        stroke: '#1a1a1a', 'stroke-width': '2.5', fill: 'none', 'stroke-linecap': 'round',
        'stroke-dasharray': '1200', 'stroke-dashoffset': '1200',
      });
      svg.appendChild(neck);
      svg.appendChild(body);
      requestAnimationFrame(() => {
        body.style.transition = 'stroke-dashoffset 0.7s cubic-bezier(0.22,1,0.36,1)';
        neck.style.transition = 'opacity 0.3s ease-out 0.55s';
        body.setAttribute('stroke-dashoffset', '0');
        neck.setAttribute('opacity', '1');
      });
      return { body, neck };
    },
    clientToValue(cx, cy, t) {
      const p = clientToSvgPoint(cx, cy);
      // 0% в самом низу банки, 100% на уровне горлышка
      const bottom = t.jy + t.jh;
      const top = t.jy + 14; // до линии горлышка
      const clampedY = Math.min(bottom, Math.max(top, p.y));
      return (bottom - clampedY) / (bottom - top);
    },
    // Ширина «воды» на данной высоте: учитываем плечо (сужение сверху)
    _waterRectAt(t, value) {
      const bottom = t.jy + t.jh;
      const top = t.jy + 14;
      const waterTopY = bottom - value * (bottom - top);
      return {
        x: t.jx,
        y: waterTopY,
        w: t.jw,
        h: bottom - waterTopY,
      };
    },
    showAim(svg, t, value) {
      const r = this._waterRectAt(t, value);
      const water = makeSvgEl('rect', {
        x: r.x, y: r.y, width: r.w, height: r.h,
        fill: '#22d3ee', opacity: '0.55',
        'clip-path': 'url(#jarClip)',
      });
      // Верхняя волна воды (пунктирная линия для «уровня»)
      const surface = makeSvgEl('line', {
        x1: r.x, x2: r.x + r.w, y1: r.y, y2: r.y,
        stroke: '#0891b2', 'stroke-width': '2', opacity: '0.85',
      });
      // Обновляем clip чтобы вода не вылазила за стенки
      this._updateClip(t);
      svg.appendChild(water);
      svg.appendChild(surface);
      return { water, surface };
    },
    updateAim(refs, t, value) {
      const r = this._waterRectAt(t, value);
      if (refs.water) {
        refs.water.setAttribute('y', r.y);
        refs.water.setAttribute('height', r.h);
      }
      if (refs.surface) {
        refs.surface.setAttribute('y1', r.y);
        refs.surface.setAttribute('y2', r.y);
      }
    },
    _updateClip(t) {
      const rect = document.getElementById('jarClipRect');
      if (rect) {
        rect.setAttribute('x', t.jx);
        rect.setAttribute('y', t.jy);
        rect.setAttribute('width', t.jw);
        rect.setAttribute('height', t.jh);
      }
    },
    drawResult(svg, t, userVal, targetVal, errColor) {
      this._updateClip(t);
      // Пользовательская вода
      const uRect = this._waterRectAt(t, userVal);
      const water = makeSvgEl('rect', {
        x: uRect.x, y: uRect.y, width: uRect.w, height: uRect.h,
        fill: errColor, opacity: '0.5',
        'clip-path': 'url(#jarClip)',
      });
      svg.appendChild(water);

      // Идеальный уровень — пунктирная горизонталь через всю банку
      const tRect = this._waterRectAt(t, targetVal);
      const tick = makeSvgEl('line', {
        x1: t.jx - 8, x2: t.jx + t.jw + 8, y1: tRect.y, y2: tRect.y,
        stroke: '#1a1a1a', 'stroke-width': '2', 'stroke-dasharray': '4 3', opacity: '0',
      });
      svg.appendChild(tick);

      // Уровень пользователя (сплошная линия)
      const userSurface = makeSvgEl('line', {
        x1: uRect.x, x2: uRect.x + uRect.w, y1: uRect.y, y2: uRect.y,
        stroke: errColor, 'stroke-width': '2.5',
      });
      svg.appendChild(userSurface);

      requestAnimationFrame(() => {
        tick.style.transition = 'opacity 0.4s ease-out 0.2s';
        tick.setAttribute('opacity', '0.9');
      });
    },
    aimPoint(t, value) {
      const r = this._waterRectAt(t, value);
      return { x: r.x + r.w / 2, y: r.y };
    },
  };

  // ====================================================
  // MODE: PIE — круг, сектор от 12 часов по часовой
  // ====================================================
  const modePie = {
    id: 'pie',
    name: 'Пирог',
    icon: '🥧',
    verbFrac: 'Отрежь',
    verbPct: 'Отрежь',
    build(svg, rect) {
      const r = Math.min(rect.width * 0.42, rect.height * 0.42, 200);
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      return { cx, cy, r };
    },
    drawIdle(svg, t) {
      const circle = makeSvgEl('circle', {
        cx: t.cx, cy: t.cy, r: t.r,
        fill: 'none', stroke: '#1a1a1a', 'stroke-width': '2.5',
        'stroke-dasharray': 2 * Math.PI * t.r,
        'stroke-dashoffset': 2 * Math.PI * t.r,
      });
      svg.appendChild(circle);
      // маленькая точка сверху (12 часов) — отметка "начало"
      const startTick = makeSvgEl('line', {
        x1: t.cx, x2: t.cx, y1: t.cy - t.r - 8, y2: t.cy - t.r + 8,
        stroke: '#1a1a1a', 'stroke-width': '2', opacity: '0',
      });
      svg.appendChild(startTick);
      requestAnimationFrame(() => {
        circle.style.transition = 'stroke-dashoffset 0.7s cubic-bezier(0.22,1,0.36,1)';
        startTick.style.transition = 'opacity 0.4s ease-out 0.55s';
        circle.setAttribute('stroke-dashoffset', '0');
        startTick.setAttribute('opacity', '0.7');
      });
      return { circle, startTick };
    },
    clientToValue(cx, cy, t) {
      const p = clientToSvgPoint(cx, cy);
      const dx = p.x - t.cx;
      const dy = p.y - t.cy;
      // atan2 → угол от +X (3 часа), CCW. Нам надо от +Y_отрицательного (12) по часовой.
      // угол в радианах от -π до π; поворачиваем: 12 часов = -π/2
      let angle = Math.atan2(dy, dx) + Math.PI / 2; // теперь 0 = 12 часов, по часовой
      if (angle < 0) angle += Math.PI * 2;
      return clamp01(angle / (Math.PI * 2));
    },
    _sectorPath(t, value) {
      if (value <= 0) return '';
      if (value >= 0.999) {
        // почти полный круг — рисуем как два arc чтобы SVG не сломался
        return `M ${t.cx} ${t.cy} L ${t.cx} ${t.cy - t.r} ` +
               `A ${t.r} ${t.r} 0 1 1 ${t.cx - 0.01} ${t.cy - t.r} Z`;
      }
      const angle = value * Math.PI * 2;
      const endX = t.cx + Math.sin(angle) * t.r;
      const endY = t.cy - Math.cos(angle) * t.r;
      const largeArc = value > 0.5 ? 1 : 0;
      return `M ${t.cx} ${t.cy} L ${t.cx} ${t.cy - t.r} ` +
             `A ${t.r} ${t.r} 0 ${largeArc} 1 ${endX} ${endY} Z`;
    },
    showAim(svg, t, value) {
      const sector = makeSvgEl('path', {
        d: this._sectorPath(t, value),
        fill: '#1a1a1a', opacity: '0.85',
      });
      svg.appendChild(sector);
      // Индикатор — линия от центра к текущему краю сектора
      const angle = value * Math.PI * 2;
      const edgeX = t.cx + Math.sin(angle) * t.r;
      const edgeY = t.cy - Math.cos(angle) * t.r;
      const guide = makeSvgEl('line', {
        x1: t.cx, y1: t.cy, x2: edgeX, y2: edgeY,
        stroke: '#fff', 'stroke-width': '1.5', 'stroke-dasharray': '3 3', opacity: '0.6',
      });
      svg.appendChild(guide);
      return { sector, guide };
    },
    updateAim(refs, t, value) {
      if (refs.sector) refs.sector.setAttribute('d', this._sectorPath(t, value));
      if (refs.guide) {
        const angle = value * Math.PI * 2;
        const edgeX = t.cx + Math.sin(angle) * t.r;
        const edgeY = t.cy - Math.cos(angle) * t.r;
        refs.guide.setAttribute('x2', edgeX);
        refs.guide.setAttribute('y2', edgeY);
      }
    },
    drawResult(svg, t, userVal, targetVal, errColor) {
      // Пользовательский сектор в цвете ошибки
      const userSector = makeSvgEl('path', {
        d: this._sectorPath(t, userVal),
        fill: errColor, opacity: '0.55',
      });
      svg.appendChild(userSector);
      // Идеальная граница — тонкая линия от центра к нужному углу
      const angle = targetVal * Math.PI * 2;
      const tx = t.cx + Math.sin(angle) * t.r;
      const ty = t.cy - Math.cos(angle) * t.r;
      const tick = makeSvgEl('line', {
        x1: t.cx, y1: t.cy, x2: t.cx, y2: t.cy,
        stroke: '#1a1a1a', 'stroke-width': '2.5', opacity: '0',
      });
      svg.appendChild(tick);
      requestAnimationFrame(() => {
        tick.style.transition = 'all 0.5s cubic-bezier(0.22,1,0.36,1) 0.2s';
        tick.setAttribute('x2', tx);
        tick.setAttribute('y2', ty);
        tick.setAttribute('opacity', '1');
      });
    },
    aimPoint(t, value) {
      const angle = value * Math.PI * 2;
      return {
        x: t.cx + Math.sin(angle) * t.r * 0.7,
        y: t.cy - Math.cos(angle) * t.r * 0.7,
      };
    },
  };

  const MODES = [modeLine, modeJar, modePie];

  function pickRandomMode(excludeId) {
    const pool = MODES.filter(m => m.id !== excludeId);
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // ---- Tasks ----
  function pickTask(mode) {
    if (Math.random() < 0.45) {
      const [n, d] = FRACTIONS[Math.floor(Math.random() * FRACTIONS.length)];
      const pct = (n / d) * 100;
      state.targetFraction = { n, d };
      return {
        html: `${mode.verbFrac} <span class="accent">${n}/${d}</span>`,
        percent: pct,
      };
    }
    state.targetFraction = null;
    const p = 5 + Math.floor(Math.random() * 91);
    return {
      html: `${mode.verbPct} <span class="accent">${p}%</span>`,
      percent: p,
    };
  }

  // ---- Round ----
  function newRound(forceSwitchMode = false) {
    const excludeId = forceSwitchMode && state.mode ? state.mode.id : null;
    state.mode = pickRandomMode(excludeId);

    const task = pickTask(state.mode);
    state.target = task.percent;

    const taskEl = $('task');
    taskEl.classList.remove('appear');
    void taskEl.offsetWidth;
    taskEl.innerHTML = task.html;
    taskEl.classList.add('appear');

    $('result').classList.add('hidden');
    $('share').classList.add('hidden');
    $('next-hint').classList.add('hidden');
    $('hint').classList.remove('hidden');

    buildTrack();

    state.awaiting = true;
    state.showingResult = false;
  }

  function buildTrack() {
    const svg = $('track');
    const rect = svg.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
    clearSvg();
    addDefs(svg);
    state.track = state.mode.build(svg, rect);
    state.svgRefs = state.mode.drawIdle(svg, state.track);
  }

  // ---- Aim / evaluate ----
  let aimState = null;
  let aimRefs = null;

  function startAim(cx, cy) {
    const value = state.mode.clientToValue(cx, cy, state.track);
    aimRefs = state.mode.showAim($('track'), state.track, value);
    aimState = { value };
  }
  function updateAim(cx, cy) {
    const value = state.mode.clientToValue(cx, cy, state.track);
    if (Math.abs(value - aimState.value) > 0.001) {
      state.mode.updateAim(aimRefs, state.track, value);
      aimState.value = value;
    }
  }
  function commitAim() {
    const value = aimState.value;
    clearAimRefs();
    aimState = null;
    evaluate(value);
  }
  function clearAimRefs() {
    if (!aimRefs) return;
    for (const k in aimRefs) if (aimRefs[k]) aimRefs[k].remove();
    aimRefs = null;
  }

  function evaluate(userValue) {
    const target01 = state.target / 100;
    const userPct = userValue * 100;
    const error = Math.abs(userPct - state.target);
    const accuracy = Math.max(0, 100 - error);

    state.rounds++;
    state.avgSum += accuracy;
    state.best = state.best === null ? accuracy : Math.max(state.best, accuracy);
    const prevStreak = state.streak;
    if (error <= HIT_THRESHOLD_PCT) state.streak++;
    else state.streak = 0;

    const svg = $('track');
    const errColor = colorFor(error);
    const aimPt = state.mode.aimPoint(state.track, userValue);

    // ripple от точки прицеливания
    ripple(svg, aimPt.x, aimPt.y);

    // рисуем результат режима поверх idle
    setTimeout(() => {
      clearSvg();
      addDefs(svg);
      // тень idle
      state.mode.drawIdle(svg, state.track);
      state.mode.drawResult(svg, state.track, userValue, target01, errColor);
    }, 220);

    // текст под сценой
    setTimeout(() => showResult(accuracy, error), 380);

    // звук + haptic
    playAccuracyChord(accuracy);
    if (tg && tg.HapticFeedback) {
      try {
        if (error <= 2) tg.HapticFeedback.notificationOccurred('success');
        else if (error <= 5) tg.HapticFeedback.impactOccurred('light');
        else if (error <= 10) tg.HapticFeedback.impactOccurred('medium');
        else tg.HapticFeedback.impactOccurred('rigid');
      } catch (_) {}
    }
    // sparkles за глаз-алмаз
    if (error <= 0.3) {
      setTimeout(() => sparkles(svg, aimPt.x, aimPt.y, 18, 38), 350);
      setTimeout(() => sparkles(svg, aimPt.x, aimPt.y, 10, 24), 600);
    } else if (error <= 2) {
      setTimeout(() => sparkles(svg, aimPt.x, aimPt.y, 10, 26), 350);
    }

    updateStatsUI(state.streak > prevStreak);
    state.awaiting = false;
    state.showingResult = true;
    queueFinishSync();
  }

  function ripple(svg, x, y) {
    const drop = makeSvgEl('circle', {
      cx: x, cy: y, r: '0', fill: '#1a1a1a',
    });
    svg.appendChild(drop);
    requestAnimationFrame(() => {
      drop.style.transition = 'r 0.16s cubic-bezier(0.34, 1.56, 0.64, 1)';
      drop.setAttribute('r', '6');
      setTimeout(() => {
        drop.style.transition = 'r 0.32s ease-out, opacity 0.32s ease-out';
        drop.setAttribute('r', '1.5');
        drop.setAttribute('opacity', '0');
      }, 180);
    });
    setTimeout(() => drop.remove(), 700);

    const rings = [
      { r: 45, dur: 0.55, delay: 0,    width: 1.6, opacity: 0.7 },
      { r: 70, dur: 0.75, delay: 0.08, width: 1.2, opacity: 0.55 },
      { r: 95, dur: 0.95, delay: 0.18, width: 0.9, opacity: 0.4 },
    ];
    rings.forEach(cfg => {
      const c = makeSvgEl('circle', {
        cx: x, cy: y, r: '3', fill: 'none',
        stroke: '#1a1a1a', 'stroke-width': cfg.width, opacity: cfg.opacity,
      });
      svg.appendChild(c);
      requestAnimationFrame(() => {
        c.style.transition = `r ${cfg.dur}s ease-out ${cfg.delay}s, opacity ${cfg.dur}s ease-out ${cfg.delay}s, stroke-width ${cfg.dur}s ease-out ${cfg.delay}s`;
        c.setAttribute('r', cfg.r);
        c.setAttribute('opacity', '0');
        c.setAttribute('stroke-width', cfg.width * 0.3);
      });
      setTimeout(() => c.remove(), (cfg.dur + cfg.delay) * 1000 + 120);
    });
  }

  function sparkles(svg, x, y, count = 14, spread = 30) {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.3;
      const dist = 22 + Math.random() * spread;
      const s = makeSvgEl('circle', {
        cx: x, cy: y, r: '1.6', fill: '#10b981', filter: 'url(#glow)',
      });
      svg.appendChild(s);
      requestAnimationFrame(() => {
        s.style.transition = `all ${0.7 + Math.random() * 0.4}s cubic-bezier(0.22, 1, 0.36, 1)`;
        s.setAttribute('cx', x + Math.cos(angle) * dist);
        s.setAttribute('cy', y + Math.sin(angle) * dist);
        s.setAttribute('r', 0);
      });
      setTimeout(() => s.remove(), 1300);
    }
  }

  function showResult(accuracy, error) {
    const cls = colorClassFor(error);
    $('accuracy').innerHTML = `<span class="acc-num ${cls}">${accuracy.toFixed(1)}%</span>`;
    $('status').textContent = statusFor(error);
    $('result').classList.remove('hidden');
    $('hint').classList.add('hidden');
    $('share').classList.remove('hidden');
    $('next-hint').classList.remove('hidden');
  }

  function updateStatsUI(streakBumped) {
    $('best').textContent = state.best === null ? '—' : state.best.toFixed(1) + '%';
    $('avg').textContent = state.rounds === 0 ? '—' : (state.avgSum / state.rounds).toFixed(1) + '%';
    $('streak').textContent = state.streak;
    $('rounds').textContent = state.rounds;
    if (streakBumped) {
      const el = document.querySelector('.streak-stat');
      el.classList.remove('bump');
      void el.offsetWidth;
      el.classList.add('bump');
    }
    if (state.best !== null) {
      $('record').textContent = `рекорд сессии — ${state.best.toFixed(1)}%`;
    } else {
      $('record').innerHTML = '&nbsp;';
    }
  }

  function resetSession() {
    state.best = null;
    state.avgSum = 0;
    state.streak = 0;
    state.rounds = 0;
    state.mode = null;
    updateStatsUI(false);
    newRound();
  }

  // ---- API sync ----
  let pendingFinish = false;
  let finishTimer = null;
  function queueFinishSync() {
    if (!tg || !tg.initData) return;
    pendingFinish = true;
    if (finishTimer) clearTimeout(finishTimer);
    finishTimer = setTimeout(syncFinish, 500);
  }
  async function syncFinish() {
    if (!pendingFinish || !tg || !tg.initData) return;
    pendingFinish = false;
    try {
      await fetch('/api/eyeball/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          initData: tg.initData,
          streak: state.streak,
          bestAccuracy: state.best || 0,
          addRounds: 1,
        }),
      });
    } catch (_) {}
  }

  async function share() {
    if (!tg || !tg.initData) { alert('Открой через бота'); return; }
    const btn = $('share');
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = 'Отправляю...';
    try {
      const resp = await fetch('/api/eyeball/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          initData: tg.initData,
          streak: state.streak,
          bestAccuracy: state.best || 0,
          rounds: state.rounds,
        }),
      });
      const data = await resp.json();
      if (data && data.ok) {
        if (tg.HapticFeedback) try { tg.HapticFeedback.notificationOccurred('success'); } catch (_) {}
        btn.textContent = 'Отправлено ✓';
        setTimeout(() => { try { tg.close(); } catch (_) {} }, 600);
      } else {
        btn.disabled = false;
        btn.textContent = old;
        if (tg.showAlert) tg.showAlert('Не получилось отправить');
      }
    } catch (err) {
      btn.disabled = false;
      btn.textContent = old;
      if (tg && tg.showAlert) tg.showAlert('Ошибка сети');
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[<>&"]/g, c => ({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;' }[c]));
  }

  async function showLeaderboard() {
    if (!tg || !tg.initData) { alert('Открой через бота'); return; }
    $('lb-list').innerHTML = '<div class="lb-loading">Загружаю...</div>';
    $('lb-me').classList.add('hidden');
    $('lb-modal').classList.remove('hidden');
    try {
      const resp = await fetch('/api/eyeball/leaderboard?initData=' + encodeURIComponent(tg.initData));
      const data = await resp.json();

      renderPersonalStats(data.me, data.aggregates);

      const list = $('lb-list');
      if (!data.top || data.top.length === 0) {
        list.innerHTML = '<div class="lb-empty">Пока никто не играл</div>';
      } else {
        const medals = ['1', '2', '3'];
        const meId = tg.initDataUnsafe && tg.initDataUnsafe.user && String(tg.initDataUnsafe.user.id);
        list.innerHTML = data.top.map((r, i) => {
          const m = medals[i] || (i + 1);
          const mine = meId && r.user_id === meId ? ' mine' : '';
          return `<div class="lb-row${mine}">
            <span class="lb-pos">${m}</span>
            <span class="lb-name">${escapeHtml(r.username)}</span>
            <span class="lb-score">серия ${r.best_streak} · ${Number(r.best_accuracy).toFixed(1)}%</span>
          </div>`;
        }).join('');
      }
    } catch (err) {
      $('lb-list').innerHTML = '<div class="lb-empty">Ошибка загрузки</div>';
    }
  }

  function renderPersonalStats(me, agg) {
    if (!me || me.rounds === 0) {
      $('lb-me').classList.add('hidden');
      return;
    }
    $('me-best').textContent = me.best_accuracy.toFixed(1) + '%';
    $('me-streak').textContent = me.best_streak;
    $('me-rounds').textContent = me.rounds;
    $('me-rank').textContent = '#' + me.rank;
    const compareEl = $('lb-me-compare');
    const lines = buildComparisons(me, agg);
    compareEl.innerHTML = lines.map(t => `<div class="cmp">${t}</div>`).join('');
    $('lb-me').classList.remove('hidden');
  }

  function simpleFraction(value, maxDenom = 9) {
    if (!isFinite(value) || value <= 0) return null;
    if (value >= 0.995) return { n: 1, d: 1 };
    let best = null, bestErr = Infinity;
    for (let d = 2; d <= maxDenom; d++) {
      const n = Math.round(value * d);
      if (n < 1 || n >= d) continue;
      const err = Math.abs(value - n / d);
      if (err < bestErr) { bestErr = err; best = { n, d }; }
    }
    return best;
  }

  function buildComparisons(me, agg) {
    const lines = [];
    if (!me || !agg) return lines;
    if (agg.max_acc > 0 && me.best_accuracy > 0) {
      if (me.best_accuracy + 0.05 >= agg.max_acc) {
        lines.push('Ты — лидер чата 👑');
      } else {
        const f = simpleFraction(me.best_accuracy / agg.max_acc);
        if (f && !(f.n === 1 && f.d === 1)) {
          lines.push(`Ты на <span class="frac">${f.n}/${f.d}</span> от лидера`);
        }
      }
    }
    if (agg.players >= 2 && agg.avg_acc > 0) {
      const delta = me.best_accuracy - agg.avg_acc;
      if (delta > 0.5) {
        const ratio = delta / agg.avg_acc;
        if (ratio >= 0.95) {
          lines.push('Ты <span class="frac">вдвое</span> точнее среднего');
        } else {
          const f = simpleFraction(ratio);
          if (f) lines.push(`Ты на <span class="frac">${f.n}/${f.d}</span> точнее среднего`);
        }
      } else if (delta < -0.5) {
        const ratio = Math.min(0.95, -delta / agg.avg_acc);
        const f = simpleFraction(ratio);
        if (f) lines.push(`До среднего: ещё <span class="frac">${f.n}/${f.d}</span>`);
      }
    }
    if (agg.max_streak > 0 && me.best_streak >= 0) {
      if (me.best_streak >= agg.max_streak && me.best_streak > 0) {
        lines.push('Твоя серия — рекорд чата 🔥');
      } else if (me.best_streak > 0) {
        const f = simpleFraction(me.best_streak / agg.max_streak);
        if (f) lines.push(`Серия — <span class="frac">${f.n}/${f.d}</span> от рекорда`);
      }
    }
    return lines;
  }

  // ---- Input ----
  function onPointerDown(e) {
    if (e.target.closest('button') || e.target.closest('.modal') || e.target.closest('header')) return;
    ensureAudio();
    if (state.showingResult) { newRound(); return; }
    if (!state.awaiting) return;

    startAim(e.clientX, e.clientY);
    aimState.pointerId = e.pointerId;
    if (tg && tg.HapticFeedback) try { tg.HapticFeedback.impactOccurred('light'); } catch (_) {}
    try { e.target.setPointerCapture && e.target.setPointerCapture(e.pointerId); } catch (_) {}
    e.preventDefault();
  }
  function onPointerMove(e) {
    if (!aimState || aimState.pointerId !== e.pointerId) return;
    updateAim(e.clientX, e.clientY);
  }
  function onPointerUp(e) {
    if (!aimState || aimState.pointerId !== e.pointerId) return;
    commitAim();
  }
  function onPointerCancel() {
    if (!aimState) return;
    clearAimRefs();
    aimState = null;
  }
  document.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp);
  document.addEventListener('pointercancel', onPointerCancel);

  $('reset').addEventListener('click', (e) => {
    e.stopPropagation();
    if (tg && tg.HapticFeedback) try { tg.HapticFeedback.impactOccurred('light'); } catch (_) {}
    resetSession();
  });
  $('switch-mode').addEventListener('click', (e) => {
    e.stopPropagation();
    if (tg && tg.HapticFeedback) try { tg.HapticFeedback.impactOccurred('light'); } catch (_) {}
    newRound(true); // форсированно берём другой режим
  });
  $('share').addEventListener('click', (e) => { e.stopPropagation(); share(); });
  $('leaderboard-btn').addEventListener('click', (e) => { e.stopPropagation(); showLeaderboard(); });
  $('lb-close').addEventListener('click', (e) => {
    e.stopPropagation();
    $('lb-modal').classList.add('hidden');
  });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (state.awaiting) buildTrack();
    }, 200);
  });

  requestAnimationFrame(() => {
    setTimeout(resetSession, 50);
  });
})();
