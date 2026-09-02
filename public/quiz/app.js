(function () {
  'use strict';

  const tg = window.Telegram && window.Telegram.WebApp;
  if (tg) {
    tg.ready();
    tg.expand();
    try { tg.setHeaderColor('#f5f3ef'); tg.setBackgroundColor('#f5f3ef'); } catch (_) {}
  }

  const Q_MS = 15000;
  const REVIEW_MS = 4000;
  const HURRY_MS = 4000;
  const $ = id => document.getElementById(id);
  const initData = tg ? tg.initData : '';
  const myId = tg && tg.initDataUnsafe && tg.initDataUnsafe.user ? tg.initDataUnsafe.user.id : null;

  function haptic(kind) {
    if (!tg || !tg.HapticFeedback) return;
    try {
      if (kind === 'ok') tg.HapticFeedback.notificationOccurred('success');
      else if (kind === 'bad') tg.HapticFeedback.notificationOccurred('error');
      else tg.HapticFeedback.impactOccurred('light');
    } catch (_) {}
  }

  // ---- звук (камертон, как в Сечении) ----
  let audioCtx = null;
  function tone(freq, gain = 0.12, dur = 0.35) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = freq;
      const t = audioCtx.currentTime;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(t); o.stop(t + dur + 0.05);
    } catch (_) {}
  }

  // ---- API ----
  async function api(path, body) {
    const resp = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, ...(body || {}) }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.error) throw new Error(data.error || `HTTP ${resp.status}`);
    return data;
  }
  async function apiGet(path) {
    const sep = path.includes('?') ? '&' : '?';
    const resp = await fetch(`${path}${sep}initData=${encodeURIComponent(initData)}`);
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.error) throw new Error(data.error || `HTTP ${resp.status}`);
    return data;
  }

  function escapeHtml(s) {
    return String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  }

  // ---- экраны ----
  const screens = ['s-home', 's-setup', 's-lobby', 's-game', 's-results'];
  function show(id) {
    screens.forEach(s => $(s).classList.toggle('hidden', s !== id));
    $('sub').textContent = {
      's-home': 'викторина на время',
      's-setup': mode === 'solo' ? 'тренировка' : 'соревнование',
      's-lobby': 'набор игроков',
      's-game': mode === 'solo' ? 'тренировка' : 'соревнование',
      's-results': 'итоги',
    }[id] || '';
  }

  // ---- таймер ----
  let timerHandle = null, hurryHandle = null;
  function startTimer(remainingMs, totalMs, onEnd) {
    stopTimer();
    const fill = $('timer-fill');
    const frac = Math.max(0, Math.min(1, remainingMs / totalMs));
    fill.classList.remove('running', 'hurry');
    fill.style.transition = 'none';
    fill.style.transform = `scaleX(${frac})`;
    fill.style.opacity = '';
    void fill.offsetWidth;
    fill.style.transition = `transform ${Math.max(0, remainingMs)}ms linear`;
    fill.style.transform = 'scaleX(0)';
    fill.classList.add('running');
    const hurryIn = remainingMs - HURRY_MS;
    if (hurryIn <= 0) fill.classList.add('hurry');
    else hurryHandle = setTimeout(() => fill.classList.add('hurry'), hurryIn);
    if (onEnd) timerHandle = setTimeout(onEnd, Math.max(0, remainingMs));
  }
  function stopTimer() {
    if (timerHandle) { clearTimeout(timerHandle); timerHandle = null; }
    if (hurryHandle) { clearTimeout(hurryHandle); hurryHandle = null; }
    const fill = $('timer-fill');
    fill.classList.remove('running', 'hurry');
    fill.style.transition = 'none';
    fill.style.opacity = '0';
  }

  // ---- общее состояние ----
  let mode = 'solo';          // 'solo' | 'arena'
  let selectedCount = 10;
  let renderedQ = -1;         // какой qIndex уже отрисован

  function renderQuestion(q, qIndex, total, opts = {}) {
    $('g-progress').textContent = `${qIndex + 1}/${total}`;
    $('g-question').textContent = q.text;
    const box = $('g-options');
    box.innerHTML = '';
    q.options.forEach((o, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'opt';
      b.innerHTML = `<span class="opt-idx">${'ABCD'[i]}</span><span>${escapeHtml(o)}</span>`;
      b.disabled = !!opts.disabled;
      b.addEventListener('click', () => opts.onPick && opts.onPick(i, b));
      box.appendChild(b);
    });
    $('g-review').classList.add('hidden');
    $('g-wait').classList.add('hidden');
    $('btn-next').classList.add('hidden');
    renderedQ = qIndex;
  }

  function lockOptions(chosen) {
    [...$('g-options').children].forEach((b, i) => {
      b.disabled = true;
      if (i === chosen) b.classList.add('chosen');
    });
  }

  function revealOptions(correct, chosen) {
    [...$('g-options').children].forEach((b, i) => {
      b.disabled = true;
      b.classList.remove('chosen');
      if (i === correct) b.classList.add('correct');
      else if (i === chosen) b.classList.add('wrong');
      else b.classList.add('dim');
    });
  }

  function showReview({ correct, points, explanation, late, board }) {
    const st = $('g-status');
    st.className = 'review-status';
    if (late) { st.textContent = 'время вышло'; st.classList.add('late'); }
    else if (correct) { st.textContent = `+${points}`; st.classList.add('ok'); }
    else { st.textContent = 'мимо'; st.classList.add('bad'); }
    $('g-expl').textContent = explanation || '';
    $('g-board').innerHTML = board || '';
    $('g-review').classList.remove('hidden');
  }

  function pointsFor(correct, remainingMs) {
    return correct ? 100 + Math.round(100 * Math.max(0, remainingMs) / Q_MS) : 0;
  }

  // =====================================================
  // ТРЕНИРОВКА
  // =====================================================
  const solo = { topic: '', total: 10, index: 0, score: 0, correct: 0, asked: [], next: null, current: null, startedAt: 0 };

  async function fetchSoloQuestion() {
    const data = await api('/api/quiz/solo/question', { topic: solo.topic, avoid: solo.asked.slice(-30) });
    return data.question;
  }

  async function soloStart() {
    solo.total = selectedCount;
    solo.index = 0; solo.score = 0; solo.correct = 0; solo.asked = []; solo.next = null; solo.current = null;
    $('g-score').textContent = '0';
    show('s-game');
    $('g-options').innerHTML = '';
    $('g-question').textContent = '';
    $('g-review').classList.add('hidden');
    $('g-wait').classList.remove('hidden');
    stopTimer();
    try {
      solo.current = await fetchSoloQuestion();
    } catch (err) {
      $('g-wait').textContent = 'не получилось подготовить вопрос';
      return;
    }
    soloShowCurrent();
  }

  function soloPrefetch() {
    if (solo.index + 1 >= solo.total) return;
    solo.next = fetchSoloQuestion().catch(() => null);
  }

  function soloShowCurrent() {
    const q = solo.current;
    solo.asked.push(q.question);
    $('g-wait').classList.add('hidden');
    renderQuestion({ text: q.question, options: q.options }, solo.index, solo.total, {
      onPick: (i) => soloAnswer(i),
    });
    solo.startedAt = Date.now();
    startTimer(Q_MS, Q_MS, () => soloAnswer(null));
    soloPrefetch();
  }

  function soloAnswer(i) {
    stopTimer();
    const q = solo.current;
    const late = i === null;
    const correct = !late && i === q.correct_option;
    const remaining = Q_MS - (Date.now() - solo.startedAt);
    const pts = pointsFor(correct, remaining);
    solo.score += pts;
    if (correct) solo.correct++;
    $('g-score').textContent = String(solo.score);
    revealOptions(q.correct_option, late ? -1 : i);
    showReview({ correct, points: pts, explanation: q.explanation, late });
    if (correct) { haptic('ok'); tone(659, 0.12, 0.4); setTimeout(() => tone(988, 0.08, 0.5), 90); }
    else { haptic('bad'); tone(196, 0.12, 0.4); }
    $('btn-next').classList.remove('hidden');
    $('btn-next').textContent = solo.index + 1 >= solo.total ? 'итоги' : 'дальше';
  }

  async function soloNext() {
    solo.index++;
    if (solo.index >= solo.total) { soloFinish(); return; }
    $('btn-next').classList.add('hidden');
    $('g-review').classList.add('hidden');
    $('g-options').innerHTML = '';
    $('g-question').textContent = '';
    $('g-wait').textContent = 'готовлю вопрос…';
    $('g-wait').classList.remove('hidden');
    let q = solo.next ? await solo.next : null;
    if (!q) {
      try { q = await fetchSoloQuestion(); } catch (_) {}
    }
    if (!q) { $('g-wait').textContent = 'не получилось подготовить вопрос'; return; }
    solo.current = q;
    soloShowCurrent();
  }

  function soloFinish() {
    stopTimer();
    const maxPts = solo.total * 200;
    $('r-title').textContent = 'Тренировка';
    $('r-list').innerHTML =
      `<div class="solo-summary">
        <div class="solo-big">${solo.score}</div>
        <div class="solo-small">очков из ${maxPts} · верных ${solo.correct}/${solo.total}</div>
      </div>`;
    show('s-results');
    haptic('ok');
  }

  // =====================================================
  // СОРЕВНОВАНИЕ
  // =====================================================
  let arenaPoll = null;
  let arenaState = null;
  let serverOffset = 0;      // serverNow - Date.now()
  let arenaShownReviewFor = -1;
  let arenaLastPhase = null;

  function arenaStartPolling(intervalMs = 1000) {
    arenaStopPolling();
    const loop = async () => {
      try {
        const st = await apiGet('/api/quiz/arena/state');
        serverOffset = st.serverNow ? st.serverNow - Date.now() : 0;
        arenaState = st.exists ? st : null;
        arenaRender();
      } catch (err) { /* сеть моргнула — попробуем в следующий тик */ }
    };
    loop();
    arenaPoll = setInterval(loop, intervalMs);
  }
  function arenaStopPolling() {
    if (arenaPoll) { clearInterval(arenaPoll); arenaPoll = null; }
  }
  function remainingMs() {
    if (!arenaState || !arenaState.phaseEndsAt) return 0;
    return arenaState.phaseEndsAt - (Date.now() + serverOffset);
  }

  function playerRow(p, extra = '') {
    const me = p.id === myId ? ' me' : '';
    return `<div class="player">
      <span class="player-dot ${p.answered ? 'on' : ''}"></span>
      <span class="player-name${me}">${escapeHtml(p.name)}</span>
      ${extra}
    </div>`;
  }

  function arenaRender() {
    const st = arenaState;
    const visible = !$('s-lobby').classList.contains('hidden') || !$('s-game').classList.contains('hidden')
      || (!$('s-results').classList.contains('hidden') && mode === 'arena');
    if (!st) {
      if (visible) { arenaStopPolling(); show('s-home'); homeCheck(); }
      return;
    }

    if (st.phase === 'lobby') {
      if ($('s-lobby').classList.contains('hidden')) show('s-lobby');
      $('lobby-topic').textContent = st.topic ? `«${st.topic}»` : 'случайные темы';
      const prep = $('lobby-prep');
      if (st.genError && st.count === 0) { prep.textContent = st.genError; prep.classList.remove('ready'); }
      else if (!st.genDone) { prep.textContent = `готовим вопросы ${st.genReady}/${st.genTotal}`; prep.classList.remove('ready'); }
      else { prep.textContent = `${st.count} вопросов готово · 15 секунд на каждый`; prep.classList.add('ready'); }

      let html = st.players.map(p => playerRow(p, p.id === st.hostId ? '<span class="player-tag">хост</span>' : '')).join('');
      for (let i = st.players.length; i < st.maxPlayers; i++) {
        html += `<div class="player"><span class="player-dot"></span><span class="player-name player-slot">свободно</span></div>`;
      }
      $('lobby-players').innerHTML = html;

      $('btn-join').classList.toggle('hidden', st.joined || st.players.length >= st.maxPlayers);
      $('btn-start').classList.toggle('hidden', !st.isHost);
      $('btn-start').disabled = !(st.isHost && st.players.length >= st.minPlayers && st.genDone && st.count > 0);
      $('btn-leave').classList.toggle('hidden', !st.joined);
      const note = $('lobby-note');
      if (!st.joined) note.textContent = st.players.length >= st.maxPlayers ? 'мест нет' : 'присоединяйся';
      else if (st.isHost) note.textContent = st.players.length < st.minPlayers ? `ждём ещё ${st.minPlayers - st.players.length}` : (st.genDone ? 'можно стартовать' : 'вопросы готовятся');
      else note.textContent = 'ждём, пока хост нажмёт старт';
      arenaLastPhase = 'lobby';
      return;
    }

    if (st.phase === 'question' || st.phase === 'review') {
      if ($('s-game').classList.contains('hidden')) show('s-game');
      $('g-score').textContent = String((st.players.find(p => p.id === myId) || {}).score || 0);

      if (st.question && renderedQ !== st.qIndex) {
        renderQuestion(st.question, st.qIndex, st.count, {
          disabled: !st.joined,
          onPick: (i, btn) => arenaAnswer(st.qIndex, i),
        });
        arenaShownReviewFor = -1;
        if (st.myAnswer !== null && st.myAnswer !== undefined) lockOptions(st.myAnswer);
      }

      if (st.phase === 'question') {
        if (arenaLastPhase !== 'question' || renderedQ !== st.qIndex) {
          startTimer(remainingMs(), st.qMs || Q_MS, null);
        }
        arenaLastPhase = 'question';
        if (st.myAnswer !== null && st.myAnswer !== undefined) {
          lockOptions(st.myAnswer);
          const answered = st.players.filter(p => p.answered).length;
          $('g-board').innerHTML = '';
          $('g-status').className = 'review-status late';
          $('g-status').textContent = `ответили ${answered}/${st.players.length}`;
          $('g-expl').textContent = '';
          $('g-review').classList.remove('hidden');
        }
      } else if (st.phase === 'review' && arenaShownReviewFor !== st.qIndex) {
        arenaShownReviewFor = st.qIndex;
        arenaLastPhase = 'review';
        stopTimer();
        const q = st.question;
        const mine = st.myLast;
        revealOptions(q.correct_option, st.myAnswer === null || st.myAnswer === undefined ? -1 : st.myAnswer);
        const board = [...st.players].sort((a, b) => b.score - a.score).map(p => {
          const d = p.last ? (p.last.correct ? `<span class="player-score delta">+${p.last.points}</span>` : `<span class="player-score">—</span>`) : `<span class="player-score">…</span>`;
          return playerRow({ ...p, answered: !!p.last }, `<span class="player-score">${p.score}</span>${d}`);
        }).join('');
        const late = st.joined && !mine;
        showReview({
          correct: mine ? mine.correct : false,
          points: mine ? mine.points : 0,
          explanation: q.explanation,
          late: late || !st.joined,
          board,
        });
        if (mine) {
          if (mine.correct) { haptic('ok'); tone(659, 0.12, 0.4); setTimeout(() => tone(988, 0.08, 0.5), 90); }
          else { haptic('bad'); tone(196, 0.12, 0.4); }
        }
      }
      return;
    }

    if (st.phase === 'finished') {
      arenaStopPolling();
      stopTimer();
      renderArenaResults(st);
      show('s-results');
      arenaLastPhase = 'finished';
    }
  }

  async function arenaAnswer(qIndex, i) {
    lockOptions(i);
    haptic('tap');
    try {
      await api('/api/quiz/arena/answer', { qIndex, option: i });
    } catch (err) {
      // вопрос уже закрыт — следующий poll всё покажет
    }
  }

  function renderArenaResults(st) {
    $('r-title').textContent = 'Итоги';
    const total = st.count;
    $('r-list').innerHTML = (st.results || []).map((p, i) => {
      const medal = ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
      const me = p.id === myId ? ' me' : '';
      return `<div class="result-row ${i === 0 ? 'winner' : ''}">
        <span class="result-pos">${medal}</span>
        <span class="result-name${me}">${escapeHtml(p.name)}<div class="result-sub">верных ${p.correct}/${total}</div></span>
        <span class="result-score">${p.score}</span>
      </div>`;
    }).join('');
  }

  async function arenaCreate() {
    const topic = $('topic').value.trim();
    try {
      await api('/api/quiz/arena/create', { topic, count: selectedCount });
    } catch (err) {
      if (tg && tg.showAlert) tg.showAlert(err.message); else alert(err.message);
      return;
    }
    renderedQ = -1;
    arenaStartPolling();
  }

  // ---- главный экран: есть ли комната в чате ----
  let homePoll = null;
  async function homeCheck() {
    try {
      const st = await apiGet('/api/quiz/arena/state');
      const note = $('home-note');
      if (st.exists && st.phase === 'lobby') {
        note.innerHTML = `в чате идёт набор: <b>${st.players.length}/${st.maxPlayers}</b>${st.topic ? ` · «${escapeHtml(st.topic)}»` : ''}`;
        note.classList.remove('hidden');
        $('btn-arena').querySelector('.card-desc').textContent = 'идёт набор — присоединиться';
      } else if (st.exists && st.phase !== 'finished') {
        note.innerHTML = `в чате <b>идёт игра</b> · ${st.players.length} игроков`;
        note.classList.remove('hidden');
        $('btn-arena').querySelector('.card-desc').textContent = 'идёт игра — посмотреть';
      } else {
        note.classList.add('hidden');
        $('btn-arena').querySelector('.card-desc').textContent = '2–5 игроков, на время, итоги в топ чата';
      }
    } catch (_) {}
  }
  function homeStart() {
    show('s-home');
    homeCheck();
    if (homePoll) clearInterval(homePoll);
    homePoll = setInterval(() => {
      if ($('s-home').classList.contains('hidden')) { clearInterval(homePoll); homePoll = null; return; }
      homeCheck();
    }, 3000);
  }

  // ---- события ----
  $('btn-solo').addEventListener('click', () => {
    mode = 'solo';
    $('setup-title').textContent = 'Тренировка';
    $('btn-go').textContent = 'Начать';
    show('s-setup');
  });
  $('btn-arena').addEventListener('click', async () => {
    mode = 'arena';
    // Если комната уже есть — сразу в неё
    try {
      const st = await apiGet('/api/quiz/arena/state');
      if (st.exists && st.phase !== 'finished') { renderedQ = -1; arenaStartPolling(); return; }
    } catch (_) {}
    $('setup-title').textContent = 'Соревнование';
    $('btn-go').textContent = 'Создать комнату';
    show('s-setup');
  });
  document.querySelectorAll('.count-btn').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.count-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      selectedCount = parseInt(b.getAttribute('data-count'), 10) || 10;
      haptic('tap');
    });
  });
  $('btn-go').addEventListener('click', () => {
    haptic('tap');
    if (mode === 'solo') { solo.topic = $('topic').value.trim(); soloStart(); }
    else arenaCreate();
  });
  $('btn-back-home').addEventListener('click', homeStart);
  $('btn-join').addEventListener('click', async () => {
    haptic('tap');
    try { await api('/api/quiz/arena/join'); } catch (err) { if (tg && tg.showAlert) tg.showAlert(err.message); }
  });
  $('btn-start').addEventListener('click', async () => {
    haptic('tap');
    $('btn-start').disabled = true;
    try { await api('/api/quiz/arena/start'); } catch (err) { if (tg && tg.showAlert) tg.showAlert(err.message); $('btn-start').disabled = false; }
  });
  $('btn-leave').addEventListener('click', async () => {
    haptic('tap');
    try { await api('/api/quiz/arena/leave'); } catch (_) {}
    arenaStopPolling();
    homeStart();
  });
  $('btn-next').addEventListener('click', () => { if (mode === 'solo') soloNext(); });
  $('btn-again').addEventListener('click', () => {
    if (mode === 'solo') soloStart();
    else { $('setup-title').textContent = 'Соревнование'; $('btn-go').textContent = 'Создать комнату'; show('s-setup'); }
  });
  $('btn-home2').addEventListener('click', () => { arenaStopPolling(); homeStart(); });

  // Во время игры тап по экрану — никаких лишних действий; только кнопки.
  homeStart();
})();
