(function () {
  'use strict';

  const tg = window.Telegram && window.Telegram.WebApp;
  if (tg) {
    tg.ready();
    tg.expand();
    try {
      tg.setHeaderColor('#000000');
      tg.setBackgroundColor('#000000');
    } catch (_) {}
  }

  const RANGE = 1800;
  const HIT_THRESHOLD_PCT = 5; // streak counts if error <= 5% of range

  const $ = id => document.getElementById(id);

  const state = {
    target: 0,
    track: null,
    best: null,
    avgSum: 0,
    streak: 0,
    rounds: 0,
    awaiting: false,
    showingResult: false,
  };

  let pendingFinish = false;

  function fmtNum(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  function viewport() {
    return {
      w: window.innerWidth || document.documentElement.clientWidth,
      h: window.innerHeight || document.documentElement.clientHeight,
    };
  }

  function newRound() {
    state.target = Math.round(50 + Math.random() * (RANGE - 100));
    $('target-num').textContent = fmtNum(state.target);
    $('range-label').textContent = `0 to ${fmtNum(RANGE)}`;

    const vp = viewport();
    const safeTop = Math.round(vp.h * 0.55);
    const safeBottom = Math.round(vp.h - 200);
    const trackY = safeTop + Math.random() * Math.max(20, safeBottom - safeTop);

    const minW = Math.min(vp.w * 0.6, 260);
    const maxW = Math.min(vp.w * 0.85, 600);
    const trackW = Math.round(minW + Math.random() * (maxW - minW));
    const slackX = vp.w - trackW;
    const trackX = Math.round(slackX * (0.15 + Math.random() * 0.7));

    const track = $('track');
    track.style.top = trackY + 'px';
    track.style.left = trackX + 'px';
    track.style.width = trackW + 'px';

    const minLbl = $('track-min');
    const maxLbl = $('track-max');
    minLbl.style.top = (trackY + 10) + 'px';
    minLbl.style.left = trackX + 'px';
    maxLbl.style.top = (trackY + 10) + 'px';
    maxLbl.style.left = (trackX + trackW - 30) + 'px';
    maxLbl.textContent = fmtNum(RANGE);

    $('marker-target').classList.add('hidden');
    $('marker-user').classList.add('hidden');
    $('result').classList.add('hidden');
    $('share').classList.add('hidden');
    $('hint').classList.remove('hidden');

    state.track = { x: trackX, y: trackY, w: trackW };
    state.awaiting = true;
    state.showingResult = false;
  }

  function evaluateTap(clientX) {
    const { x, y, w } = state.track;
    let tapX = clientX;
    if (tapX < x) tapX = x;
    if (tapX > x + w) tapX = x + w;

    const userValue = Math.round(((tapX - x) / w) * RANGE);
    const error = Math.abs(userValue - state.target);
    const errorPct = (error / RANGE) * 100;
    const accuracy = Math.max(0, 100 - errorPct);

    state.rounds++;
    state.avgSum += accuracy;
    state.best = state.best === null ? accuracy : Math.max(state.best, accuracy);
    if (errorPct <= HIT_THRESHOLD_PCT) state.streak++;
    else state.streak = 0;

    const targetX = x + (state.target / RANGE) * w;
    const mt = $('marker-target');
    mt.style.top = (y - 11) + 'px';
    mt.style.left = (targetX - 1) + 'px';
    mt.classList.remove('hidden');

    const mu = $('marker-user');
    mu.style.top = (y - 11) + 'px';
    mu.style.left = (tapX - 1) + 'px';
    mu.classList.remove('hidden');

    let emoji = '🫣';
    if (accuracy >= 99) emoji = '🎯';
    else if (accuracy >= 95) emoji = '🔥';
    else if (accuracy >= 85) emoji = '👍';
    else if (accuracy >= 70) emoji = '🙂';

    $('result').textContent = `${emoji} ${accuracy.toFixed(1)}% · off by ${error}`;
    $('result').classList.remove('hidden');
    $('hint').classList.add('hidden');
    $('share').classList.remove('hidden');

    state.awaiting = false;
    state.showingResult = true;

    if (tg && tg.HapticFeedback) {
      try {
        if (accuracy >= 95) tg.HapticFeedback.notificationOccurred('success');
        else if (accuracy >= 70) tg.HapticFeedback.impactOccurred('light');
        else tg.HapticFeedback.impactOccurred('rigid');
      } catch (_) {}
    }

    updateStatsUI();
    queueFinishSync();
  }

  function updateStatsUI() {
    $('best').textContent = state.best === null ? '—' : state.best.toFixed(1) + '%';
    $('avg').textContent = state.rounds === 0 ? '—' : (state.avgSum / state.rounds).toFixed(1) + '%';
    $('streak').textContent = state.streak;
    $('rounds').textContent = state.rounds;
  }

  function resetSession() {
    state.best = null;
    state.avgSum = 0;
    state.streak = 0;
    state.rounds = 0;
    updateStatsUI();
    newRound();
  }

  let finishTimer = null;
  function queueFinishSync() {
    if (!tg || !tg.initData) return;
    pendingFinish = true;
    if (finishTimer) clearTimeout(finishTimer);
    finishTimer = setTimeout(syncFinish, 600);
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
        btn.textContent = '✓ Отправлено';
        setTimeout(() => { try { tg.close(); } catch (_) {} }, 600);
      } else {
        btn.disabled = false;
        btn.textContent = '📤 Поделиться';
        if (tg.showAlert) tg.showAlert('Не получилось отправить');
      }
    } catch (err) {
      btn.disabled = false;
      btn.textContent = '📤 Поделиться';
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
    $('lb-list').innerHTML = '<div class="lb-empty">Загружаю...</div>';
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

  function onStageTap(ev) {
    const t = ev.target;
    if (t.closest('button') || t.closest('.modal') || t.closest('header')) return;
    const cx = ev.touches ? ev.touches[0].clientX : ev.clientX;
    if (state.awaiting) {
      evaluateTap(cx);
    } else if (state.showingResult) {
      newRound();
    }
  }

  document.addEventListener('click', onStageTap);

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
