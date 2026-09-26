(function () {
  'use strict';

  // ================= Telegram =================
  // Вне Telegram скрипт SDK тоже создаёт WebApp, но с пустым initData — считаем, что Telegram нет
  const tgRaw = window.Telegram && window.Telegram.WebApp;
  const tg = tgRaw && tgRaw.initData ? tgRaw : null;
  let initData = tg ? tg.initData : '';
  if (tg) {
    tg.ready();
    tg.expand();
    try {
      const paper = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim();
      tg.setHeaderColor(paper); tg.setBackgroundColor(paper);
    } catch (_) {}
  }
  const $ = id => document.getElementById(id);
  const haptic = (k) => {
    if (!tg || !tg.HapticFeedback) return;
    try {
      if (k === 'ok') tg.HapticFeedback.notificationOccurred('success');
      else if (k === 'bad') tg.HapticFeedback.notificationOccurred('error');
      else tg.HapticFeedback.impactOccurred('light');
    } catch (_) {}
  };
  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ================= API =================
  async function api(method, path, body) {
    const opts = { method, headers: { 'X-Telegram-Init-Data': initData } };
    let url = `api${path}`;
    if (method === 'GET' && body) url += '?' + new URLSearchParams(body).toString();
    else if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const resp = await fetch(url, opts);
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) { const e = new Error(data.error || `Ошибка ${resp.status}`); e.status = resp.status; throw e; }
    return data;
  }

  // ================= утилиты =================
  const SEASON_RU = { spring: 'Весна', summer: 'Лето', autumn: 'Осень', winter: 'Зима' };
  const SEASON_GEN = { spring: 'весны', summer: 'лета', autumn: 'осени', winter: 'зимы' };
  const TERRAIN_RU = { plain: 'равнина', forest: 'лес', swamp: 'болото', hills: 'холмы' };
  const PAY_RU = { low: 'скудно', normal: 'как положено', high: 'щедро' };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = v => `${Math.round(v).toLocaleString('ru-RU')}`;
  const hm = min => { const h = Math.floor(min / 60), m = Math.round(min % 60); return h ? `${h} ч ${m} мин` : `${m} мин`; };
  const pluralCrews = n => { const a = Math.abs(n) % 100, b = a % 10; if (a > 10 && a < 20) return 'артелей'; if (b === 1) return 'артель'; if (b >= 2 && b <= 4) return 'артели'; return 'артелей'; };

  function toast(text, ms = 2600) {
    const el = $('toast');
    el.textContent = text;
    el.classList.remove('hidden');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.add('hidden'), ms);
  }

  // ================= состояние клиента =================
  // Источник истины — сервер: после каждого действия берём state/view из ответа.
  const S = {
    screen: 's-home',
    home: null,           // ответ /game
    content: {},          // chapter → контент
    chapter: null,
    state: null,
    view: null,
    quiz: null,
    selected: null,       // id участка в панели
    animate: new Set(),   // только что открытые участки — дочертить
    modalQueue: [],       // доклады, которые надо показать до депеш
    busy: false,
  };
  const C = () => S.content[S.chapter];

  async function loadContent(chapter) {
    if (!S.content[chapter]) {
      const c = await api('GET', '/content', { chapter });
      c.eventsById = Object.fromEntries(c.events.map(e => [e.id, e]));
      c.factsById = Object.fromEntries(c.facts.map(f => [f.id, f]));
      c.nodesById = Object.fromEntries(c.map.nodes.map(n => [n.id, n]));
      c.segById = Object.fromEntries(c.map.segments.map(s => [s.id, s]));
      S.content[chapter] = c;
    }
    return S.content[chapter];
  }

  // ================= навигация =================
  const SCREENS = ['s-home', 's-game', 's-final', 's-quiz', 's-museum', 's-about'];
  function show(id) {
    S.screen = id;
    SCREENS.forEach(s => $(s).classList.toggle('hidden', s !== id));
    syncTelegramButtons();
  }
  function modalOpen() { return !$('modal').classList.contains('hidden'); }
  function mapOpen() { return !$('map-sheet').classList.contains('hidden'); }

  // Карта — по кнопке, поверх игры (и поверх доклада, если открыта из него)
  function openMap() {
    haptic('tap');
    $('map-sheet').classList.remove('hidden');
    renderMap();
    syncTelegramButtons();
  }
  function closeMap() {
    $('map-sheet').classList.add('hidden');
    syncTelegramButtons();
  }

  function syncTelegramButtons() {
    const inGame = S.screen === 's-game' && S.state && !S.state.finished;
    const canEnd = inGame && !modalOpen() && !mapOpen() && !S.state.pendingEvents.length;
    $('btn-season').classList.toggle('hidden', !inGame || !!tg);
    $('btn-season').disabled = !canEnd || S.busy;
    if (!tg) return;
    try {
      if (tg.MainButton) {
        tg.MainButton.setText('Завершить сезон');
        if (canEnd) { tg.MainButton.show(); tg.MainButton.enable(); } else tg.MainButton.hide();
      }
      if (tg.BackButton) {
        if (S.screen !== 's-home' || mapOpen()) tg.BackButton.show();
        else tg.BackButton.hide();
      }
    } catch (_) {}
  }
  if (tg && tg.MainButton) tg.MainButton.onClick(() => endSeason());
  if (tg && tg.BackButton) tg.BackButton.onClick(() => goBack());
  $('btn-season').addEventListener('click', () => endSeason());
  $('btn-map').addEventListener('click', openMap);
  $('btn-map-close').addEventListener('click', () => { haptic('tap'); closeMap(); });

  function goBack() {
    haptic('tap');
    if (mapOpen()) { closeMap(); return; }
    if (modalOpen()) return; // депешу надо решить, доклад — закрыть кнопкой
    if (S.screen === 's-game' && S.selected) { S.selected = null; renderPanel(); syncTelegramButtons(); return; }
    if (S.screen === 's-quiz' || S.screen === 's-museum') { if (S.state && S.state.finished && S.screen === 's-quiz') { renderFinal(); show('s-final'); } else openHome(); return; }
    openHome();
  }

  // ================= титул =================
  const CHAPTER_INFO = {
    prologue: { title: 'Пролог. Царскосельская дорога', years: '1836–1838', desc: 'Обучение: два коротких участка, первый паровоз и первый рейс для публики.' },
    chapter1: { title: 'Глава I. Петербург — Москва', years: '1842–1851', desc: 'Трасса, колея, два пути, болота, Валдай, мосты и сроки. Главная дорога империи.' },
  };

  async function openHome() {
    show('s-home');
    try { S.home = await api('GET', '/game'); } catch (err) { $('home-note').textContent = err.message; return; }
    const saves = S.home.saves || {};
    const done = (S.home.player && S.home.player.completed) || {};
    $('chapters').innerHTML = ['prologue', 'chapter1'].map(ch => {
      const info = CHAPTER_INFO[ch];
      const sv = saves[ch];
      let status = '';
      if (done[ch]) status = `Пройдена${done[ch].stars != null ? ` · звёзд ${done[ch].stars} из ${done[ch].max}` : ''}`;
      else if (sv && !sv.finished) status = `Идёт: ${SEASON_RU[sv.season].toLowerCase()} ${sv.year}`;
      else if (sv && sv.finished) status = sv.outcome === 'won' ? 'Пройдена' : 'Проиграна';
      const cont = sv && !sv.finished;
      const review = sv && sv.finished && sv.outcome === 'won';
      return `<div class="chapter-card">
        <div class="years">${info.years}</div>
        <h3>${esc(info.title)}</h3>
        <div class="desc">${esc(info.desc)}</div>
        ${status ? `<div class="status">${esc(status)}</div>` : ''}
        <div class="row">
          ${cont ? `<button class="btn" data-resume="${ch}">Продолжить</button>` : ''}
          ${review ? `<button class="btn" data-resume="${ch}">Итоги</button>` : ''}
          <button class="btn ${cont || review ? 'ghost' : ''}" data-start="${ch}">${sv ? 'Начать заново' : 'Начать'}</button>
        </div>
      </div>`;
    }).join('');
    $('home-note').textContent = done.prologue || saves.chapter1 ? '' : 'Советуем начать с пролога: он учит механике за пару минут.';
    $('chapters').querySelectorAll('[data-start]').forEach(b => b.addEventListener('click', () => startChapter(b.dataset.start)));
    $('chapters').querySelectorAll('[data-resume]').forEach(b => b.addEventListener('click', () => resumeChapter(b.dataset.resume)));
  }

  async function startChapter(ch) {
    haptic('tap');
    const sv = S.home && S.home.saves && S.home.saves[ch];
    if (sv && !sv.finished && !(await confirmBox('Начать главу заново? Текущее сохранение будет стёрто.'))) return;
    await withBusy(async () => {
      await loadContent(ch);
      const r = await api('POST', '/game/start', { chapter: ch });
      enterGame(r);
    });
  }
  async function resumeChapter(ch) {
    haptic('tap');
    await withBusy(async () => {
      await loadContent(ch);
      const r = await api('POST', '/game/resume', { chapter: ch });
      enterGame(r);
    });
  }
  function confirmBox(text) {
    return new Promise(res => {
      if (tg && tg.showConfirm) { try { tg.showConfirm(text, ok => res(!!ok)); return; } catch (_) {} }
      res(window.confirm(text));
    });
  }
  async function withBusy(fn) {
    if (S.busy) return;
    S.busy = true; syncTelegramButtons();
    try { await fn(); } catch (err) { toast(err.message); haptic('bad'); } finally { S.busy = false; syncTelegramButtons(); }
  }

  function enterGame(r) {
    S.chapter = r.chapter;
    S.state = r.state;
    S.view = r.view;
    S.quiz = r.quiz || null;
    S.selected = null;
    S.animate.clear();
    if (S.state.finished) { renderFinal(); show('s-final'); return; }
    show('s-game');
    renderGame();
    handleLog(r.log || []);
  }

  // ================= игра: действия =================
  async function act(action, { silent = false } = {}) {
    let res = null;
    await withBusy(async () => {
      const r = await api('POST', '/game/action', { action });
      applyResult(r);
      res = r;
    });
    if (res && !silent) haptic('tap');
    return res;
  }
  function applyResult(r) {
    S.state = r.state;
    S.view = r.view;
    if (r.quiz !== undefined) S.quiz = r.quiz;
  }

  async function endSeason() {
    if (!S.state || S.state.finished || S.state.pendingEvents.length || modalOpen() || S.busy) return;
    flushCrews();
    await waitCrews();
    const r = await act({ type: 'END_SEASON' }, { silent: true });
    if (!r) return;
    haptic('ok');
    renderGame();
    handleLog(r.log || []);
  }

  // Артели: копим нажатия и отправляем итоговое число одним запросом
  const crewTimers = {};
  const crewPending = {};
  let crewFlight = Promise.resolve();
  function setCrewsLocal(segId, n) {
    const v = S.view.segments[segId];
    n = Math.max(0, Math.min(n, v.maxCrews));
    const freeNow = S.view.freeCrews + v.crews;
    n = Math.min(n, freeNow);
    if (n === v.crews) return;
    S.view.freeCrews = freeNow - n;
    v.crews = n;
    S.state.segments[segId].crews = n;
    crewPending[segId] = n;
    clearTimeout(crewTimers[segId]);
    crewTimers[segId] = setTimeout(() => sendCrews(segId), 450);
    haptic('tap');
    renderPanel(); renderRes(); renderMap();
  }
  function sendCrews(segId) {
    if (crewPending[segId] === undefined) return;
    const n = crewPending[segId];
    delete crewPending[segId];
    crewFlight = crewFlight.then(async () => {
      try {
        const r = await api('POST', '/game/action', { action: { type: 'ASSIGN_CREWS', segmentId: segId, crews: n } });
        applyResult(r);
      } catch (err) {
        toast(err.message);
        try { const g = await api('GET', '/game'); if (g.game) applyResult(g.game); } catch (_) {}
      }
      renderPanel(); renderRes(); renderMap();
    });
  }
  function flushCrews() { for (const id of Object.keys(crewTimers)) { clearTimeout(crewTimers[id]); sendCrews(id); } }
  function waitCrews() { return crewFlight; }

  // ================= игра: отрисовка =================
  function renderGame() {
    renderRes();
    renderMap();
    renderPanel();
    syncTelegramButtons();
  }

  function meter(v, cells = 5) {
    const f = Math.round(v / 100 * cells);
    return `<span class="meter${v <= 25 ? ' low' : ''}">${Array.from({ length: cells }, (_, i) => `<i class="${i < f ? 'f' : ''}"></i>`).join('')}</span>`;
  }
  function renderRes() {
    const s = S.state, v = S.view;
    if (!s) return;
    $('resbar').innerHTML = `
      <div class="res"><span class="lbl">${esc(C().map.title)}</span><span class="date">${SEASON_RU[s.season]} ${s.year}</span></div>
      <div class="res"><span class="lbl">Казна, тыс. руб.</span><span class="val${s.treasury < 0 ? ' neg' : ''}">${money(s.treasury)}</span></div>
      <div class="res"><span class="lbl">Артели своб./всего</span><span class="val">${v.freeCrews} / ${s.crewsTotal}</span></div>
      <div class="res"><span class="lbl">Благоволение</span>${meter(s.favor)}</div>
      <div class="res"><span class="lbl">Настрой</span>${meter(s.morale)}</div>
      <div class="res"><span class="lbl">Построено</span><span class="val">${Math.round(v.overallProgress)}%</span></div>`;
    const act = Object.values(v.segments).filter(x => x.active);
    const opened = act.filter(x => x.opened).length;
    const building = act.filter(x => !x.opened && x.crews > 0).length;
    $('map-toggle-sub').textContent = s.unlocked.construction
      ? `открыто ${opened} из ${act.length}${building ? ` · строится ${building}` : ''}`
      : 'посмотреть трассу';
  }

  // ---- карта-чертёж (SVG) ----
  const SVGNS = 'http://www.w3.org/2000/svg';
  function projector(nodes, W, H, pad) {
    const lats = nodes.map(n => n.lat), lons = nodes.map(n => n.lon);
    const lat0 = (Math.min(...lats) + Math.max(...lats)) / 2;
    const kx = Math.cos(lat0 * Math.PI / 180);
    const minX = Math.min(...lons) * kx, maxX = Math.max(...lons) * kx;
    const minY = Math.min(...lats), maxY = Math.max(...lats);
    const sc = Math.min((W - 2 * pad.x) / Math.max(1e-6, maxX - minX), (H - pad.top - pad.bottom) / Math.max(1e-6, maxY - minY));
    const offX = (W - (maxX - minX) * sc) / 2;
    const offY = pad.top + ((H - pad.top - pad.bottom) - (maxY - minY) * sc) / 2;
    return n => [offX + (n.lon * kx - minX) * sc, offY + (maxY - n.lat) * sc];
  }
  function lineLen(a, b) { return Math.hypot(b[0] - a[0], b[1] - a[1]); }

  function renderMap() {
    const svg = $('map');
    const c = C();
    if (!c || !mapOpen()) return;
    const box = $('map-wrap').getBoundingClientRect();
    const W = Math.max(300, Math.round(box.width)), H = Math.max(220, Math.round(box.height));
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const P = projector(c.map.nodes, W, H, { x: 46, top: 56, bottom: 26 });
    const s = S.state, v = S.view;
    const parts = [];

    parts.push(`<defs>
      <pattern id="p-forest" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M1 6 L3 2 M5 7 L7 3" class="hatch-forest"/></pattern>
      <pattern id="p-swamp" width="10" height="6" patternUnits="userSpaceOnUse"><path d="M0 3 H4 M6 3 H9" class="hatch-swamp"/></pattern>
      <pattern id="p-hills" width="10" height="8" patternUnits="userSpaceOnUse"><path d="M1 6 Q5 0 9 6" class="hatch-hills"/></pattern>
      <pattern id="p-plain" width="12" height="12" patternUnits="userSpaceOnUse"><circle cx="6" cy="6" r="0.6" class="hatch-plain"/></pattern>
    </defs>`);
    // Рамка — двойная линия
    parts.push(`<rect x="3" y="3" width="${W - 6}" height="${H - 6}" class="frame"/><rect x="7" y="7" width="${W - 14}" height="${H - 14}" class="frame thin"/>`);

    const segs = c.map.segments.map(seg => ({ seg, a: P(c.nodesById[seg.from]), b: P(c.nodesById[seg.to]), sv: v.segments[seg.id] }));
    const decided = !!s.routeVariant || !c.map.segments.some(x => x.variant && x.variant !== 'both');

    // Коридоры рельефа: участок делится на доли рельефа, каждая — своя штриховка
    for (const { seg, a, b, sv } of segs) {
      if (decided && !sv.active) continue;
      let t0 = 0;
      for (const [terr, share] of Object.entries(seg.terrain)) {
        const p0 = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0];
        const t1 = t0 + share;
        const p1 = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
        parts.push(`<line x1="${p0[0]}" y1="${p0[1]}" x2="${p1[0]}" y2="${p1[1]}" class="corridor corridor-${terr}" stroke="url(#p-${terr})"/>`);
        t0 = t1;
      }
    }
    // Реки у мостов, знак уклона
    for (const { seg, a, b, sv } of segs) {
      if (decided && !sv.active) continue;
      (seg.features || []).forEach((fid, i) => {
        const f = c.map.features[fid];
        const t = (i + 1) / ((seg.features || []).length + 1);
        const m = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
        const nx = -dy / L, ny = dx / L;
        if (f.kind === 'bridge') {
          const r0 = [m[0] - nx * 18, m[1] - ny * 18], r1 = [m[0] + nx * 18, m[1] + ny * 18];
          parts.push(`<path d="M${r0[0]} ${r0[1]} Q${m[0] + dx / L * 7} ${m[1] + dy / L * 7} ${r1[0]} ${r1[1]}" class="river"/>`);
          const iron = sv.features[fid] === 'iron';
          parts.push(`<path d="M${m[0] - dx / L * 5 + nx * 3} ${m[1] - dy / L * 5 + ny * 3} l${dx / L * 10} ${dy / L * 10} M${m[0] - dx / L * 5 - nx * 3} ${m[1] - dy / L * 5 - ny * 3} l${dx / L * 10} ${dy / L * 10}" class="bridge${iron ? ' iron' : ''}"/>`);
        } else if (f.kind === 'grade') {
          const val = sv.features[fid];
          if (val === 'bypass') {
            parts.push(`<path d="M${m[0] - dx / L * 10} ${m[1] - dy / L * 10} q${nx * 14} ${ny * 14} ${dx / L * 20} ${dy / L * 20}" class="bypass"/>`);
          }
          parts.push(`<path d="M${m[0] + nx * 8 - dx / L * 4} ${m[1] + ny * 8 - dy / L * 4} l${dx / L * 4 + nx * 4} ${dy / L * 4 + ny * 4} l${dx / L * 4 - nx * 4} ${dy / L * 4 - ny * 4}" class="grade-mark"/>`);
        }
      });
    }
    // Трасса
    for (const { seg, a, b, sv } of segs) {
      const L = lineLen(a, b);
      if (!sv.active && decided) continue;
      const alt = !sv.active; // до выбора трассы — вариант, который ещё не выбран
      const sel = S.selected === seg.id;
      if (sv.opened) {
        parts.push(`<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" class="sleepers"/>`);
        const anim = S.animate.has(seg.id) && !reducedMotion;
        parts.push(`<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" class="route-done${anim ? ' draw-in' : ''}"${anim ? ` style="stroke-dasharray:${L};stroke-dashoffset:${L}"` : ''}/>`);
      } else {
        parts.push(`<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" class="${alt ? 'route-alt' : s.unlocked.construction ? 'route-build' : 'route-plan'}"/>`);
        if (sv.progress > 0) {
          const t = sv.progress / 100;
          parts.push(`<line x1="${a[0]}" y1="${a[1]}" x2="${a[0] + (b[0] - a[0]) * t}" y2="${a[1] + (b[1] - a[1]) * t}" class="route-progress"/>`);
        }
      }
      if (sel) parts.push(`<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" class="route-selected"/>`);
      if (sv.crews > 0 && !sv.opened) {
        const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        parts.push(`<g class="crew-badge"><circle cx="${m[0]}" cy="${m[1]}" r="8.5"/><text x="${m[0]}" y="${m[1] + 3.5}" text-anchor="middle">${sv.crews}</text></g>`);
      }
      if (!alt) parts.push(`<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" class="seg-hit" data-seg="${seg.id}"/>`);
    }
    // Станции
    const fs = Math.max(10, Math.min(13, W / 34));
    for (const n of c.map.nodes) {
      if (decided && n.variant && n.variant !== s.routeVariant) continue;
      const [x, y] = P(n);
      if (n.kind === 'capital') parts.push(`<circle cx="${x}" cy="${y}" r="6.5" class="node"/><circle cx="${x}" cy="${y}" r="3" class="node inner"/>`);
      else parts.push(`<circle cx="${x}" cy="${y}" r="${n.kind === 'town' ? 4 : 3}" class="node${n.kind === 'station' ? ' small' : ''}"/>`);
      const right = x < W * 0.62;
      parts.push(`<text x="${x + (right ? 9 : -9)}" y="${y + 4}" text-anchor="${right ? 'start' : 'end'}" class="node-label" font-size="${n.kind === 'station' ? fs - 1 : fs + 1}">${esc(n.name.replace(/\s*\(.+\)/, ''))}</text>`);
    }
    // Картуш
    parts.push(`<g class="cartouche"><rect x="14" y="14" width="${Math.min(W - 28, 230)}" height="36" class="cartouche-box"/>
      <text x="22" y="30" class="cartouche-title" font-size="14">${esc(c.map.title)}</text>
      <text x="22" y="44" class="cartouche-sub" font-size="8.5">ЧЕРТЁЖ ТРАССЫ · ${esc(yearsOf(S.chapter))}</text></g>`);
    svg.innerHTML = parts.join('');
    svg.querySelectorAll('.seg-hit').forEach(el => el.addEventListener('click', () => {
      if (modalOpen()) { closeMap(); return; } // из доклада — только посмотреть
      closeMap();
      S.selected = el.dataset.seg;
      haptic('tap');
      renderPanel();
      $('panel').scrollTop = 0;
      syncTelegramButtons();
    }));
    if (S.animate.size) setTimeout(() => S.animate.clear(), 1800);
  }
  const yearsOf = ch => (CHAPTER_INFO[ch] || {}).years || '';

  function selectSeg(id) {
    haptic('tap');
    S.selected = S.selected === id ? null : id;
    renderPanel(); $('panel').scrollTop = 0; syncTelegramButtons();
  }

  // ---- нижняя панель ----
  function segName(seg) {
    const c = C();
    const clean = n => c.nodesById[n].name.replace(/\s*\(.+\)/, '');
    return `${clean(seg.from)} — ${clean(seg.to)}`;
  }

  function renderPanel() {
    const el = $('panel');
    const s = S.state, v = S.view, c = C();
    if (!s) return;
    if (S.selected) { el.innerHTML = segmentPanel(c.segById[S.selected]); bindSegmentPanel(); return; }

    const parts = [];
    if (!s.unlocked.construction) {
      parts.push(`<div class="hint">Строительство откроется после первых депеш.</div>`);
    } else {
      const unopened = c.map.segments.some(x => v.segments[x.id].active && !v.segments[x.id].opened);
      if (v.freeCrews > 0 && unopened) {
        parts.push(`<div class="report-note bad">Без дела ${v.freeCrews} ${pluralCrews(v.freeCrews)}: жалованье идёт, работа стоит. Выберите участок и добавьте людей.</div>`);
      }
      // Участки по дирекциям
      const groups = {};
      for (const seg of c.map.segments) {
        if (!v.segments[seg.id].active) continue;
        const g = seg.directorate || 'main';
        (groups[g] = groups[g] || []).push(seg);
      }
      const gName = { north: 'Северная дирекция · Мельников', south: 'Южная дирекция · Крафт', main: 'Участки' };
      for (const [g, list] of Object.entries(groups)) {
        const crews = list.reduce((a, x) => a + v.segments[x.id].crews, 0);
        parts.push(`<div class="sect"><div class="sect-title">${gName[g]} · ${crews} ${pluralCrews(crews)}</div>`);
        for (const seg of list) {
          const sv = v.segments[seg.id];
          parts.push(`<button class="seg-row${sv.opened ? ' opened' : ''}" data-seg="${seg.id}" type="button">
            <span>${esc(segName(seg))}${sv.opened ? ' · открыт' : ''}</span>
            <span class="crews">${sv.opened ? '' : sv.crews ? `${sv.crews} арт. · ` : ''}${Math.round(sv.progress)}%</span>
            <span class="bar${sv.opened ? ' done' : ''}"><i style="width:${sv.progress}%"></i></span>
          </button>`);
        }
        parts.push(`</div>`);
      }
      parts.push(crewsSection());
    }
    if (s.unlocked.rollingStock) parts.push(stockSection());
    parts.push(financeSection());
    el.innerHTML = parts.join('');
    el.querySelectorAll('[data-seg]').forEach(b => b.addEventListener('click', () => selectSeg(b.dataset.seg)));
    bindCommon();
  }

  function crewsSection() {
    const s = S.state, v = S.view, b = C().balance;
    const pay = b.crews.pay;
    return `<div class="sect"><div class="sect-title">Артели</div>
      <div class="kv"><span>Всего / свободно</span><span>${s.crewsTotal} / ${v.freeCrews}</span></div>
      <div class="kv"><span>Жалованье за сезон</span><span>${money(v.payPerSeason)}</span></div>
      <div class="stepper">
        <button class="mini" data-hire="1" ${v.hireLeft < 1 ? 'disabled' : ''}>+1</button>
        <button class="mini" data-hire="5" ${v.hireLeft < 5 ? 'disabled' : ''}>+5</button>
        <span class="sub">нанять (${b.crews.hireCostPerCrew} за артель, ещё ${v.hireLeft} в этот сезон)</span>
      </div>
      <div class="stepper">
        <button class="mini" data-dismiss="1" ${v.freeCrews < 1 ? 'disabled' : ''}>−1</button>
        <button class="mini" data-dismiss="5" ${v.freeCrews < 5 ? 'disabled' : ''}>−5</button>
        <span class="sub">распустить свободные</span>
      </div>
      <div class="sect-title" style="margin-top:10px">Оплата</div>
      <div class="opts">${['low', 'normal', 'high'].map(l => `<button class="mini${s.pay === l ? ' on' : ''}" data-pay="${l}">${PAY_RU[l]} · ${pay[l].costPerCrew}</button>`).join('')}</div>
      <div class="hint">Скудная оплата роняет настрой, щедрая — поднимает. От настроя зависит выработка.</div>
    </div>`;
  }

  function stockSection() {
    const s = S.state, v = S.view, b = C().balance;
    const locos = Object.entries(b.train.locomotives).filter(([, l]) => l.chapter === S.chapter);
    const minCar = b.train.minCarriages[S.chapter] || 1;
    const have = Object.entries(s.rollingStock.locomotives).filter(([, n]) => n > 0).map(([id, n]) => `${b.train.locomotives[id].name}: ${n}`).join(', ');
    return `<div class="sect"><div class="sect-title">Подвижной состав</div>
      <div class="kv"><span>Паровозы</span><span>${esc(have || 'нет')}</span></div>
      <div class="kv"><span>Вагоны</span><span>${s.rollingStock.carriages} (нужно ${minCar})</span></div>
      <div class="opts">
        ${locos.map(([id, l]) => `<button class="mini" data-buy="${id}">Паровоз · ${l.cost}</button>`).join('')}
        <button class="mini" data-buy="carriage">Вагон · ${b.train.carriageCost}</button>
      </div>
      ${v.hasRollingStock ? '<div class="hint">Состав для первого рейса готов.</div>' : ''}
    </div>`;
  }

  function financeSection() {
    const s = S.state, v = S.view, b = C().balance, cb = b[S.chapter];
    const pet = cb.petition;
    const dl = v.deadline ? `${SEASON_RU[v.deadline.season].toLowerCase()} ${v.deadline.year}` : null;
    return `<div class="sect"><div class="sect-title">Казна</div>
      <div class="kv"><span>Израсходовано</span><span>${money(v.spentTotal)}</span></div>
      ${cb.yearlyAllocation ? `<div class="kv"><span>Ассигнования каждую весну</span><span>${money(cb.yearlyAllocation)}</span></div>` : ''}
      ${dl ? `<div class="kv"><span>Срок открытия</span><span>${dl}</span></div>` : ''}
      ${pet && s.unlocked.construction ? `<button class="btn ghost" data-petition ${s.petitionCooldown > 0 ? 'disabled' : ''}>Прошение о средствах: +${money(pet.amount)}, благоволение −${pet.favorCost}${s.petitionCooldown > 0 ? ` (через ${s.petitionCooldown} сез.)` : ''}</button>` : ''}
      <button class="link" data-home type="button">В меню</button>
    </div>`;
  }

  function bindCommon() {
    const el = $('panel');
    el.querySelectorAll('[data-hire]').forEach(b => b.addEventListener('click', () => act({ type: 'HIRE_CREWS', amount: +b.dataset.hire }).then(renderGame)));
    el.querySelectorAll('[data-dismiss]').forEach(b => b.addEventListener('click', () => act({ type: 'DISMISS_CREWS', amount: +b.dataset.dismiss }).then(renderGame)));
    el.querySelectorAll('[data-pay]').forEach(b => b.addEventListener('click', () => act({ type: 'SET_PAY', level: b.dataset.pay }).then(renderGame)));
    el.querySelectorAll('[data-buy]').forEach(b => b.addEventListener('click', async () => {
      const r = await act({ type: 'BUY', itemId: b.dataset.buy, qty: 1 });
      renderGame();
      if (r) handleLog(r.log || []);
    }));
    el.querySelectorAll('[data-petition]').forEach(b => b.addEventListener('click', async () => {
      if (!(await confirmBox('Подать прошение о дополнительных средствах? Благоволение уменьшится.'))) return;
      const r = await act({ type: 'PETITION_FUNDS' });
      renderGame();
      if (r) handleLog(r.log || []);
    }));
    el.querySelectorAll('[data-home]').forEach(b => b.addEventListener('click', () => { flushCrews(); openHome(); }));
  }

  function segmentPanel(seg) {
    const s = S.state, sv = S.view.segments[seg.id], c = C();
    const terr = Object.entries(seg.terrain).map(([t, sh]) => `${TERRAIN_RU[t]} ${Math.round(sh * 100)}%`).join(', ');
    const parts = [`<button class="link back" data-back type="button">← все участки</button>
      <h3>${esc(segName(seg))}</h3>
      <div class="sub">${sv.lengthKm} км · ${terr}${seg.directorate ? ` · ${seg.directorate === 'north' ? 'Северная' : 'Южная'} дирекция` : ''}</div>
      <div class="bar${sv.opened ? ' done' : ''}"><i style="width:${sv.progress}%"></i></div>
      <div class="kv"><span>${sv.opened ? 'Участок открыт' : 'Готовность'}</span><span>${Math.round(sv.progress)}%</span></div>`];
    if (!sv.opened) {
      parts.push(`<div class="kv"><span>Осталось работ / денег на материалы</span><span>${Math.round(sv.work - sv.workDone)} / ${money(sv.costLeft)}</span></div>
        <div class="kv"><span>Темп сезона (${SEASON_RU[s.season].toLowerCase()})</span><span>×${sv.seasonMult.toFixed(2)}</span></div>`);
      if (s.unlocked.construction) {
        const perCrew = c.balance.crews.workPerCrewPerSeason * sv.seasonMult * s.morale / 100;
        const next = Math.min(sv.work - sv.workDone, sv.crews * perCrew);
        parts.push(`<div class="sect"><div class="sect-title">Артели на участке (до ${sv.maxCrews})</div>
          <div class="stepper">
            <button class="mini" data-crew="-5">−5</button><button class="mini" data-crew="-1">−1</button>
            <span class="count">${sv.crews}</span>
            <button class="mini" data-crew="1">+1</button><button class="mini" data-crew="5">+5</button>
          </div>
          <div class="hint">${sv.crews ? `За сезон ≈ ${Math.round(next / (sv.work || 1) * 100)}% участка. ` : ''}Свободно ${S.view.freeCrews}.</div></div>`);
      }
    }
    const feats = seg.features || [];
    if (feats.length) {
      parts.push(`<div class="sect"><div class="sect-title">Особенности</div>`);
      for (const fid of feats) {
        const f = c.map.features[fid];
        const val = sv.features[fid];
        const label = { wooden: 'деревянный', iron: 'железный', steep: 'крутой уклон', bypass: 'обход' };
        if (f.event || sv.featureLocked || !s.unlocked.construction) {
          parts.push(`<div class="kv"><span>${esc(f.name)}</span><span>${label[val] || val}${f.event && !s.firedEvents.includes(f.event) ? ' · решится депешей' : ''}</span></div>`);
        } else {
          parts.push(`<div class="kv"><span>${esc(f.name)}</span><span></span></div><div class="opts">${f.options.map(o => {
            const br = c.balance.bridges[o];
            return `<button class="mini${val === o ? ' on' : ''}" data-feat="${fid}" data-val="${o}">${label[o] || o}${br ? ` · ${br.cost}` : ''}</button>`;
          }).join('')}</div><div class="hint">Выбор можно менять, пока участок не готов наполовину.</div>`);
        }
      }
      parts.push(`</div>`);
    }
    const refs = seg.fact_refs || [];
    if (refs.length) parts.push(`<div class="sect"><div class="sect-title">Справка</div>${factsHtml(refs)}</div>`);
    return parts.join('');
  }

  function bindSegmentPanel() {
    const el = $('panel');
    el.querySelector('[data-back]').addEventListener('click', () => selectSeg(S.selected));
    el.querySelectorAll('[data-crew]').forEach(b => b.addEventListener('click', () => {
      const cur = S.view.segments[S.selected].crews;
      setCrewsLocal(S.selected, cur + Number(b.dataset.crew));
    }));
    el.querySelectorAll('[data-feat]').forEach(b => b.addEventListener('click', () =>
      act({ type: 'SET_FEATURE', segmentId: S.selected, feature: b.dataset.feat, value: b.dataset.val }).then(renderGame)));
  }

  // ================= факты =================
  // Версии (to_verify) показываем рядом с фактами, на которые они ссылаются в примечании
  function withVersions(refs) {
    const c = C();
    const out = [...refs];
    for (const f of c.facts) {
      if (f.status === 'to_verify' && !out.includes(f.id) && refs.some(r => (f.note || '').includes(r))) out.push(f.id);
    }
    return out;
  }
  function factBody(f) {
    const tag = f.status === 'to_verify' ? '<span class="tag">версия · уточняется</span> ' : f.status === 'legend' ? '<span class="tag legend">легенда</span> ' : '';
    const src = (f.sources || []).map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>`).join('; ');
    return `${tag}<div class="ft">${esc(f.text)}</div>${src ? `<div class="src">Источник: ${src}</div>` : ''}`;
  }
  function factsHtml(refs, { open = false } = {}) {
    const c = C();
    return withVersions(refs).map(id => {
      const f = c.factsById[id];
      if (!f) return '';
      return `<details class="fact"${open ? ' open' : ''}><summary>${esc(f.title)}${f.date ? `, ${esc(f.date)}` : f.year ? `, ${f.year}` : ''}</summary>${factBody(f)}</details>`;
    }).join('');
  }

  // ================= модальные: доклад и депеши =================
  function openModal(html, bind) {
    $('dispatch').innerHTML = html;
    $('modal').classList.remove('hidden');
    $('dispatch').scrollTop = 0;
    bind && bind($('dispatch'));
    syncTelegramButtons();
  }
  function closeModal() {
    $('modal').classList.add('hidden');
    syncTelegramButtons();
  }

  // Разобрать журнал ответа: доклады сезона, открытия, потом депеши
  function handleLog(log, extra = []) {
    for (const l of log) if (l.kind === 'opened') S.animate.add(l.segment);
    if (S.animate.size) renderMap();
    const season = log.find(l => l.kind === 'season');
    if (season) S.modalQueue.push(() => showReport(season, log));
    const jump = log.find(l => l.kind === 'timeJump');
    if (jump) S.modalQueue.push(() => showTimeJump(jump));
    if (log.some(l => l.kind === 'firstRun')) S.modalQueue.push(() => showFirstRunThenFinal());
    for (const fn of extra) S.modalQueue.push(fn);
    nextModal();
  }

  function nextModal() {
    if (S.modalQueue.length) { const fn = S.modalQueue.shift(); fn(); return; }
    if (S.state && S.state.finished) { showFinished(); return; }
    if (S.state && S.state.pendingEvents.length) { showDispatch(S.state.pendingEvents[0]); return; }
    closeModal();
    renderGame();
  }

  function showReport(r, log) {
    const c = C();
    const lines = [];
    const line = (a, b) => lines.push(`<div class="report-line"><span>${a}</span><span>${b}</span></div>`);
    line('Жалованье артелям', `−${money(r.pay)}`);
    if (r.materials) line('Материалы и работы', `−${money(r.materials)}`);
    if (r.revenue) line('Доход с открытых участков', `+${money(r.revenue)}`);
    if (r.allocation) line('Высочайшие ассигнования', `+${money(r.allocation)}`);
    const prog = Object.entries(r.progress || {});
    const notes = [];
    for (const l of log) {
      if (l.kind === 'opened') notes.push(`<div class="report-note">Открыт участок ${esc(segName(c.segById[l.segment]))}.${l.freed ? ` Освободились ${l.freed} ${pluralCrews(l.freed)} — поставьте их на другие участки, простой тоже оплачивается.` : ''}</div>`);
      if (l.kind === 'unpaid') notes.push(`<div class="report-note bad">Жалованье выплачено не полностью (долг ${money(l.owed)}). Настрой и благоволение упали.</div>`);
      if (l.kind === 'noMoney') notes.push(`<div class="report-note bad">Денег на материалы хватило на ${l.share}% работ.</div>`);
      if (l.kind === 'skipped') notes.push(`<div class="report-note bad">Ревизия: сезон ушёл на бумаги, работы стояли.</div>`);
      if (l.kind === 'behind') notes.push(`<div class="report-note bad">Отстаём от графика: построено ${Math.round(l.actual)}% при ожидаемых ${Math.round(l.expected)}%. Благоволение падает.</div>`);
      if (l.kind === 'late') notes.push(advisorLine('season.late') || `<div class="report-note bad">Срок вышел. Каждый сезон задержки стоит благоволения.</div>`);
      if (l.kind === 'allOpened') notes.push(`<div class="report-note">Вся трасса открыта!${S.state.unlocked.rollingStock && !S.view.hasRollingStock ? ' Нужен подвижной состав для первого поезда.' : ''}</div>`);
    }
    const progHtml = prog.length
      ? `<div class="sect-title" style="margin-top:10px">Работы</div>` + prog.map(([id, w]) => {
        const sv = S.view.segments[id];
        return `<div class="report-line"><span>${esc(segName(c.segById[id]))}</span><span>+${Math.round(w / (sv.work || 1) * 100)}% → ${Math.round(sv.progress)}%</span></div>`;
      }).join('')
      : (S.state.unlocked.construction ? `<div class="report-note">Работы в этом сезоне не велись.</div>` : '');
    openModal(`<div class="kicker">Доклад</div>
      <h2>Итоги ${SEASON_GEN[r.season]} ${r.year} года</h2>
      ${lines.join('')}${progHtml}${notes.join('')}
      ${log.some(l => l.kind === 'opened') ? '<button class="btn ghost" data-map>Показать на карте</button>' : ''}
      <button class="btn" data-next>Далее</button>`, d => {
        d.querySelector('[data-next]').addEventListener('click', () => { haptic('tap'); nextModal(); });
        const m = d.querySelector('[data-map]');
        if (m) m.addEventListener('click', openMap);
      });
  }

  function showTimeJump(j) {
    openModal(`<div class="kicker">Календарь</div>
      <h2>${SEASON_RU[j.season]} ${j.year}</h2>
      <div class="text">Изыскания и проект позади, календарь переведён на начало земляных работ. Распределите артели по участкам и завершите сезон.</div>
      <div class="facts">${factsHtml(['F007'])}</div>
      <button class="btn" data-next>К работам</button>`, d => d.querySelector('[data-next]').addEventListener('click', () => nextModal()));
  }

  function advisorActive(a) {
    if (!a.active_until) return true;
    const order = ['spring', 'summer', 'autumn', 'winter'];
    const now = S.state.year * 4 + order.indexOf(S.state.season);
    return now < a.active_until.year * 4 + order.indexOf(a.active_until.season);
  }
  function advisorLine(key) {
    const c = C();
    const a = c.advisors.find(x => x.lines && x.lines[key] && advisorActive(x));
    return a ? `<div class="advisor"><b>${esc(a.name)}:</b> «${esc(a.lines[key])}»</div>` : '';
  }
  function advisorLines(key) {
    return C().advisors.filter(x => x.lines && x.lines[key] && advisorActive(x))
      .map(a => `<div class="advisor"><b>${esc(a.name)}:</b> «${esc(a.lines[key])}»</div>`).join('');
  }

  function effectHint(eff) {
    const bits = [];
    if (eff.treasury) bits.push(`казна ${eff.treasury > 0 ? '+' : '−'}${money(Math.abs(eff.treasury))}`);
    if (eff.favor) bits.push(`благоволение ${eff.favor > 0 ? '+' : '−'}${Math.abs(eff.favor)}`);
    if (eff.morale) bits.push(`настрой ${eff.morale > 0 ? '+' : '−'}${Math.abs(eff.morale)}`);
    if (eff.addLengthKm) bits.push(`+${eff.addLengthKm.km} км`);
    if (eff.skipSeason) bits.push('сезон без работ');
    return bits.length ? ` <span class="cost">(${bits.join(', ')})</span>` : '';
  }

  const EVENT_ADVISOR_KEY = { E18: 'revision' };

  function showDispatch(evId) {
    const c = C();
    const ev = c.eventsById[evId];
    const s = S.state;
    const kicker = ev.type === 'random' ? 'Депеша · игровое событие' : ev.type === 'decision' ? 'Депеша · решение' : 'Депеша';
    const intro = EVENT_ADVISOR_KEY[ev.id] ? advisorLines(EVENT_ADVISOR_KEY[ev.id]) : '';
    const isLegend = !!ev.legend;
    const choices = ev.choices.map(ch => `<div class="choice">
        <button class="btn${ev.type === 'decision' ? ' ghost' : ''}" data-choice="${ch.id}">${esc(ch.label)}${effectHint(ch.effects || {})}</button>
        ${advisorLines(`${ev.id}.${ch.id}`)}
      </div>`).join('');
    openModal(`<div class="kicker">${kicker} · ${SEASON_RU[s.season].toLowerCase()} ${s.year}</div>
      <h2>${esc(ev.title)}</h2>
      ${isLegend ? '<span class="tag legend">слух · легенда</span>' : ''}
      <div class="text">${esc(ev.text)}</div>
      ${intro}
      ${!isLegend && (ev.fact_refs || []).length ? `<div class="facts">${factsHtml(ev.fact_refs)}</div>` : ''}
      ${choices}`, d => d.querySelectorAll('[data-choice]').forEach(b => b.addEventListener('click', () => choose(ev, b.dataset.choice))));
  }

  async function choose(ev, choiceId) {
    haptic('tap');
    $('dispatch').querySelectorAll('button').forEach(b => { b.disabled = true; });
    const r = await act({ type: 'CHOOSE', eventId: ev.id, choiceId }, { silent: true });
    if (!r) { $('dispatch').querySelectorAll('button').forEach(b => { b.disabled = false; }); return; }
    renderRes(); renderMap(); renderPanel();
    const log = r.log || [];
    // «Как было»: для решений с исторической развязкой и для легенды.
    // У рейса своя сводка со сравнением — отдельная справка не нужна.
    const isRun = ev.choices.some(ch => ch.effects && ch.effects.runFirstTrain);
    const extra = (ev.history || ev.legend) && !isRun ? [() => showHistory(ev, choiceId)] : [];
    handleLog(log, extra);
  }

  function showHistory(ev, choiceId) {
    const h = ev.history || {};
    const hist = h.choiceId ? ev.choices.find(x => x.id === h.choiceId) : null;
    const mine = ev.choices.find(x => x.id === choiceId);
    let verdict = '';
    if (hist && ev.type === 'decision') {
      verdict = hist.id === choiceId
        ? `<div class="mine">Ваше решение совпало с историческим.</div>`
        : `<div class="mine">Вы выбрали «${esc(mine.label)}». Исторически — «${esc(hist.label)}». Посмотрим, к чему это приведёт.</div>`;
    }
    const text = ev.legend ? '' : `<div class="t">${esc(h.text || '')}</div>`;
    openModal(`<div class="kicker">${ev.legend ? 'Легенда и правда' : 'Как было на самом деле'}</div>
      <h2>${esc(ev.title)}</h2>
      <div class="history"><div class="h">${ev.legend ? 'На деле' : 'История'}</div>${text}${verdict}</div>
      <div class="facts">${factsHtml(ev.fact_refs || [], { open: !!ev.legend })}</div>
      <button class="btn" data-next>Далее</button>`, d => d.querySelector('[data-next]').addEventListener('click', () => { haptic('tap'); nextModal(); }));
  }

  // ================= первый поезд и итог =================
  function showFirstRunThenFinal() {
    const run = S.state.firstRun;
    const c = C();
    const legs = run.legs.filter(l => l.segment).map(l => {
      return `<div class="report-line"><span>${esc(c.nodesById[l.to].name.replace(/\s*\(.+\)/, ''))}${l.incident ? ' · происшествие' : ''}</span><span>${hm(l.minutes)}</span></div>`;
    }).join('');
    const extra = run.legs.filter(l => !l.segment && l.incident).length ? `<div class="report-note bad">В пути случилось происшествие — задержка.</div>` : '';
    const diff = run.minutes - run.historicalMinutes;
    openModal(`<div class="kicker">Первый поезд</div>
      <h2>${esc(c.nodesById[c.map.historical.firstRun.from].name.replace(/\s*\(.+\)/, ''))} — ${esc(c.nodesById[c.map.historical.firstRun.to].name)}</h2>
      <div class="bigtime">${hm(run.minutes)}</div>
      <div class="compare">Исторически — ${hm(run.historicalMinutes)}. ${diff === 0 ? 'Ровно как тогда.' : diff < 0 ? `Вы быстрее на ${hm(-diff)}.` : `Вы медленнее на ${hm(diff)}.`} Путь ${run.km} км, стоянок ${run.stops}.</div>
      <div style="margin-top:10px">${legs}</div>${extra}
      <div class="facts">${factsHtml([c.map.historical.firstRun.fact_ref])}</div>
      <button class="btn" data-next>Далее</button>`, d => d.querySelector('[data-next]').addEventListener('click', () => { haptic('tap'); nextModal(); }));
  }

  function showFinished() {
    closeModal();
    renderFinal();
    show('s-final');
    haptic(S.state.outcome === 'won' ? 'ok' : 'bad');
  }

  const SCALE_RU = {
    deadline: ['Сроки', sc => sc.value === 0 ? 'Открыли к сроку' : `Опоздание: ${sc.value} сез.`],
    treasury: ['Казна', sc => `Израсходовано ${money(sc.value)} при плане ${money(sc.plan)}`],
    reliability: ['Надёжность', sc => sc.value ? `Происшествий: ${sc.value}` : 'Без происшествий'],
    speed: ['Скорость', sc => `Первый поезд: ${hm(sc.value)} против ${hm(sc.historical)}`],
    history: ['Как у Мельникова', sc => `Совпало ключевых решений: ${sc.value} из ${sc.of}`],
  };
  const starsHtml = n => `<span class="stars">${'★'.repeat(n)}<span class="off">${'★'.repeat(5 - n)}</span></span>`;

  function renderFinal() {
    const s = S.state, c = C();
    const el = $('s-final');
    // Финал главы после пролога — сразу «как было», без ожидания модалок
    if (s.outcome !== 'won') {
      const why = s.outcome === 'removed'
        ? 'Благоволение исчерпано. Высочайшим повелением вы отстранены от руководства работами.'
        : 'Сроки вышли окончательно. Работы передают другому начальнику.';
      el.innerHTML = `<h2 class="sheet-title">${esc(c.map.title)}</h2>
        <div class="history"><div class="h">Глава проиграна</div><div class="t">${why}</div></div>
        <p style="margin-top:12px">Построено ${Math.round(S.view.overallProgress)}% трассы, ${SEASON_RU[s.season].toLowerCase()} ${s.year}.</p>
        <button class="btn route" data-restart>Начать главу заново</button>
        <button class="btn ghost" data-home>В меню</button>`;
    } else {
      const sc = s.score;
      const scales = sc.scales.map(x => `<div class="scale"><span>${SCALE_RU[x.id][0]}</span>${starsHtml(x.stars)}<span class="sd">${esc(SCALE_RU[x.id][1](x))}</span></div>`).join('');
      el.innerHTML = `<h2 class="sheet-title">${esc(c.map.title)}: глава пройдена</h2>
        <div class="kv"><span>Итог</span><span>${sc.total} из ${sc.max} ★</span></div>
        ${scales}
        <h3 class="sheet-title" style="font-size:21px;margin-top:18px">Как было на самом деле</h3>
        ${comparisonHtml()}
        ${epilogueHtml()}
        ${S.chapter === 'prologue'
          ? '<button class="btn route" data-next-chapter>К главе I: Петербург — Москва</button>'
          : `<button class="btn route" data-quiz>${S.quiz && S.quiz.done ? 'Итоги викторины' : 'Викторина главы'}</button>`}
        <button class="btn ghost" data-museum>Музей</button>
        <button class="btn ghost" data-home>В меню</button>`;
    }
    el.querySelectorAll('[data-home]').forEach(b => b.addEventListener('click', openHome));
    el.querySelectorAll('[data-restart]').forEach(b => b.addEventListener('click', () => startChapter(S.chapter)));
    el.querySelectorAll('[data-quiz]').forEach(b => b.addEventListener('click', openQuiz));
    el.querySelectorAll('[data-museum]').forEach(b => b.addEventListener('click', openMuseum));
    el.querySelectorAll('[data-next-chapter]').forEach(b => b.addEventListener('click', () => startChapter('chapter1')));
  }

  function comparisonHtml() {
    const s = S.state, c = C();
    const rows = s.decisionsLog.filter(d => d.historicalChoiceId).map(d => {
      const ev = c.eventsById[d.eventId];
      const mine = ev.choices.find(x => x.id === d.choiceId);
      const hist = ev.choices.find(x => x.id === d.historicalChoiceId);
      const same = d.choiceId === d.historicalChoiceId;
      return `<div class="cmp-row"><div class="q">${esc(ev.title)}</div>
        <div class="you${same ? ' match' : ''}">Вы: ${esc(mine.label)}</div>
        <div class="real">Было: ${esc(hist.label)}</div>
        <div class="q" style="font-size:14px">${esc(ev.history.text)}</div></div>`;
    }).join('');
    return rows || '<p>Ключевых решений в этой главе не было.</p>';
  }

  function epilogueHtml() {
    const c = C();
    const last = c.events.filter(e => S.state.firedEvents.includes(e.id) && e.choices.some(ch => ch.effects && ch.effects.unlock === 'quiz'))[0];
    if (!last) return '';
    return `<div class="history" style="margin-top:14px"><div class="h">${esc(last.title)}</div><div class="t">${esc(last.text)}</div></div>
      <div class="facts">${factsHtml(last.fact_refs || [])}</div>`;
  }

  // ================= викторина =================
  let quizIdx = 0;
  async function openQuiz() {
    haptic('tap');
    await withBusy(async () => {
      S.quiz = await api('POST', '/quiz/start');
      quizIdx = S.quiz.questions.findIndex(q => q.answered === null);
      if (quizIdx < 0) quizIdx = S.quiz.questions.length;
      renderQuiz();
      show('s-quiz');
    });
  }
  function renderQuiz(last) {
    const el = $('s-quiz');
    const qz = S.quiz;
    if (quizIdx >= qz.questions.length) {
      el.innerHTML = `<h2 class="sheet-title">Викторина</h2>
        <div class="bigtime">${qz.score} из ${qz.questions.length}</div>
        <p>Верные ответы открыли карточки в «Музее».</p>
        <button class="btn route" data-museum>Открыть «Музей»</button>
        <button class="btn ghost" data-final>К итогам главы</button>`;
      el.querySelector('[data-museum]').addEventListener('click', openMuseum);
      el.querySelector('[data-final]').addEventListener('click', () => { renderFinal(); show('s-final'); });
      return;
    }
    const q = qz.questions[quizIdx];
    const answered = q.answered !== null;
    el.innerHTML = `<div class="kicker" style="font-size:11px;letter-spacing:3px;color:var(--ink-faded)">ВОПРОС ${quizIdx + 1} ИЗ ${qz.questions.length}</div>
      <div class="quiz-q">${esc(q.question)}</div>
      ${q.options.map((o, i) => {
        let cls = '';
        if (answered) cls = i === q.correct ? ' right' : i === q.answered ? ' wrong' : '';
        return `<button class="btn quiz-opt${cls}" data-opt="${i}" ${answered ? 'disabled' : ''}>${esc(o)}</button>`;
      }).join('')}
      ${answered ? `<div class="facts">${factsHtml([q.factId], { open: true })}</div><button class="btn" data-next>${quizIdx + 1 < qz.questions.length ? 'Следующий вопрос' : 'Итог'}</button>` : ''}`;
    el.querySelectorAll('[data-opt]').forEach(b => b.addEventListener('click', () => answerQuiz(q.id, +b.dataset.opt)));
    const nx = el.querySelector('[data-next]');
    if (nx) nx.addEventListener('click', () => { quizIdx++; renderQuiz(); el.scrollTop = 0; });
  }
  async function answerQuiz(qid, option) {
    await withBusy(async () => {
      const r = await api('POST', '/quiz/answer', { questionId: qid, option });
      S.quiz = r;
      haptic(r.last.correct ? 'ok' : 'bad');
      renderQuiz();
    });
  }

  // ================= музей =================
  async function openMuseum() {
    haptic('tap');
    await withBusy(async () => {
      const r = await api('GET', '/museum');
      const el = $('s-museum');
      el.innerHTML = `<h2 class="sheet-title">Музей</h2>
        <p>Карточки фактов, открытые верными ответами в викторинах: ${r.facts.length} из ${r.total}.</p>
        ${r.facts.length ? r.facts.map(f => `<div class="fact-card"><h4>${esc(f.title)}${f.date ? `, ${esc(f.date)}` : f.year ? `, ${f.year}` : ''}</h4>${factBody(f)}</div>`).join('') : '<p class="hint">Пока пусто. Пройдите главу и ответьте на вопросы викторины.</p>'}
        <button class="btn ghost" data-back>Назад</button>`;
      el.querySelector('[data-back]').addEventListener('click', goBack);
      show('s-museum');
    });
  }

  // ================= прочее =================
  $('btn-museum').addEventListener('click', openMuseum);
  $('btn-about').addEventListener('click', () => { haptic('tap'); show('s-about'); });
  $('btn-about-back').addEventListener('click', () => openHome());
  window.addEventListener('resize', () => { if (mapOpen()) renderMap(); });

  // ================= старт =================
  (async function boot() {
    try {
      if (!initData && location.hash.startsWith('#dev')) {
        const u = (location.hash.match(/user=(\d+)/) || [])[1] || '1';
        const r = await fetch(`dev-init?user=${u}`);
        if (r.ok) initData = await r.text();
      }
      if (!initData) throw Object.assign(new Error('Откройте игру из Telegram: команда /koleya у бота.'), { status: 401 });
      await openHome();
      const active = S.home && S.home.player && S.home.player.activeChapter;
      const sv = active && S.home.saves[active];
      if (sv && !sv.finished) await resumeChapter(active);
    } catch (err) {
      $('home-note').textContent = err.message;
      $('chapters').innerHTML = '';
    } finally {
      $('loading').classList.add('hidden');
    }
  })();
})();
