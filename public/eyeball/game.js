(function () {
  'use strict';

  const tg = window.Telegram && window.Telegram.WebApp;
  if (tg) {
    tg.ready();
    tg.expand();
    try {
      tg.setHeaderColor('#0a0d18');
      tg.setBackgroundColor('#0a0d18');
    } catch (_) {}
  }

  const RANGE = 1800;
  const HIT_THRESHOLD_PCT = 5;
  const MAX_ANGLE_DEG = 30;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const $ = id => document.getElementById(id);

  const state = {
    target: 0,
    track: null,            // { p0:{x,y}, p1:{x,y}, dx, dy, len }
    best: null,
    avgSum: 0,
    streak: 0,
    rounds: 0,
    awaiting: false,
    showingResult: false,
    rolling: false,
  };

  function fmtNum(n) {
    return String(Math.max(0, Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  function viewport() {
    return {
      w: window.innerWidth || document.documentElement.clientWidth,
      h: window.innerHeight || document.documentElement.clientHeight,
    };
  }

  function clearSvg() {
    const svg = $('track-svg');
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const vp = viewport();
    svg.setAttribute('viewBox', `0 0 ${vp.w} ${vp.h}`);
    svg.setAttribute('width', vp.w);
    svg.setAttribute('height', vp.h);
  }

  function buildTrack() {
    const vp = viewport();
    const safeTop = Math.round(vp.h * 0.55);
    const safeBottom = Math.round(vp.h - 200);
    const cyBase = safeTop + Math.random() * Math.max(20, safeBottom - safeTop);

    const minLen = Math.min(vp.w * 0.55, 240);
    const maxLen = Math.min(vp.w * 0.78, 540);
    const len = Math.round(minLen + Math.random() * (maxLen - minLen));

    // angle: ±30° (random)
    const angleDeg = (Math.random() * 2 - 1) * MAX_ANGLE_DEG;
    const angleRad = angleDeg * Math.PI / 180;
    const dx = Math.cos(angleRad);
    const dy = Math.sin(angleRad);

    // horizontal extent of the rotated line
    const halfW = Math.abs(dx) * len / 2;
    const halfH = Math.abs(dy) * len / 2;

    // pick a center such that line stays within safe bounds
    const padX = 30;
    const cxMin = padX + halfW;
    const cxMax = vp.w - padX - halfW;
    const cx = cxMin + Math.random() * Math.max(0, cxMax - cxMin);
    // adjust cy so vertical extent fits
    let cy = cyBase;
    if (cy - halfH < safeTop - 20) cy = safeTop - 20 + halfH;
    if (cy + halfH > safeBottom + 20) cy = safeBottom + 20 - halfH;

    const p0 = { x: cx - dx * len / 2, y: cy - dy * len / 2 };
    const p1 = { x: cx + dx * len / 2, y: cy + dy * len / 2 };

    state.track = { p0, p1, dx, dy, len, cx, cy, angleRad };
    drawTrack();
  }

  function drawTrack() {
    clearSvg();
    const svg = $('track-svg');
    const { p0, p1, dx, dy } = state.track;

    // glow filter
    const defs = document.createElementNS(SVG_NS, 'defs');
    defs.innerHTML = `
      <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="3" result="blur"/>
        <feMerge>
          <feMergeNode in="blur"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
      <linearGradient id="lineGrad" x1="0%" y1="0%" x2="100%" y2="0%"
        gradientUnits="userSpaceOnUse"
        x1="${p0.x}" y1="${p0.y}" x2="${p1.x}" y2="${p1.y}">
        <stop offset="0%" stop-color="#cbd5e1" stop-opacity="0.4"/>
        <stop offset="50%" stop-color="#f1f3f9" stop-opacity="0.95"/>
        <stop offset="100%" stop-color="#cbd5e1" stop-opacity="0.4"/>
      </linearGradient>
    `;
    svg.appendChild(defs);

    // The actual line — animated draw-in
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', p0.x);
    line.setAttribute('y1', p0.y);
    line.setAttribute('x2', p0.x);
    line.setAttribute('y2', p0.y);
    line.setAttribute('stroke', 'url(#lineGrad)');
    line.setAttribute('stroke-width', '4');
    line.setAttribute('stroke-linecap', 'round');
    svg.appendChild(line);

    // animate the line growing from center outward
    const cx = (p0.x + p1.x) / 2;
    const cy = (p0.y + p1.y) / 2;
    line.setAttribute('x1', cx);
    line.setAttribute('y1', cy);
    line.setAttribute('x2', cx);
    line.setAttribute('y2', cy);

    requestAnimationFrame(() => {
      line.style.transition = 'all 0.45s cubic-bezier(0.34, 1.56, 0.64, 1)';
      line.setAttribute('x1', p0.x);
      line.setAttribute('y1', p0.y);
      line.setAttribute('x2', p1.x);
      line.setAttribute('y2', p1.y);
    });

    // perpendicular "down" vector for labels
    const px = -dy, py = dx;
    const lblOffset = 22;

    const lbl0 = document.createElementNS(SVG_NS, 'text');
    lbl0.setAttribute('x', p0.x + px * lblOffset);
    lbl0.setAttribute('y', p0.y + py * lblOffset + 4);
    lbl0.setAttribute('text-anchor', 'middle');
    lbl0.setAttribute('fill', '#4a5067');
    lbl0.setAttribute('font-size', '11');
    lbl0.setAttribute('font-family', 'inherit');
    lbl0.setAttribute('font-weight', '500');
    lbl0.setAttribute('letter-spacing', '1');
    lbl0.textContent = '0';
    svg.appendChild(lbl0);

    const lblMax = document.createElementNS(SVG_NS, 'text');
    lblMax.setAttribute('x', p1.x + px * lblOffset);
    lblMax.setAttribute('y', p1.y + py * lblOffset + 4);
    lblMax.setAttribute('text-anchor', 'middle');
    lblMax.setAttribute('fill', '#4a5067');
    lblMax.setAttribute('font-size', '11');
    lblMax.setAttribute('font-family', 'inherit');
    lblMax.setAttribute('font-weight', '500');
    lblMax.setAttribute('letter-spacing', '1');
    lblMax.textContent = fmtNum(RANGE);
    svg.appendChild(lblMax);

    state.svgRefs = { line, lbl0, lblMax };
  }

  function drawMarkers(tapT) {
    const svg = $('track-svg');
    const { p0, dx, dy, len } = state.track;

    // target marker
    const tT = (state.target / RANGE) * len;
    const tx = p0.x + dx * tT;
    const ty = p0.y + dy * tT;

    const targetMarker = document.createElementNS(SVG_NS, 'circle');
    targetMarker.setAttribute('cx', tx);
    targetMarker.setAttribute('cy', ty);
    targetMarker.setAttribute('r', '0');
    targetMarker.setAttribute('fill', '#fbbf24');
    targetMarker.setAttribute('filter', 'url(#glow)');
    svg.appendChild(targetMarker);

    // user marker
    const ux = p0.x + dx * tapT;
    const uy = p0.y + dy * tapT;
    const userMarker = document.createElementNS(SVG_NS, 'circle');
    userMarker.setAttribute('cx', ux);
    userMarker.setAttribute('cy', uy);
    userMarker.setAttribute('r', '0');
    userMarker.setAttribute('fill', '#22d3ee');
    userMarker.setAttribute('filter', 'url(#glow)');
    svg.appendChild(userMarker);

    // connecting line between user tap and target (shows error)
    const errLine = document.createElementNS(SVG_NS, 'line');
    errLine.setAttribute('x1', ux);
    errLine.setAttribute('y1', uy);
    errLine.setAttribute('x2', ux);
    errLine.setAttribute('y2', uy);
    errLine.setAttribute('stroke', '#fbbf24');
    errLine.setAttribute('stroke-width', '2');
    errLine.setAttribute('stroke-dasharray', '3 3');
    errLine.setAttribute('opacity', '0.5');
    svg.appendChild(errLine);

    requestAnimationFrame(() => {
      targetMarker.style.transition = 'r 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)';
      userMarker.style.transition = 'r 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) 0.1s';
      errLine.style.transition = 'all 0.4s ease-out 0.2s';
      targetMarker.setAttribute('r', '9');
      userMarker.setAttribute('r', '9');
      errLine.setAttribute('x2', tx);
      errLine.setAttribute('y2', ty);
    });
  }

  function animateTargetReveal(finalValue) {
    const el = $('target-num');
    state.rolling = true;
    el.classList.add('rolling');
    el.classList.remove('settle');

    const start = performance.now();
    const duration = 550;

    function step(now) {
      const elapsed = now - start;
      if (elapsed < duration) {
        // random flicker
        const fake = Math.floor(50 + Math.random() * (RANGE - 100));
        el.textContent = fmtNum(fake);
        requestAnimationFrame(step);
      } else {
        el.textContent = fmtNum(finalValue);
        el.classList.remove('rolling');
        el.classList.add('settle');
        setTimeout(() => el.classList.remove('settle'), 450);
        state.rolling = false;
      }
    }
    requestAnimationFrame(step);
  }

  function newRound() {
    state.target = Math.round(50 + Math.random() * (RANGE - 100));
    $('range-label').textContent = `от 0 до ${fmtNum(RANGE)}`;
    $('result').classList.add('hidden');
    $('share').classList.add('hidden');
    $('hint').classList.remove('hidden');

    buildTrack();
    animateTargetReveal(state.target);

    state.awaiting = true;
    state.showingResult = false;
  }

  function projectTapOntoTrack(tx, ty) {
    const { p0, dx, dy, len } = state.track;
    const vx = tx - p0.x;
    const vy = ty - p0.y;
    // projection of (vx,vy) onto (dx,dy)
    let t = vx * dx + vy * dy;
    if (t < 0) t = 0;
    if (t > len) t = len;
    return t;
  }

  function evaluateTap(clientX, clientY) {
    if (state.rolling) return; // ignore taps during number reveal
    const t = projectTapOntoTrack(clientX, clientY);
    const { len } = state.track;
    const userValue = Math.round((t / len) * RANGE);
    const error = Math.abs(userValue - state.target);
    const errorPct = (error / RANGE) * 100;
    const accuracy = Math.max(0, 100 - errorPct);

    state.rounds++;
    state.avgSum += accuracy;
    state.best = state.best === null ? accuracy : Math.max(state.best, accuracy);
    const isHit = errorPct <= HIT_THRESHOLD_PCT;
    const prevStreak = state.streak;
    if (isHit) state.streak++;
    else state.streak = 0;

    drawMarkers(t);
    showResult(accuracy, error);
    updateStatsUI(state.streak > prevStreak);

    if (tg && tg.HapticFeedback) {
      try {
        if (accuracy >= 99) tg.HapticFeedback.notificationOccurred('success');
        else if (accuracy >= 85) tg.HapticFeedback.impactOccurred('light');
        else tg.HapticFeedback.impactOccurred('rigid');
      } catch (_) {}
    }

    state.awaiting = false;
    state.showingResult = true;
    queueFinishSync();
  }

  function showResult(accuracy, error) {
    let emoji = '🫣', label = 'мимо';
    if (accuracy >= 99.5) { emoji = '🎯'; label = 'точно в цель'; }
    else if (accuracy >= 95) { emoji = '🔥'; label = 'отлично'; }
    else if (accuracy >= 85) { emoji = '👁'; label = 'хорошо'; }
    else if (accuracy >= 70) { emoji = '🙂'; label = 'неплохо'; }

    $('result-emoji').textContent = emoji;
    $('result-text').innerHTML =
      `<span style="color:#22d3ee">${accuracy.toFixed(1)}%</span>` +
      ` <span style="color:#4a5067">·</span> ` +
      `<span style="color:#8b91a8">${label}, ±${error}</span>`;

    $('result').classList.remove('hidden');
    $('hint').classList.add('hidden');
    $('share').classList.remove('hidden');
  }

  function updateStatsUI(streakIncreased) {
    $('best').textContent = state.best === null ? '—' : state.best.toFixed(1) + '%';
    $('avg').textContent = state.rounds === 0 ? '—' : (state.avgSum / state.rounds).toFixed(1) + '%';
    $('streak').textContent = state.streak;
    $('rounds').textContent = state.rounds;

    if (streakIncreased) {
      const el = document.querySelector('.streak-stat');
      el.classList.remove('bump');
      void el.offsetWidth;
      el.classList.add('bump');
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

  function ripple(x, y) {
    const r = document.createElement('div');
    r.className = 'ripple';
    r.style.left = x + 'px';
    r.style.top = y + 'px';
    document.body.appendChild(r);
    setTimeout(() => r.remove(), 500);
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
    if (!tg || !tg.initData) {
      alert('Открой через бота');
      return;
    }
    const btn = $('share');
    btn.disabled = true;
    const oldHtml = btn.innerHTML;
    btn.innerHTML = '<span>⏳</span> Отправляю...';
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
        btn.innerHTML = '<span>✓</span> Отправлено';
        setTimeout(() => { try { tg.close(); } catch (_) {} }, 600);
      } else {
        btn.disabled = false;
        btn.innerHTML = oldHtml;
        if (tg.showAlert) tg.showAlert('Не получилось отправить');
      }
    } catch (err) {
      btn.disabled = false;
      btn.innerHTML = oldHtml;
      if (tg && tg.showAlert) tg.showAlert('Ошибка сети');
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  }

  async function showLeaderboard() {
    if (!tg || !tg.initData) {
      alert('Открой через бота');
      return;
    }
    $('lb-list').innerHTML = '<div class="lb-loading">Загружаю...</div>';
    $('lb-modal').classList.remove('hidden');
    try {
      const resp = await fetch('/api/eyeball/leaderboard?initData=' + encodeURIComponent(tg.initData));
      const data = await resp.json();
      const list = $('lb-list');
      if (!data.top || data.top.length === 0) {
        list.innerHTML = '<div class="lb-empty">Пока никто не играл</div>';
      } else {
        const medals = ['🥇', '🥈', '🥉'];
        list.innerHTML = data.top.map((r, i) => {
          const m = medals[i] || `${i + 1}.`;
          return `<div class="lb-row">
            <span class="lb-pos">${m}</span>
            <span class="lb-name">${escapeHtml(r.username)}</span>
            <span class="lb-score">🔥 ${r.best_streak} · ${Number(r.best_accuracy).toFixed(1)}%</span>
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
    if (t.closest('button') || t.closest('.modal') || t.closest('header')) return;
    const cx = ev.touches ? ev.touches[0].clientX : ev.clientX;
    const cy = ev.touches ? ev.touches[0].clientY : ev.clientY;
    if (state.awaiting) {
      ripple(cx, cy);
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
      if (state.awaiting) newRound();
    }, 200);
  });

  resetSession();
})();
