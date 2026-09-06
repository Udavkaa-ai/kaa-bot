(function () {
  'use strict';

  const tg = window.Telegram && window.Telegram.WebApp;
  if (tg) {
    tg.ready();
    tg.expand();
    try { tg.setHeaderColor('#f5f3ef'); tg.setBackgroundColor('#f5f3ef'); } catch (_) {}
  }

  const DATA_URL = 'data.json?v=1';
  const GUESS_MS = 30000;
  const HURRY_MS = 6000;
  const GUESS_ROUNDS = 10;
  const BORDER_ROUNDS = 5;
  const WRONG_PENALTY = 5;     // очков за каждую неверную попытку
  const MIN_CORRECT_PTS = 5;   // угадал в последнюю секунду — всё равно что-то получишь

  const $ = id => document.getElementById(id);
  const initData = tg ? tg.initData : '';
  const myId = tg && tg.initDataUnsafe && tg.initDataUnsafe.user ? tg.initDataUnsafe.user.id : null;

  const INK = '#1a1a1a';
  const INK_FILL = 'rgba(26, 26, 26, 0.07)';
  const INK_SOFT = 'rgba(26, 26, 26, 0.55)';
  const MINT = '#10b981';
  const CORAL = '#ef4444';

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
  function soundOk() { tone(659, 0.12, 0.4); setTimeout(() => tone(988, 0.08, 0.5), 90); }
  function soundBad() { tone(196, 0.12, 0.4); }

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

  // =====================================================
  // КАРТА: данные, проекция, отрисовка
  // =====================================================
  // Координаты в data.json квантованы (целые) и дельта-кодированы; здесь держим целые —
  // по ним же сравниваем точки границы с точками контура (ключи совпадают бит в бит).
  let world = null;   // { tf, countries: [...], pairs: [...] }

  function decodeLine(arr) {
    const pts = [];
    let x = 0, y = 0;
    for (let i = 0; i < arr.length; i += 2) { x += arr[i]; y += arr[i + 1]; pts.push([x, y]); }
    return pts;
  }
  function normName(s) {
    return String(s).toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]/g, '');
  }

  async function loadWorld() {
    const resp = await fetch(DATA_URL);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const d = await resp.json();
    const tf = d.transform;
    const toLL = p => [p[0] * tf.scale[0] + tf.translate[0], p[1] * tf.scale[1] + tf.translate[1]];
    const countries = d.countries.map((c, idx) => {
      const polys = c.polys.map(poly => poly.map(decodeLine));
      const bbox = [Infinity, Infinity, -Infinity, -Infinity];
      const mainBbox = [Infinity, Infinity, -Infinity, -Infinity]; // главный (самый большой) полигон идёт первым
      polys.forEach((poly, pi) => {
        for (const ring of poly) for (const p of ring) {
          const [lon, lat] = toLL(p);
          if (lon < bbox[0]) bbox[0] = lon; if (lat < bbox[1]) bbox[1] = lat;
          if (lon > bbox[2]) bbox[2] = lon; if (lat > bbox[3]) bbox[3] = lat;
          if (pi === 0) {
            if (lon < mainBbox[0]) mainBbox[0] = lon; if (lat < mainBbox[1]) mainBbox[1] = lat;
            if (lon > mainBbox[2]) mainBbox[2] = lon; if (lat > mainBbox[3]) mainBbox[3] = lat;
          }
        }
      });
      return {
        idx, id: c.id, name: c.name, label: c.label, area: c.area, pop: c.pop,
        keys: [c.name, ...(c.alias || [])].map(normName),
        polys, bbox, mainBbox,
        // Чем больше страна, тем чуть чаще попадается — но без перекоса (log)
        weight: 1 + Math.log10(Math.max(1, c.area / 100)),
      };
    });
    const pairs = d.pairs.map(p => ({ a: p.a, b: p.b, km: p.km, border: p.border.map(decodeLine) }));
    world = { tf, toLL, countries, pairs };
  }

  // Проекция: простая равнопромежуточная с поправкой на широту центра — для силуэта достаточно
  function makeView(bbox, W, H, padFrac) {
    const lonC = (bbox[0] + bbox[2]) / 2, latC = (bbox[1] + bbox[3]) / 2;
    const kx = Math.cos(latC * Math.PI / 180);
    const wx = Math.max(1e-6, (bbox[2] - bbox[0]) * kx);
    const hy = Math.max(1e-6, bbox[3] - bbox[1]);
    const pad = Math.min(W, H) * padFrac;
    const scale = Math.min((W - 2 * pad) / wx, (H - 2 * pad) / hy);
    const tf = world.tf;
    return {
      W, H, scale, kx, lonC, latC,
      ll(lon, lat) { return [W / 2 + (lon - lonC) * kx * scale, H / 2 - (lat - latC) * scale]; },
      pt(p) { return this.ll(p[0] * tf.scale[0] + tf.translate[0], p[1] * tf.scale[1] + tf.translate[1]); },
    };
  }
  function bboxOfPts(pts, into) {
    const b = into || [Infinity, Infinity, -Infinity, -Infinity];
    for (const p of pts) {
      const [lon, lat] = world.toLL(p);
      if (lon < b[0]) b[0] = lon; if (lat < b[1]) b[1] = lat;
      if (lon > b[2]) b[2] = lon; if (lat > b[3]) b[3] = lat;
    }
    return b;
  }
  const ptKey = p => p[0] * 262144 + p[1];

  // ---- canvas ----
  const canvas = $('map');
  const ctx = canvas.getContext('2d');
  let cw = 0, ch = 0, dpr = 1;
  function sizeCanvas() {
    const rect = $('map-wrap').getBoundingClientRect();
    dpr = Math.min(3, window.devicePixelRatio || 1);
    cw = Math.max(1, Math.round(rect.width));
    ch = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function clear() { ctx.clearRect(0, 0, cw, ch); }

  function fillCountry(c, view, color) {
    ctx.beginPath();
    for (const poly of c.polys) for (const ring of poly) {
      ring.forEach((p, i) => { const [x, y] = view.pt(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.closePath();
    }
    ctx.fillStyle = color;
    ctx.fill('evenodd');
  }
  // Обводка контура; сегменты, оба конца которых лежат на общей границе, пропускаем
  function strokeCountry(c, view, color, width, skipKeys) {
    ctx.beginPath();
    for (const poly of c.polys) for (const ring of poly) {
      const n = ring.length;
      let open = false;
      for (let i = 0; i < n; i++) {
        const a = ring[i], b = ring[(i + 1) % n];
        if (skipKeys && skipKeys.has(ptKey(a)) && skipKeys.has(ptKey(b))) { open = false; continue; }
        const [bx, by] = view.pt(b);
        if (!open) { const [ax, ay] = view.pt(a); ctx.moveTo(ax, ay); open = true; }
        ctx.lineTo(bx, by);
      }
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  }
  function strokePolyline(pts, color, width, alpha = 1) {
    if (pts.length < 2) return;
    ctx.beginPath();
    pts.forEach((p, i) => { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); });
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  function drawLabel(text, x, y) {
    ctx.font = '500 10px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = INK_SOFT;
    // разрядка «в стиле» — рисуем побуквенно
    const letters = text.toUpperCase().split('');
    const sp = 2.2;
    const widths = letters.map(l => ctx.measureText(l).width);
    const total = widths.reduce((s, w) => s + w, 0) + sp * (letters.length - 1);
    // подпись большой страны часто за кадром — прижимаем к краю, целиком
    const m = 14;
    x = Math.max(m + total / 2, Math.min(cw - m - total / 2, x));
    y = Math.max(m, Math.min(ch - m, y));
    let cx = x - total / 2;
    letters.forEach((l, i) => { ctx.fillText(l, cx + widths[i] / 2, y); cx += widths[i] + sp; });
  }

  // =====================================================
  // ЭКРАНЫ, ТАЙМЕР, НАВИГАЦИЯ
  // =====================================================
  const screens = ['s-home', 's-game', 's-results'];
  let currentScreen = 's-home';
  let mode = 'guess';   // 'guess' | 'border'

  function syncBackButton() {
    if (!tg || !tg.BackButton) return;
    const modalOpen = !$('lb-modal').classList.contains('hidden');
    if (modalOpen || currentScreen !== 's-home') tg.BackButton.show();
    else tg.BackButton.hide();
  }
  function handleBack() {
    haptic('tap');
    if (!$('lb-modal').classList.contains('hidden')) {
      $('lb-modal').classList.add('hidden');
      syncBackButton();
      return;
    }
    stopTimer();
    show('s-home');
  }
  if (tg && tg.BackButton) {
    try { tg.BackButton.onClick(handleBack); } catch (_) {}
  }

  function show(id) {
    currentScreen = id;
    screens.forEach(s => $(s).classList.toggle('hidden', s !== id));
    syncBackButton();
    $('sub').textContent = {
      's-home': 'география на глаз',
      's-game': mode === 'guess' ? 'какая это страна?' : 'проведи границу',
      's-results': 'итоги',
    }[id] || '';
    if (id !== 's-game') $('guess-input').blur();
  }

  let timerHandle = null, hurryHandle = null;
  function startTimer(totalMs, onEnd) {
    stopTimer();
    const fill = $('timer-fill');
    fill.classList.remove('running', 'hurry');
    fill.style.transition = 'none';
    fill.style.transform = 'scaleX(1)';
    fill.style.opacity = '';
    void fill.offsetWidth;
    fill.style.transition = `transform ${totalMs}ms linear`;
    fill.style.transform = 'scaleX(0)';
    fill.classList.add('running');
    hurryHandle = setTimeout(() => fill.classList.add('hurry'), Math.max(0, totalMs - HURRY_MS));
    timerHandle = setTimeout(onEnd, totalMs);
  }
  function stopTimer() {
    if (timerHandle) { clearTimeout(timerHandle); timerHandle = null; }
    if (hurryHandle) { clearTimeout(hurryHandle); hurryHandle = null; }
    const fill = $('timer-fill');
    fill.classList.remove('running', 'hurry');
    fill.style.transition = 'none';
    fill.style.opacity = '0';
  }

  function pickWeighted(items, exclude) {
    const pool = items.filter(it => !exclude.has(it.idx));
    const total = pool.reduce((s, it) => s + (it.weight || 1), 0);
    let r = Math.random() * total;
    for (const it of pool) { r -= (it.weight || 1); if (r <= 0) return it; }
    return pool[pool.length - 1];
  }

  function showReview(status, cls, expl, nextLabel) {
    const st = $('g-status');
    st.className = 'review-status ' + cls;
    st.textContent = status;
    $('g-expl').innerHTML = expl || '';
    $('btn-next').textContent = nextLabel;
    $('g-review').classList.remove('hidden');
  }

  // =====================================================
  // РЕЖИМ «СТРАНА»
  // =====================================================
  const guess = { round: 0, score: 0, correct: 0, used: new Set(), current: null, wrong: 0, startedAt: 0, log: [], done: false };

  function guessStart() {
    mode = 'guess';
    guess.round = 0; guess.score = 0; guess.correct = 0; guess.used = new Set(); guess.log = [];
    $('g-score').textContent = '0';
    $('timer-track').classList.remove('hidden');
    $('guess-panel').classList.remove('hidden');
    $('border-panel').classList.add('hidden');
    $('map-hint').classList.add('hidden');
    $('map-wrap').classList.remove('drawable');
    show('s-game');
    guessRound();
  }

  function guessRound() {
    const c = pickWeighted(world.countries, guess.used);
    guess.used.add(c.idx);
    guess.current = c;
    guess.wrong = 0;
    guess.done = false;
    guess.startedAt = Date.now();
    $('g-progress').textContent = `${guess.round + 1}/${GUESS_ROUNDS}`;
    $('g-review').classList.add('hidden');
    $('guess-panel').classList.remove('hidden');
    const inp = $('guess-input');
    inp.value = '';
    inp.disabled = false;
    $('chips').innerHTML = '';
    sizeCanvas();
    drawSilhouette(c);
    startTimer(GUESS_MS, () => guessFinishRound(null));
    setTimeout(() => { try { inp.focus({ preventScroll: true }); } catch (_) {} }, 50);
  }

  function drawSilhouette(c) {
    clear();
    const view = makeView(c.bbox, cw, ch, 0.1);
    fillCountry(c, view, INK_FILL);
    strokeCountry(c, view, INK, 1.4, null);
  }

  function renderChips() {
    const q = normName($('guess-input').value);
    const box = $('chips');
    box.innerHTML = '';
    if (!q) return;
    const hits = world.countries
      .map(c => ({ c, rank: c.keys.some(k => k.startsWith(q)) ? 0 : (c.keys.some(k => k.includes(q)) ? 1 : -1) }))
      .filter(h => h.rank >= 0)
      .sort((a, b) => a.rank - b.rank || a.c.name.localeCompare(b.c.name, 'ru'))
      .slice(0, 5);
    if (!hits.length) { box.innerHTML = '<div class="chips-empty">такой страны нет</div>'; return; }
    hits.forEach((h, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (i === 0 ? ' first' : '');
      b.textContent = h.c.name;
      b.addEventListener('click', () => guessAnswer(h.c, b));
      box.appendChild(b);
    });
  }

  function guessAnswer(c, chip) {
    if (guess.done) return;
    if (c.idx === guess.current.idx) { guessFinishRound(c); return; }
    guess.wrong++;
    haptic('bad'); soundBad();
    if (chip) chip.classList.add('wrong');
    const inp = $('guess-input');
    inp.classList.add('shake');
    setTimeout(() => { inp.classList.remove('shake'); inp.value = ''; renderChips(); try { inp.focus({ preventScroll: true }); } catch (_) {} }, 320);
  }

  function guessFinishRound(answer) {
    if (guess.done) return;
    guess.done = true;
    stopTimer();
    const c = guess.current;
    const correct = !!answer;
    const secondsLeft = Math.max(0, (GUESS_MS - (Date.now() - guess.startedAt)) / 1000);
    const pts = correct ? Math.max(MIN_CORRECT_PTS, Math.round(secondsLeft) - WRONG_PENALTY * guess.wrong) : 0;
    guess.score += pts;
    if (correct) guess.correct++;
    guess.log.push({ name: c.name, pts, correct });
    $('g-score').textContent = String(guess.score);
    $('guess-input').blur();
    $('guess-panel').classList.add('hidden');
    const last = guess.round + 1 >= GUESS_ROUNDS;
    if (correct) {
      haptic('ok'); soundOk();
      showReview(`+${pts}`, 'ok', `<b>${escapeHtml(c.name)}</b>${guess.wrong ? ` · с ${guess.wrong + 1}-й попытки` : ''}`, last ? 'итоги' : 'дальше');
    } else {
      haptic('bad'); soundBad();
      showReview(answer === null && secondsLeft <= 0.05 ? 'время вышло' : 'мимо', 'late', `это <b>${escapeHtml(c.name)}</b>`, last ? 'итоги' : 'дальше');
    }
  }

  function guessNext() {
    guess.round++;
    if (guess.round >= GUESS_ROUNDS) { guessFinish(); return; }
    guessRound();
  }

  function guessFinish() {
    stopTimer();
    $('r-title').textContent = 'Страна';
    $('r-big').textContent = String(guess.score);
    $('r-small').textContent = `очков из ${GUESS_ROUNDS * 30} · угадано ${guess.correct}/${GUESS_ROUNDS}`;
    $('r-list').innerHTML = guess.log.map(r => `<div class="result-row">
      <span class="result-name${r.correct ? '' : ' miss'}">${escapeHtml(r.name)}</span>
      <span class="result-score${r.correct ? '' : ' zero'}">${r.correct ? '+' + r.pts : '—'}</span>
    </div>`).join('');
    show('s-results');
    haptic('ok');
    api('/api/contour/finish', { mode: 'guess', score: guess.score, correct: guess.correct, rounds: GUESS_ROUNDS }).catch(() => {});
  }

  // =====================================================
  // РЕЖИМ «ГРАНИЦА»
  // =====================================================
  const border = { round: 0, sum: 0, used: new Set(), pair: null, view: null, stroke: [], drawing: false, checked: false, log: [], A: null, B: null, skipKeys: null };

  function borderStart() {
    mode = 'border';
    border.round = 0; border.sum = 0; border.used = new Set(); border.log = [];
    $('g-score').textContent = '0';
    $('timer-track').classList.add('hidden');
    stopTimer();
    $('guess-panel').classList.add('hidden');
    $('border-panel').classList.remove('hidden');
    $('map-wrap').classList.add('drawable');
    show('s-game');
    borderRound();
  }

  function borderRound() {
    const pool = world.pairs.map((p, i) => ({ idx: i, p, weight: 1 }));
    const pick = pickWeighted(pool, border.used);
    border.used.add(pick.idx);
    const pr = pick.p;
    const A = world.countries[pr.a], B = world.countries[pr.b];
    border.pair = pr; border.A = A; border.B = B;
    border.stroke = []; border.drawing = false; border.checked = false;
    border.skipKeys = new Set();
    for (const chain of pr.border) for (const p of chain) border.skipKeys.add(ptKey(p));
    $('g-progress').textContent = `${border.round + 1}/${BORDER_ROUNDS}`;
    $('g-review').classList.add('hidden');
    $('border-panel').classList.remove('hidden');
    $('btn-check').disabled = true;
    $('btn-redraw').classList.add('hidden');
    $('map-hint').classList.remove('hidden');
    $('pair-names').innerHTML = `${escapeHtml(A.name)}<span class="vs">·</span>${escapeHtml(B.name)}`;
    sizeCanvas();
    border.view = makeView(borderBbox(), cw, ch, 0.12);
    drawBorderScene(false);
  }

  // Картинка: основной кусок меньшей страны целиком + вся граница; большая — сколько влезет
  function borderBbox() {
    const { A, B, pair } = border;
    const small = A.area <= B.area ? A : B;
    const bbox = small.mainBbox.slice();
    for (const chain of pair.border) bboxOfPts(chain, bbox);
    return bbox;
  }

  function drawBorderScene(reveal) {
    const { A, B, view, pair } = border;
    clear();
    fillCountry(A, view, INK_FILL);
    fillCountry(B, view, INK_FILL);
    strokeCountry(A, view, INK, 1.3, border.skipKeys);
    strokeCountry(B, view, INK, 1.3, border.skipKeys);
    for (const c of [A, B]) {
      const [x, y] = view.ll(c.label[0], c.label[1]);
      drawLabel(c.name, x, y);
    }
    if (reveal) {
      for (const chain of pair.border) strokePolyline(chain.map(p => view.pt(p)), MINT, 2.4);
      strokePolyline(border.stroke, CORAL, 2, 0.75);
    } else {
      strokePolyline(border.stroke, INK, 2);
    }
  }

  // ---- рисование пальцем ----
  function canvasPoint(e) {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }
  canvas.addEventListener('pointerdown', e => {
    if (mode !== 'border' || border.checked) return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    border.drawing = true;
    border.stroke = [canvasPoint(e)];
    $('map-hint').classList.add('hidden');
    drawBorderScene(false);
  });
  canvas.addEventListener('pointermove', e => {
    if (!border.drawing) return;
    e.preventDefault();
    const p = canvasPoint(e);
    const last = border.stroke[border.stroke.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 1.5) return;
    border.stroke.push(p);
    // дорисовываем только новый сегмент — без полной перерисовки на каждое движение
    strokePolyline([last, p], INK, 2);
  });
  function endStroke(e) {
    if (!border.drawing) return;
    border.drawing = false;
    const len = strokeLength(border.stroke);
    const ok = len > Math.min(cw, ch) * 0.12;
    $('btn-check').disabled = !ok;
    $('btn-redraw').classList.toggle('hidden', !border.stroke.length);
    if (!ok) $('map-hint').classList.remove('hidden');
  }
  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);
  canvas.addEventListener('pointerleave', endStroke);

  function strokeLength(pts) {
    let s = 0;
    for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return s;
  }
  function resample(pts, step) {
    if (pts.length < 2) return pts.slice();
    const out = [pts[0]];
    let carry = 0;
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
      const seg = Math.hypot(bx - ax, by - ay);
      if (seg === 0) continue;
      let t = step - carry;
      while (t <= seg) { out.push([ax + (bx - ax) * t / seg, ay + (by - ay) * t / seg]); t += step; }
      carry = seg - (t - step);
    }
    out.push(pts[pts.length - 1]);
    return out;
  }
  function distToPolylines(p, lines) {
    let best = Infinity;
    for (const line of lines) {
      for (let i = 1; i < line.length; i++) {
        const [ax, ay] = line[i - 1], [bx, by] = line[i];
        const dx = bx - ax, dy = by - ay;
        const l2 = dx * dx + dy * dy;
        let t = l2 ? ((p[0] - ax) * dx + (p[1] - ay) * dy) / l2 : 0;
        t = Math.max(0, Math.min(1, t));
        const d = Math.hypot(p[0] - (ax + dx * t), p[1] - (ay + dy * t));
        if (d < best) best = d;
      }
    }
    return best;
  }
  // Оценка: среднее расстояние от настоящей границы до нарисованной и обратно,
  // в долях диагонали картинки. Идеал — 100, дальше 12% диагонали — 0.
  function scoreStroke() {
    const real = border.pair.border.map(chain => chain.map(p => border.view.pt(p)));
    const user = [border.stroke];
    const step = 3;
    const realPts = real.flatMap(l => resample(l, step));
    const userPts = resample(border.stroke, step);
    const d1 = realPts.reduce((s, p) => s + distToPolylines(p, user), 0) / realPts.length;
    const d2 = userPts.reduce((s, p) => s + distToPolylines(p, real), 0) / userPts.length;
    const d = (d1 + d2) / 2 / Math.hypot(cw, ch);
    return Math.round(100 * Math.pow(Math.max(0, 1 - d / 0.12), 1.2));
  }

  function borderCheck() {
    if (border.checked || border.stroke.length < 2) return;
    border.checked = true;
    const pts = scoreStroke();
    border.sum += pts;
    border.log.push({ name: `${border.A.name} · ${border.B.name}`, pts });
    $('g-score').textContent = String(Math.round(border.sum / (border.round + 1)));
    drawBorderScene(true);
    $('border-panel').classList.add('hidden');
    const last = border.round + 1 >= BORDER_ROUNDS;
    const verdict = pts >= 90 ? ['картограф', 'ok'] : pts >= 70 ? ['близко', 'ok'] : pts >= 45 ? ['примерно', 'mid'] : ['мимо', 'bad'];
    if (pts >= 70) { haptic('ok'); soundOk(); } else { haptic('bad'); soundBad(); }
    showReview(`${pts}`, verdict[1], `${verdict[0]} · зелёная — настоящая граница${border.pair.km ? `, ${border.pair.km} км` : ''}`, last ? 'итоги' : 'дальше');
  }

  function borderNext() {
    border.round++;
    if (border.round >= BORDER_ROUNDS) { borderFinish(); return; }
    borderRound();
  }

  function borderFinish() {
    const avg = Math.round(border.sum / BORDER_ROUNDS);
    $('r-title').textContent = 'Граница';
    $('r-big').textContent = String(avg);
    $('r-small').textContent = `средняя точность из 100 · ${BORDER_ROUNDS} границ`;
    $('r-list').innerHTML = border.log.map(r => `<div class="result-row">
      <span class="result-name">${escapeHtml(r.name)}</span>
      <span class="result-score${r.pts < 45 ? ' zero' : ''}">${r.pts}</span>
    </div>`).join('');
    show('s-results');
    haptic('ok');
    api('/api/contour/finish', { mode: 'border', score: avg, sum: border.sum, rounds: BORDER_ROUNDS }).catch(() => {});
  }

  // =====================================================
  // ТОП ЧАТА
  // =====================================================
  let currentMetric = 'guess';
  async function showLeaderboard(metric) {
    haptic('tap');
    if (metric === 'guess' || metric === 'border') currentMetric = metric;
    document.querySelectorAll('.season-tab').forEach(el => {
      el.classList.toggle('active', el.getAttribute('data-metric') === currentMetric);
    });
    $('lb-list').innerHTML = '<div class="lb-loading">Загружаю...</div>';
    $('lb-me').classList.add('hidden');
    $('lb-modal').classList.remove('hidden');
    syncBackButton();
    try {
      const data = await apiGet(`/api/contour/leaderboard?metric=${currentMetric}`);
      const me = data.me;
      const unit = currentMetric === 'guess' ? '' : '%';
      if (me && me.games > 0) {
        $('me-best').textContent = me.best + unit;
        $('me-rank').textContent = '#' + me.rank;
        $('me-games').textContent = me.games;
        const cmp = [];
        if (data.aggregates && data.aggregates.max_best > 0) {
          if (me.best >= data.aggregates.max_best) cmp.push('Ты — лидер чата 👑');
          else cmp.push(`До лидера: ещё <span class="frac">${data.aggregates.max_best - me.best}</span>`);
        }
        $('lb-me-compare').innerHTML = cmp.map(t => `<div class="cmp">${t}</div>`).join('');
        $('lb-me').classList.remove('hidden');
      }
      const list = $('lb-list');
      if (!data.top || !data.top.length) {
        list.innerHTML = '<div class="lb-empty">Пока никто не играл</div>';
      } else {
        list.innerHTML = data.top.map((r, i) => {
          const mine = myId && r.user_id === String(myId) ? ' mine' : '';
          return `<div class="lb-row${mine}">
            <span class="lb-pos">${i + 1}</span>
            <span class="lb-name">${escapeHtml(r.name)}</span>
            <span class="lb-score"><b>${r.best}${unit}</b> · игр ${r.games}</span>
          </div>`;
        }).join('');
      }
    } catch (err) {
      $('lb-list').innerHTML = '<div class="lb-empty">Ошибка загрузки</div>';
    }
  }
  $('btn-lb-home').addEventListener('click', () => showLeaderboard(currentMetric));
  $('btn-lb-results').addEventListener('click', () => showLeaderboard(mode));
  document.querySelectorAll('.season-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const m = tab.getAttribute('data-metric');
      if (m !== currentMetric) showLeaderboard(m);
    });
  });
  $('lb-close').addEventListener('click', () => { $('lb-modal').classList.add('hidden'); syncBackButton(); });

  // =====================================================
  // СОБЫТИЯ
  // =====================================================
  $('btn-guess').addEventListener('click', () => { haptic('tap'); guessStart(); });
  $('btn-border').addEventListener('click', () => { haptic('tap'); borderStart(); });
  $('guess-input').addEventListener('input', renderChips);
  $('guess-input').addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const first = $('chips').querySelector('.chip');
    if (first) first.click();
  });
  $('btn-skip').addEventListener('click', () => { haptic('tap'); guessFinishRound(null); });
  $('btn-check').addEventListener('click', () => { haptic('tap'); borderCheck(); });
  $('btn-redraw').addEventListener('click', () => {
    haptic('tap');
    border.stroke = [];
    $('btn-check').disabled = true;
    $('btn-redraw').classList.add('hidden');
    $('map-hint').classList.remove('hidden');
    drawBorderScene(false);
  });
  $('btn-next').addEventListener('click', () => { haptic('tap'); if (mode === 'guess') guessNext(); else borderNext(); });
  $('btn-again').addEventListener('click', () => { if (mode === 'guess') guessStart(); else borderStart(); });
  $('btn-home2').addEventListener('click', () => show('s-home'));

  // Поворот/ресайз — перерисовать текущую сцену
  window.addEventListener('resize', () => {
    if (currentScreen !== 's-game') return;
    sizeCanvas();
    if (mode === 'guess' && guess.current) drawSilhouette(guess.current);
    else if (mode === 'border' && border.pair) {
      // масштаб поменялся — нарисованное пальцем уже не там; сбрасываем
      border.view = makeView(borderBbox(), cw, ch, 0.12);
      if (!border.checked) { border.stroke = []; $('btn-check').disabled = true; }
      drawBorderScene(border.checked);
    }
  });

  // ---- старт ----
  show('s-home');
  loadWorld().then(() => {
    $('home-note').innerHTML = `<b>${world.countries.length}</b> стран · <b>${world.pairs.length}</b> границ`;
    $('btn-guess').disabled = false;
    $('btn-border').disabled = false;
  }).catch(err => {
    $('home-note').textContent = 'не удалось загрузить карту';
  });
})();
