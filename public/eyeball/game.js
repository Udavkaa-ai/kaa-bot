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
    if (error <= 10) return 'amber';
    return 'coral';
  }
  function colorFor(error) {
    if (error <= 2) return '#10b981';
    if (error <= 10) return '#f59e0b';
    return '#ef4444';
  }
  function statusFor(accuracy) {
    if (accuracy >= 99.5) return 'идеально';
    if (accuracy >= 98) return 'глаз-алмаз';
    if (accuracy >= 95) return 'почти безупречно';
    if (accuracy >= 90) return 'очень близко';
    if (accuracy >= 80) return 'хорошо';
    if (accuracy >= 70) return 'сойдёт';
    if (accuracy >= 50) return 'нужно сфокусироваться';
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

  function sparkles(x, y) {
    const svg = $('track');
    const n = 14;
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * Math.PI * 2 + Math.random() * 0.3;
      const dist = 28 + Math.random() * 30;
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
    $('hint').classList.remove('hidden');
    $('next-hint').classList.add('hidden');

    buildTrack();

    state.awaiting = true;
    state.showingResult = false;
  }

  function evaluateTap(clientX, clientY) {
    const tapX = projectTap(clientX);
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
        if (accuracy >= 99.5) tg.HapticFeedback.notificationOccurred('success');
        else if (accuracy >= 90) tg.HapticFeedback.impactOccurred('light');
        else tg.HapticFeedback.impactOccurred('rigid');
      } catch (_) {}
    }
    if (accuracy >= 99.5) {
      setTimeout(() => sparkles(tapX, y), 350);
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
    $('status').textContent = statusFor(accuracy);
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
    $('lb-modal').classList.remove('hidden');
    try {
      const resp = await fetch('/api/eyeball/leaderboard?initData=' + encodeURIComponent(tg.initData));
      const data = await resp.json();
      const list = $('lb-list');
      if (!data.top || data.top.length === 0) {
        list.innerHTML = '<div class="lb-empty">Пока никто не играл</div>';
      } else {
        const medals = ['1', '2', '3'];
        list.innerHTML = data.top.map((r, i) => {
          const m = medals[i] || (i + 1);
          return `<div class="lb-row">
            <span class="lb-pos">${m}</span>
            <span class="lb-name">${escapeHtml(r.username)}</span>
            <span class="lb-score">streak ${r.best_streak} · ${Number(r.best_accuracy).toFixed(1)}%</span>
          </div>`;
        }).join('');
      }
    } catch (err) {
      $('lb-list').innerHTML = '<div class="lb-empty">Ошибка загрузки</div>';
    }
  }

  // ---- Event handlers ----
  function onTap(ev) {
    const t = ev.target;
    if (t.closest('button') || t.closest('.modal')) return;
    // Activate audio on first user interaction
    ensureAudio();

    const cx = ev.touches ? ev.touches[0].clientX : ev.clientX;
    const cy = ev.touches ? ev.touches[0].clientY : ev.clientY;
    if (state.awaiting) {
      // Only count tap inside line zone
      const svgRect = $('track').getBoundingClientRect();
      if (cy < svgRect.top - 40 || cy > svgRect.bottom + 40) return;
      evaluateTap(cx, cy);
    } else if (state.showingResult) {
      newRound();
    }
  }
  document.addEventListener('click', onTap);

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
