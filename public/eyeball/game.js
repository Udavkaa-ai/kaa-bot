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
  const HIT_THRESHOLD_PCT = 5; // streak hit if error <= 5%
  const FRACTIONS = [
    [1,2], [1,3], [2,3], [1,4], [3,4],
    [1,5], [2,5], [3,5], [4,5],
    [1,6], [5,6],
    [3,8], [5,8],
  ];
  const PENTATONIC = [
    220.00, 246.94, 277.18, 329.63, 369.99, // A3 B3 C#4 E4 F#4
    440.00, 493.88, 554.37, 659.25, 739.99, // A4 B4 C#5 E5 F#5
    880.00,                                  // A5
  ];

  const $ = id => document.getElementById(id);

  const state = {
    target: 0,          // 0..100 percent
    taskText: '',
    track: null,        // { x0, x1, y, len } in SVG coords
    best: null,
    avgSum: 0,
    streak: 0,
    rounds: 0,
    awaiting: false,
    showingResult: false,
  };

  // ---- Audio (tuning fork) ----
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
    // little harmony for high accuracy
    if (accuracy >= 95) setTimeout(() => playTone(f * 1.5, 0.10, 0.6), 80);
    if (accuracy >= 99.5) setTimeout(() => playTone(f * 2.0, 0.08, 0.8), 160);
  }

  // ---- Tasks ----
  function pickTask() {
    if (Math.random() < 0.45) {
      const [n, d] = FRACTIONS[Math.floor(Math.random() * FRACTIONS.length)];
      const pct = (n / d) * 100;
      return {
        html: `Отмерь <span class="accent">${n}/${d}</span>`,
        percent: pct,
      };
    }
    const p = 5 + Math.floor(Math.random() * 91);
    return {
      html: `Поставь точку на <span class="accent">${p}%</span>`,
      percent: p,
    };
  }

  // ---- Geometry ----
  function buildTrack() {
    const svg = $('track');
    const rect = svg.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
    const padX = 20;
    const x0 = padX;
    const x1 = rect.width - padX;
    const y = rect.height / 2;
    state.track = { x0, x1, y, len: x1 - x0 };
    drawIdleLine();
  }

  function clearSvg() {
    const svg = $('track');
    while (svg.firstChild) svg.removeChild(svg.firstChild);
  }

  function drawIdleLine() {
    const svg = $('track');
    clearSvg();
    const { x0, x1, y } = state.track;

    // soft glow filter
    const defs = document.createElementNS(SVG_NS, 'defs');
    defs.innerHTML = `
      <filter id="soft" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="0.6"/>
      </filter>
      <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="2"/>
        <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    `;
    svg.appendChild(defs);

    // breathing main line (animate-in from center)
    const line = document.createElementNS(SVG_NS, 'line');
    const mid = (x0 + x1) / 2;
    line.setAttribute('x1', mid);
    line.setAttribute('y1', y);
    line.setAttribute('x2', mid);
    line.setAttribute('y2', y);
    line.setAttribute('stroke', '#1a1a1a');
    line.setAttribute('stroke-width', '2.5');
    line.setAttribute('stroke-linecap', 'round');
    svg.appendChild(line);

    // endpoint ticks
    const tickLeft = document.createElementNS(SVG_NS, 'line');
    tickLeft.setAttribute('x1', x0);
    tickLeft.setAttribute('x2', x0);
    tickLeft.setAttribute('y1', y - 7);
    tickLeft.setAttribute('y2', y + 7);
    tickLeft.setAttribute('stroke', '#1a1a1a');
    tickLeft.setAttribute('stroke-width', '2');
    tickLeft.setAttribute('opacity', '0');
    svg.appendChild(tickLeft);

    const tickRight = document.createElementNS(SVG_NS, 'line');
    tickRight.setAttribute('x1', x1);
    tickRight.setAttribute('x2', x1);
    tickRight.setAttribute('y1', y - 7);
    tickRight.setAttribute('y2', y + 7);
    tickRight.setAttribute('stroke', '#1a1a1a');
    tickRight.setAttribute('stroke-width', '2');
    tickRight.setAttribute('opacity', '0');
    svg.appendChild(tickRight);

    requestAnimationFrame(() => {
      line.style.transition = 'all 0.55s cubic-bezier(0.22, 1, 0.36, 1)';
      tickLeft.style.transition = 'opacity 0.4s ease-out 0.45s';
      tickRight.style.transition = 'opacity 0.4s ease-out 0.45s';
      line.setAttribute('x1', x0);
      line.setAttribute('x2', x1);
      tickLeft.setAttribute('opacity', '0.6');
      tickRight.setAttribute('opacity', '0.6');
    });

    state.svgRefs = { line, tickLeft, tickRight };
  }

  function projectTap(clientX) {
    const svg = $('track');
    const rect = svg.getBoundingClientRect();
    const localX = clientX - rect.left;
    const { x0, x1 } = state.track;
    let t = localX;
    if (t < x0) t = x0;
    if (t > x1) t = x1;
    return t; // svg-local X
  }

  function colorClassFor(error) {
    if (error <= 2) return 'mint';
    if (error <= 5) return 'amber';
    if (error <= 10) return 'orange';
    return 'coral';
  }
  function colorFor(error) {
    if (error <= 2) return '#10b981';   // mint — глаз-алмаз
    if (error <= 5) return '#f59e0b';   // amber — попадание (streak)
    if (error <= 10) return '#fb923c';  // orange — почти
    return '#ef4444';                    // coral — мимо
  }
  function statusFor(error) {
    if (error <= 0.3) return 'идеально';
    if (error <= 2)   return 'глаз-алмаз';
    if (error <= 5)   return 'точное попадание';
    if (error <= 10)  return 'почти';
    if (error <= 20)  return 'нужно сфокусироваться';
    return 'мимо';
  }

  function ripple(tapX, tapY) {
    const svg = $('track');
    const { x0, x1, y } = state.track;

    // 1. Маленькая «капля» в точке касания — мгновенный bounce
    const drop = document.createElementNS(SVG_NS, 'circle');
    drop.setAttribute('cx', tapX);
    drop.setAttribute('cy', y);
    drop.setAttribute('r', '0');
    drop.setAttribute('fill', '#1a1a1a');
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

    // 2. Концентрические круги — 4 штуки с разной задержкой и шириной,
    // как круги от капли на воде
    const rings = [
      { r: 45, dur: 0.55, delay: 0,    width: 1.6, opacity: 0.7 },
      { r: 70, dur: 0.75, delay: 0.08, width: 1.2, opacity: 0.55 },
      { r: 95, dur: 0.95, delay: 0.18, width: 0.9, opacity: 0.4 },
      { r: 120,dur: 1.15, delay: 0.30, width: 0.7, opacity: 0.28 },
    ];
    rings.forEach(cfg => {
      const c = document.createElementNS(SVG_NS, 'circle');
      c.setAttribute('cx', tapX);
      c.setAttribute('cy', tapY);
      c.setAttribute('r', '3');
      c.setAttribute('fill', 'none');
      c.setAttribute('stroke', '#1a1a1a');
      c.setAttribute('stroke-width', cfg.width);
      c.setAttribute('opacity', cfg.opacity);
      svg.appendChild(c);
      requestAnimationFrame(() => {
        c.style.transition = `r ${cfg.dur}s ease-out ${cfg.delay}s, opacity ${cfg.dur}s ease-out ${cfg.delay}s, stroke-width ${cfg.dur}s ease-out ${cfg.delay}s`;
        c.setAttribute('r', cfg.r);
        c.setAttribute('opacity', '0');
        c.setAttribute('stroke-width', cfg.width * 0.3);
      });
      setTimeout(() => c.remove(), (cfg.dur + cfg.delay) * 1000 + 120);
    });

    // 3. Бегущие волны по самой струне в обе стороны
    [-1, 1].forEach(dir => {
      const endX = dir < 0 ? x0 : x1;
      const distance = Math.abs(endX - tapX);
      const dur = Math.max(0.4, distance / 700);

      const wave = document.createElementNS(SVG_NS, 'circle');
      wave.setAttribute('cx', tapX);
      wave.setAttribute('cy', y);
      wave.setAttribute('r', '5');
      wave.setAttribute('fill', '#1a1a1a');
      wave.setAttribute('opacity', '0.85');
      svg.appendChild(wave);
      requestAnimationFrame(() => {
        wave.style.transition = `cx ${dur}s ease-out, r ${dur}s ease-out, opacity ${dur}s ease-out`;
        wave.setAttribute('cx', endX);
        wave.setAttribute('r', '1');
        wave.setAttribute('opacity', '0');
      });
      setTimeout(() => wave.remove(), dur * 1000 + 100);
    });

    // 4. Кратковременный «дрожащий» glow вокруг всей струны
    if (state.svgRefs && state.svgRefs.line) {
      const glow = document.createElementNS(SVG_NS, 'line');
      glow.setAttribute('x1', x0);
      glow.setAttribute('y1', y);
      glow.setAttribute('x2', x1);
      glow.setAttribute('y2', y);
      glow.setAttribute('stroke', '#1a1a1a');
      glow.setAttribute('stroke-width', '7');
      glow.setAttribute('stroke-linecap', 'round');
      glow.setAttribute('opacity', '0.22');
      svg.insertBefore(glow, state.svgRefs.line);
      requestAnimationFrame(() => {
        glow.style.transition = 'opacity 0.55s ease-out, stroke-width 0.55s ease-out';
        glow.setAttribute('opacity', '0');
        glow.setAttribute('stroke-width', '14');
      });
      setTimeout(() => glow.remove(), 700);
    }
  }

  function sparkles(x, y, count = 14, spread = 30) {
    const svg = $('track');
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.3;
      const dist = 22 + Math.random() * spread;
      const s = document.createElementNS(SVG_NS, 'circle');
      s.setAttribute('cx', x);
      s.setAttribute('cy', y);
      s.setAttribute('r', 1.6);
      s.setAttribute('fill', '#10b981');
      s.setAttribute('filter', 'url(#glow)');
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

  function drawResult(tapX, accuracy, error) {
    const svg = $('track');
    const { x0, x1, y, len } = state.track;
    const targetX = x0 + (state.target / 100) * len;
    const errColor = colorFor(error);

    // 1. Faded baseline line
    const base = document.createElementNS(SVG_NS, 'line');
    base.setAttribute('x1', x0);
    base.setAttribute('y1', y);
    base.setAttribute('x2', x1);
    base.setAttribute('y2', y);
    base.setAttribute('stroke', '#1a1a1a');
    base.setAttribute('stroke-width', '1');
    base.setAttribute('opacity', '0.18');
    svg.appendChild(base);

    // 2. Filled segment from 0 to user tap
    const filled = document.createElementNS(SVG_NS, 'line');
    filled.setAttribute('x1', x0);
    filled.setAttribute('y1', y);
    filled.setAttribute('x2', x0);
    filled.setAttribute('y2', y);
    filled.setAttribute('stroke', '#1a1a1a');
    filled.setAttribute('stroke-width', '2.5');
    filled.setAttribute('stroke-linecap', 'round');
    svg.appendChild(filled);

    // 3. Error zone (between user and target) — colored
    const errZone = document.createElementNS(SVG_NS, 'line');
    const errLow = Math.min(tapX, targetX);
    const errHigh = Math.max(tapX, targetX);
    errZone.setAttribute('x1', errLow);
    errZone.setAttribute('y1', y);
    errZone.setAttribute('x2', errLow);
    errZone.setAttribute('y2', y);
    errZone.setAttribute('stroke', errColor);
    errZone.setAttribute('stroke-width', '5');
    errZone.setAttribute('stroke-linecap', 'round');
    errZone.setAttribute('opacity', '0.55');
    svg.appendChild(errZone);

    // 4. Ideal target tick mark
    const tick = document.createElementNS(SVG_NS, 'line');
    tick.setAttribute('x1', targetX);
    tick.setAttribute('x2', targetX);
    tick.setAttribute('y1', y - 14);
    tick.setAttribute('y2', y + 14);
    tick.setAttribute('stroke', '#1a1a1a');
    tick.setAttribute('stroke-width', '2');
    tick.setAttribute('opacity', '0');
    svg.appendChild(tick);

    // 5. User dot
    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('cx', tapX);
    dot.setAttribute('cy', y);
    dot.setAttribute('r', 0);
    dot.setAttribute('fill', errColor);
    dot.setAttribute('filter', 'url(#glow)');
    svg.appendChild(dot);

    // 6. endpoint ticks
    const tickLeft = document.createElementNS(SVG_NS, 'line');
    tickLeft.setAttribute('x1', x0); tickLeft.setAttribute('x2', x0);
    tickLeft.setAttribute('y1', y - 7); tickLeft.setAttribute('y2', y + 7);
    tickLeft.setAttribute('stroke', '#1a1a1a');
    tickLeft.setAttribute('stroke-width', '2');
    tickLeft.setAttribute('opacity', '0.6');
    svg.appendChild(tickLeft);
    const tickRight = document.createElementNS(SVG_NS, 'line');
    tickRight.setAttribute('x1', x1); tickRight.setAttribute('x2', x1);
    tickRight.setAttribute('y1', y - 7); tickRight.setAttribute('y2', y + 7);
    tickRight.setAttribute('stroke', '#1a1a1a');
    tickRight.setAttribute('stroke-width', '2');
    tickRight.setAttribute('opacity', '0.6');
    svg.appendChild(tickRight);

    requestAnimationFrame(() => {
      filled.style.transition = 'all 0.5s cubic-bezier(0.22, 1, 0.36, 1)';
      errZone.style.transition = 'all 0.5s cubic-bezier(0.22, 1, 0.36, 1) 0.1s';
      tick.style.transition = 'opacity 0.35s ease-out 0.25s';
      dot.style.transition = 'r 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
      filled.setAttribute('x2', tapX);
      errZone.setAttribute('x1', errLow);
      errZone.setAttribute('x2', errHigh);
      tick.setAttribute('opacity', '1');
      dot.setAttribute('r', '8');
    });
  }

  function newRound() {
    const task = pickTask();
    state.target = task.percent;
    state.taskText = task.html;

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

  function evaluateAtSvgX(tapX) {
    const { x0, len, y } = state.track;
    const userPercent = ((tapX - x0) / len) * 100;
    const error = Math.abs(userPercent - state.target);
    const accuracy = Math.max(0, 100 - error);

    state.rounds++;
    state.avgSum += accuracy;
    state.best = state.best === null ? accuracy : Math.max(state.best, accuracy);
    const isHit = error <= HIT_THRESHOLD_PCT;
    const prevStreak = state.streak;
    if (isHit) state.streak++;
    else state.streak = 0;

    // ripple wave from tap
    ripple(tapX, y);

    // draw result viz
    setTimeout(() => drawResult(tapX, accuracy, error), 220);

    // text result
    setTimeout(() => showResult(accuracy, error), 380);

    // sound
    playAccuracyChord(accuracy);

    // haptic + sparkles for perfect
    if (tg && tg.HapticFeedback) {
      try {
        if (error <= 2) tg.HapticFeedback.notificationOccurred('success');
        else if (error <= 5) tg.HapticFeedback.impactOccurred('light');
        else if (error <= 10) tg.HapticFeedback.impactOccurred('medium');
        else tg.HapticFeedback.impactOccurred('rigid');
      } catch (_) {}
    }
    // Глаз-алмаз (ошибка ≤2%) — отдельная похвала с искрами,
    // у идеального попадания (≤0.3%) — больше искр и второй залп
    if (error <= 0.3) {
      setTimeout(() => sparkles(tapX, y, 18, 38), 350);
      setTimeout(() => sparkles(tapX, y, 10, 24), 600);
    } else if (error <= 2) {
      setTimeout(() => sparkles(tapX, y, 10, 26), 350);
    }

    updateStatsUI(state.streak > prevStreak);

    state.awaiting = false;
    state.showingResult = true;
    queueFinishSync();
  }

  function showResult(accuracy, error) {
    const cls = colorClassFor(error);
    $('accuracy').innerHTML =
      `<span class="acc-num ${cls}">${accuracy.toFixed(1)}%</span>`;
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
    // record
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

      // Personal stats panel
      renderPersonalStats(data.me, data.aggregates);

      // Top list
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

  // Pick the closest simple fraction n/d in (0,1] with denom up to maxDenom.
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

    // vs леадер по точности
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

    // vs средний игрок (по точности)
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

    // серия vs рекорд серии
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

  // ---- Pointer aim (drag-to-aim) ----
  let aimState = null;
  let aimDot = null;
  let aimGuide = null;

  function showAimMarker(svgX) {
    const svg = $('track');
    const { y } = state.track;
    aimGuide = document.createElementNS(SVG_NS, 'line');
    aimGuide.setAttribute('x1', svgX);
    aimGuide.setAttribute('x2', svgX);
    aimGuide.setAttribute('y1', y - 20);
    aimGuide.setAttribute('y2', y + 20);
    aimGuide.setAttribute('stroke', '#1a1a1a');
    aimGuide.setAttribute('stroke-width', '1');
    aimGuide.setAttribute('opacity', '0.25');
    svg.appendChild(aimGuide);

    aimDot = document.createElementNS(SVG_NS, 'circle');
    aimDot.setAttribute('cx', svgX);
    aimDot.setAttribute('cy', y);
    aimDot.setAttribute('r', '0');
    aimDot.setAttribute('fill', '#1a1a1a');
    aimDot.setAttribute('filter', 'url(#glow)');
    svg.appendChild(aimDot);
    requestAnimationFrame(() => {
      aimDot.style.transition = 'r 0.15s cubic-bezier(0.34, 1.56, 0.64, 1)';
      aimDot.setAttribute('r', '9');
    });
  }
  function updateAimMarker(svgX) {
    if (aimGuide) {
      aimGuide.setAttribute('x1', svgX);
      aimGuide.setAttribute('x2', svgX);
    }
    if (aimDot) aimDot.setAttribute('cx', svgX);
  }
  function removeAimMarker() {
    if (aimGuide) { aimGuide.remove(); aimGuide = null; }
    if (aimDot) { aimDot.remove(); aimDot = null; }
  }

  function clientToSvgX(clientX) {
    const svg = $('track');
    const rect = svg.getBoundingClientRect();
    const localX = clientX - rect.left;
    const { x0, x1 } = state.track;
    return Math.min(x1, Math.max(x0, localX));
  }

  function inAimZone(clientY) {
    const svg = $('track');
    const rect = svg.getBoundingClientRect();
    const pad = 80; // generous touch zone above/below the line
    return clientY >= rect.top - pad && clientY <= rect.bottom + pad;
  }

  function onPointerDown(e) {
    if (e.target.closest('button') || e.target.closest('.modal') || e.target.closest('header')) return;
    ensureAudio();

    // Если результат показан — тап в любом месте запускает новую попытку
    if (state.showingResult) {
      newRound();
      return;
    }
    if (!state.awaiting) return;

    const svgX = clientToSvgX(e.clientX);
    showAimMarker(svgX);
    aimState = { pointerId: e.pointerId, svgX };
    if (tg && tg.HapticFeedback) try { tg.HapticFeedback.impactOccurred('light'); } catch (_) {}
    try { e.target.setPointerCapture && e.target.setPointerCapture(e.pointerId); } catch (_) {}
    e.preventDefault();
  }
  function onPointerMove(e) {
    if (!aimState || aimState.pointerId !== e.pointerId) return;
    const svgX = clientToSvgX(e.clientX);
    if (Math.abs(svgX - aimState.svgX) > 0.5) {
      updateAimMarker(svgX);
      aimState.svgX = svgX;
    }
  }
  function onPointerUp(e) {
    if (!aimState || aimState.pointerId !== e.pointerId) return;
    const finalX = aimState.svgX;
    removeAimMarker();
    aimState = null;
    evaluateAtSvgX(finalX);
  }
  function onPointerCancel() {
    if (!aimState) return;
    removeAimMarker();
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
      // rebuild track at new size
      if (state.awaiting) buildTrack();
    }, 200);
  });

  // wait for layout, then start
  requestAnimationFrame(() => {
    setTimeout(resetSession, 50);
  });
})();
