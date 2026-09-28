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
    try { if (tg.disableVerticalSwipes) tg.disableVerticalSwipes(); } catch (_) {}
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
      else if (k === 'sel') tg.HapticFeedback.selectionChanged();
      else tg.HapticFeedback.impactOccurred('light');
    } catch (_) {}
  };
  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ================= украшения (гравюра и казённая бумага) =================
  // Цвета — только классы, которые красятся токенами темы в style.css.
  // ================= эпоха и её словарь =================
  // В главах советской эпохи интерфейс говорит языком своего времени: артели — бригады,
  // благоволение — доверие министерства и т. д. Замены того же рода, чтобы не ломать согласование.
  const SOVIET_ERAS = new Set(['constructivist', 'techbook']);
  function isSovietEra() { return SOVIET_ERAS.has(document.documentElement.getAttribute('data-era')); }
  const LEX_SOVIET = (() => {
    const forms = (from, to) => from.map((f, i) => [f, to[i]]);
    const pairs = [
      ['Высочайшее благоволение', 'Доверие министерства'],
      ['Высочайшим повелением вы отстранены от руководства работами', 'Приказом министерства вы сняты с руководства стройкой'],
      ['Канцелярия строительства', 'Штаб стройки'],
      ['Прошение о средствах', 'Ходатайство о финансировании'],
      ['Жалованье выплачено не полностью', 'Зарплата выплачена не полностью'],
      ['за артель', 'за бригаду'],
      ['арт.', 'бр.'],
      ...forms(['артелями', 'артелям', 'артелях', 'артелей', 'артелью', 'артели', 'артель'], ['бригадами', 'бригадам', 'бригадах', 'бригад', 'бригадой', 'бригады', 'бригада']),
      ...forms(['благоволением', 'благоволению', 'благоволении', 'благоволения', 'благоволение'], ['доверием', 'доверию', 'доверии', 'доверия', 'доверие']),
      ...forms(['депешами', 'депешам', 'депешах', 'депешей', 'депешу', 'депеше', 'депеши', 'депеш', 'депеша'], ['телеграммами', 'телеграммам', 'телеграммах', 'телеграммой', 'телеграмму', 'телеграмме', 'телеграммы', 'телеграмм', 'телеграмма']),
      ...forms(['прошениями', 'прошениям', 'прошениях', 'прошением', 'прошению', 'прошений', 'прошения', 'прошение'], ['ходатайствами', 'ходатайствам', 'ходатайствах', 'ходатайством', 'ходатайству', 'ходатайств', 'ходатайства', 'ходатайство']),
      ...forms(['ревизией', 'ревизию', 'ревизии', 'ревизия'], ['проверкой', 'проверку', 'проверки', 'проверка']),
      ...forms(['казной', 'казну', 'казне', 'казны', 'казна'], ['кассой', 'кассу', 'кассе', 'кассы', 'касса']),
      ...forms(['жалованьем', 'жалованью', 'жалованья', 'жалованье'], ['заработком', 'заработку', 'заработка', 'заработок']),
    ];
    const cap = w => w[0].toUpperCase() + w.slice(1);
    const all = [];
    for (const [a, b] of pairs) { all.push([a, b]); if (a[0] !== a[0].toUpperCase()) all.push([cap(a), cap(b)]); }
    // Длинные формы раньше коротких; только целые слова
    all.sort((x, y) => y[0].length - x[0].length);
    const map = new Map(all);
    const esc = w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(^|[^а-яё])(${all.map(x => esc(x[0])).join('|')})(?=$|[^а-яё])`, 'g');
    return str => str.replace(re, (m, pre, w) => pre + map.get(w));
  })();
  function lexify(root) {
    if (!root || !isSovietEra()) return;
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const t = LEX_SOVIET(n.nodeValue);
      if (t !== n.nodeValue) n.nodeValue = t;
    }
  }
  // Всё, что отрисовывается в советской главе, проходит через словарь
  new MutationObserver(recs => {
    if (!isSovietEra()) return;
    for (const r of recs) {
      if (r.type === 'characterData') { const t = LEX_SOVIET(r.target.nodeValue); if (t !== r.target.nodeValue) r.target.nodeValue = t; }
      else r.addedNodes.forEach(n => n.nodeType === 3 ? (n.nodeValue = LEX_SOVIET(n.nodeValue)) : lexify(n));
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true });

  const DECOR = {
    // Тепловоз для глав советской эпохи: кузов-капот, кабина, двухосные тележки
    diesel() {
      const wheel = (cx, cls) => `<g class="wheel ${cls}"><circle cx="${cx}" cy="73" r="7" class="d-paper"/>${Array.from({ length: 6 }, (_, i) => {
        const a = Math.PI * i / 3;
        return `<line x1="${cx}" y1="73" x2="${(cx + Math.cos(a) * 7).toFixed(1)}" y2="${(73 + Math.sin(a) * 7).toFixed(1)}"/>`;
      }).join('')}<circle cx="${cx}" cy="73" r="1.6" class="d-fill"/></g>`;
      const sleepers = Array.from({ length: 27 }, (_, i) => `<line x1="${-14 + i * 9.4}" y1="82" x2="${-10 + i * 9.4}" y2="86"/>`).join('');
      return `<svg class="deco-loco deco-diesel" viewBox="0 0 220 90" aria-hidden="true">
        <g class="d-smoke"><circle class="puff p1" cx="96" cy="26" r="4"/><circle class="puff p2" cx="96" cy="26" r="4"/><circle class="puff p3" cx="96" cy="26" r="4"/><circle class="puff p4" cx="96" cy="26" r="4"/></g>
        <g class="d-ink">
          <g class="d-body">
            <path d="M14 64 V40 L26 30 H194 L206 40 V64 Z" class="d-paper"/>
            <path d="M14 52 H206" class="d-stripe"/>
            <rect x="30" y="35" width="16" height="10" class="d-fill"/><rect x="174" y="35" width="16" height="10" class="d-fill"/>
            ${Array.from({ length: 9 }, (_, i) => `<rect x="${58 + i * 12}" y="36" width="8" height="12" class="d-paper"/>`).join('')}
            <rect x="92" y="26" width="10" height="4" class="d-fill"/>
            <line x1="8" y1="66" x2="212" y2="66"/>
          </g>
          ${wheel(34, 'small')}${wheel(54, 'small')}${wheel(166, 'small')}${wheel(186, 'small')}
          <line x1="0" y1="81" x2="220" y2="81"/>
          <g class="d-thin d-sleepers">${sleepers}</g>
        </g>
      </svg>`;
    },
    // Скоростной электропоезд конца 1980-х: клиновидная кабина, пантограф, лента окон
    emu() {
      const wheel = cx => `<g class="wheel small"><circle cx="${cx}" cy="74" r="5" class="d-paper"/>${Array.from({ length: 4 }, (_, i) => {
        const a = Math.PI * i / 2;
        return `<line x1="${cx}" y1="74" x2="${(cx + Math.cos(a) * 5).toFixed(1)}" y2="${(74 + Math.sin(a) * 5).toFixed(1)}"/>`;
      }).join('')}</g>`;
      const sleepers = Array.from({ length: 27 }, (_, i) => `<line x1="${-14 + i * 9.4}" y1="82" x2="${-10 + i * 9.4}" y2="86"/>`).join('');
      return `<svg class="deco-loco deco-emu" viewBox="0 0 220 90" aria-hidden="true">
        <g class="d-ink">
          <path d="M100 30 l8 -12 l10 12 M104 24 h10" class="d-thin"/>
          <g class="d-body">
            <path d="M4 68 V40 q0 -8 8 -8 H160 q34 0 52 30 V68 Z" class="d-paper"/>
            <path d="M4 56 H206" class="d-stripe"/>
            ${Array.from({ length: 11 }, (_, i) => `<rect x="${14 + i * 13}" y="40" width="9" height="9" class="d-paper"/>`).join('')}
            <path d="M172 40 q16 2 26 16 H172 Z" class="d-fill"/>
            <line x1="0" y1="70" x2="214" y2="70"/>
          </g>
          ${wheel(24)}${wheel(40)}${wheel(170)}${wheel(186)}
          <line x1="0" y1="81" x2="220" y2="81"/>
          <g class="d-thin d-sleepers">${sleepers}</g>
        </g>
      </svg>`;
    },
    // Виньетка: ранний паровоз с тендером, штриховка котла, клубы дыма
    loco() {
      if (document.documentElement.getAttribute('data-era') === 'techbook') return DECOR.emu();
      if (isSovietEra()) return DECOR.diesel();
      const hatch = Array.from({ length: 11 }, (_, i) => `<line x1="${26 + i * 7}" y1="42" x2="${26 + i * 7}" y2="58"/>`).join('');
      const wheel = (cx, cy, r, n, cls) => `<g class="wheel ${cls}"><circle cx="${cx}" cy="${cy}" r="${r}" class="d-paper"/>${Array.from({ length: n }, (_, i) => {
        const a = Math.PI * 2 * i / n;
        return `<line x1="${cx}" y1="${cy}" x2="${(cx + Math.cos(a) * r).toFixed(1)}" y2="${(cy + Math.sin(a) * r).toFixed(1)}"/>`;
      }).join('')}<circle cx="${cx}" cy="${cy}" r="${r > 10 ? 2.5 : 1.6}" class="d-fill"/></g>`;
      // Шпалы с запасом по краям — лента сдвигается на один шаг и повторяется
      const sleepers = Array.from({ length: 27 }, (_, i) => `<line x1="${-14 + i * 9.4}" y1="82" x2="${-10 + i * 9.4}" y2="86"/>`).join('');
      return `<svg class="deco-loco" viewBox="0 0 220 90" aria-hidden="true">
        <g class="d-smoke"><circle class="puff p1" cx="30" cy="15" r="5"/><circle class="puff p2" cx="30" cy="15" r="5"/><circle class="puff p3" cx="30" cy="15" r="5"/><circle class="puff p4" cx="30" cy="15" r="5"/></g>
        <g class="d-ink">
          <g class="d-body">
            <path d="M22 18 L38 18 L34 30 L26 30 Z" class="d-fill"/>
            <rect x="27" y="30" width="6" height="11"/>
            <rect x="18" y="41" width="80" height="18" rx="9" class="d-paper"/>
            <g class="d-hatch">${hatch}</g>
            <path d="M56 41 a6 6 0 0 1 12 0" class="d-fill"/>
            <path d="M96 27 L128 27 M100 27 L100 62 M124 27 L124 62"/>
            <rect x="104" y="33" width="14" height="10" class="d-paper"/>
            <line x1="12" y1="62" x2="130" y2="62"/>
            <rect x="10" y="57" width="8" height="7" class="d-fill"/>
            <line x1="130" y1="62" x2="138" y2="62"/>
            <rect x="138" y="44" width="54" height="20" class="d-paper"/>
            <path d="M142 44 L142 38 L188 38 L188 44"/>
            <g class="d-hatch">${Array.from({ length: 8 }, (_, i) => `<line x1="${144 + i * 6}" y1="47" x2="${144 + i * 6}" y2="61"/>`).join('')}</g>
          </g>
          ${wheel(78, 69, 13, 10, 'big')}
          ${wheel(34, 73, 8, 8, 'small')}${wheel(114, 73, 8, 8, 'small')}
          ${wheel(152, 73, 8, 8, 'small')}${wheel(178, 73, 8, 8, 'small')}
          <line x1="34" y1="73" x2="114" y2="73" class="d-rod"/>
          <line x1="0" y1="81" x2="220" y2="81"/>
          <g class="d-thin d-sleepers">${sleepers}</g>
        </g>
      </svg>`;
    },
    // Сургучная печать с колесом и номером; в советской эпохе — красная звезда-штамп
    seal(label) {
      if (isSovietEra()) {
        const pts = Array.from({ length: 10 }, (_, i) => {
          const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 9 : 21;
          return `${(30 + Math.cos(a) * r).toFixed(1)},${(30 + Math.sin(a) * r).toFixed(1)}`;
        }).join(' ');
        return `<svg class="deco-seal deco-star" viewBox="0 0 60 60" aria-hidden="true">
          <circle cx="30" cy="30" r="27" class="st-ring"/><polygon points="${pts}" class="st-star"/>
          ${label ? `<text x="30" y="57" text-anchor="middle" class="s-text">${label}</text>` : ''}
        </svg>`;
      }
      const spokes = Array.from({ length: 8 }, (_, i) => {
        const a = Math.PI * 2 * i / 8;
        return `<line x1="30" y1="30" x2="${(30 + Math.cos(a) * 11).toFixed(1)}" y2="${(30 + Math.sin(a) * 11).toFixed(1)}"/>`;
      }).join('');
      return `<svg class="deco-seal" viewBox="0 0 60 60" aria-hidden="true">
        <circle cx="30" cy="30" r="25" class="s-wax"/>
        <circle cx="30" cy="30" r="26" class="s-edge"/>
        <circle cx="30" cy="30" r="19" class="s-ring"/>
        <g class="s-mark"><circle cx="30" cy="30" r="11"/>${spokes}<circle cx="30" cy="30" r="2.5" class="s-hub"/></g>
        ${label ? `<text x="30" y="55.5" text-anchor="middle" class="s-text">${label}</text>` : ''}
      </svg>`;
    },
    // Орнаментальная линейка с виньеткой посередине
    // Строка подписи с росчерком пера
    signature(left, right) {
      return `<div class="signature"><span>${left}</span><i><svg viewBox="0 0 80 16" preserveAspectRatio="none" aria-hidden="true"><path d="M2 12 C10 2, 16 14, 24 7 S36 3, 40 10 S52 15, 58 6 S70 2, 78 9"/></svg></i><span>${right}</span></div>`;
    },
    rule(glyph = '❦') { return `<div class="orn" aria-hidden="true"><span>${glyph}</span></div>`; },
    // Роза ветров для карты-чертежа
    rose(x, y, r, deg = 0) {
      const pt = (a, len) => [(x + Math.sin(a) * len).toFixed(1), (y - Math.cos(a) * len).toFixed(1)];
      const ray = (a, len, w, cls) => {
        const [tx, ty] = pt(a, len), [lx, ly] = pt(a - Math.PI / 2, w), [rx, ry] = pt(a + Math.PI / 2, w);
        return `<path d="M${tx} ${ty} L${lx} ${ly} L${x} ${y} Z" class="${cls}"/><path d="M${tx} ${ty} L${rx} ${ry} L${x} ${y} Z" class="${cls}-dark"/>`;
      };
      let g = `<circle cx="${x}" cy="${y}" r="${r * 0.62}" class="rose-ring"/>`;
      for (let i = 0; i < 4; i++) g += ray(Math.PI / 4 + i * Math.PI / 2, r * 0.6, r * 0.12, 'rose-ray-s');
      for (let i = 0; i < 4; i++) g += ray(i * Math.PI / 2, r, r * 0.18, i === 0 ? 'rose-ray-n' : 'rose-ray');
      const [nx, ny] = pt(0, r + 8);
      return `<g class="rose" transform="rotate(${deg.toFixed(1)} ${x} ${y})">${g}<text x="${nx}" y="${ny}" text-anchor="middle" class="rose-n">С</text></g>`;
    },
  };
  const SEASON_GLYPH = { spring: '❀', summer: '☼', autumn: '❧', winter: '❄' };
  $('title-vignette').innerHTML = DECOR.loco();
  $('title-vignette').querySelector('svg').classList.add('anim');
  $('loading-vignette').innerHTML = DECOR.loco();
  $('loading-vignette').querySelector('svg').classList.add('anim');

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
  const TERRAIN_RU = { plain: 'равнина', forest: 'лес', swamp: 'болото', hills: 'холмы', steppe: 'степь', taiga: 'тайга', mountains: 'горы', permafrost: 'мерзлота' };
  const PAY_RU = { low: 'скудно', normal: 'как положено', high: 'щедро' };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = v => `${Math.round(v).toLocaleString('ru-RU')}`;
  const hm = min => {
    const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = Math.round(min % 60);
    if (d) return `${d} сут ${h} ч`;
    return h ? `${h} ч ${m} мин` : `${m} мин`;
  };
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
    animate: new Set(),
    zoom: { k: 1, x: 0, y: 0 }, // масштаб карты-чертежа   // только что открытые участки — дочертить
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
      // Подложка «фанерная карта»: регионы того времени, озёра, реки (miniapp/basemap/*.json)
      c.basemap = await fetch(`basemap/${chapter}.json`).then(r => (r.ok ? r.json() : null)).catch(() => null);
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
    S.zoom = { k: 1, x: 0, y: 0 };
    renderMap();
    syncTelegramButtons();
  }
  function closeMap() {
    $('map-sheet').classList.add('hidden');
    syncTelegramButtons();
  }

  function syncTelegramButtons() {
    const inGame = S.screen === 's-game' && S.state && !S.state.finished;
    const canEnd = inGame && !modalOpen() && !mapOpen() && !S.state.pendingEvents.length && !tutBlocksEnd();
    coachUpdate();
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
  $('btn-zoom-in').addEventListener('click', () => zoomBy(1.6));
  $('btn-zoom-out').addEventListener('click', () => zoomBy(1 / 1.6));
  $('btn-zoom-fit').addEventListener('click', () => { haptic('sel'); S.zoom = { k: 1, x: 0, y: 0 }; renderMap(); });

  function goBack() {
    haptic('tap');
    if (mapOpen()) { closeMap(); return; }
    if (modalOpen()) return; // депешу надо решить, доклад — закрыть кнопкой
    if (S.screen === 's-game' && S.selected) { S.selected = null; renderPanel(); syncTelegramButtons(); return; }
    if (S.screen === 's-quiz' || S.screen === 's-museum') { if (S.state && S.state.finished && S.screen === 's-quiz') { renderFinal(); show('s-final'); } else openHome(); return; }
    openHome();
  }

  // ================= наставник пролога =================
  // Пролог — обязательное обучение. Шаг — это условие показа, условие выполнения,
  // подсвечиваемый элемент и (иногда) запрет завершать сезон, пока шаг не сделан.
  const TUT_KEY = 'koleya-tutorial';
  const TUT = (() => { try { return JSON.parse(localStorage.getItem(TUT_KEY)) || { step: 0, off: false, acked: {} }; } catch (_) { return { step: 0, off: false, acked: {} }; } })();
  function tutSave() { try { localStorage.setItem(TUT_KEY, JSON.stringify(TUT)); } catch (_) {} }
  function tutReset() { TUT.step = 0; TUT.off = false; TUT.acked = {}; tutSave(); }
  // Вернуть выключенные подсказки: тур продолжится с шага, который соответствует стройке,
  // уже сделанные шаги (найм, расстановка) пропустятся сами
  function tutRestore() {
    TUT.off = false; tutSave();
    haptic('ok');
    toast('Подсказки обучения включены');
    if (S.screen === 's-game') { renderPanel(); syncTelegramButtons(); }
    renderAboutTut();
  }
  function renderAboutTut() {
    const el = $('about-tut');
    if (el) el.classList.toggle('hidden', !TUT.off);
  }

  function tutSteps() {
    const b = C().balance, cr = b.crews, cb = b[S.chapter];
    const pay = cr.pay.normal.costPerCrew;
    const seg = id => S.state.segments[id];
    const anyOpened = s => Object.values(s.segments).some(x => x.opened);
    return [
      { id: 'dispatch', onModal: true, show: s => s.pendingEvents.includes('P01'), done: s => s.firedEvents.includes('P01'),
        title: 'Добро пожаловать, главный инженер',
        text: 'Это обучение на первой русской железной дороге — Царскосельской. Я проведу вас по шагам. Сначала депеша: так приходят события и решения. Прочтите её и нажмите кнопку под текстом.' },
      { id: 'resources', ack: true, target: () => $('resbar'),
        title: 'Ваши ресурсы',
        text: 'Казна — деньги на жалованье и материалы. Благоволение — доверие начальства: кончится — отставка. Настрой — от него зависит скорость работ. Нажмите на любой показатель, чтобы увидеть точные числа.' },
      { id: 'calendar', ack: true, target: () => $('calendar'),
        title: 'Календарь',
        text: `Одна клетка — один сезон. Один ход игры — тоже сезон. У пролога нет срока, но сезонов всего ${cb.maxTurns}: если не успеть, работы передадут другому.` },
      { id: 'hire', blockEnd: true, target: () => $('panel').querySelector('.crewbar [data-hire]:last-of-type'),
        done: s => s.crewsTotal >= cb.startCrews + 5 || s.turn > 0,
        title: 'Наймите людей',
        text: `Строят артели — бригады рабочих. Сейчас их ${cb.startCrews}, этого мало. Нажмите «+5»: найм стоит ${cr.hireCostPerCrew} за артель, а потом каждый сезон жалованье — ${pay} за артель.` },
      { id: 'assign', blockEnd: true, target: () => $('panel').querySelector('[data-slider="spb_tsarskoye"]'),
        done: s => seg('spb_tsarskoye').crews >= 5 || seg('spb_tsarskoye').opened || s.turn > 0,
        title: 'Поставьте людей на участок',
        text: 'Потяните бегунок у участка «Петербург — Царское Село» вправо. Чем больше артелей, тем быстрее стройка: справа видно, сколько процентов участка сделают за сезон.' },
      { id: 'second', blockEnd: true, target: () => $('panel').querySelector('[data-slider="tsarskoye_pavlovsk"]'),
        done: (s, v) => v.freeCrews === 0 || seg('tsarskoye_pavlovsk').crews > 0 || s.turn > 0,
        title: 'Второй участок',
        text: 'Короткий участок до Павловска можно строить одновременно с главным. Поставьте на него оставшихся людей: свободная артель получает жалованье, но ничего не строит.' },
      { id: 'endSeason', target: () => $('btn-season'), done: s => s.turn >= 1,
        title: 'Завершите сезон',
        text: 'Всё готово. Нажмите «Завершить сезон» внизу экрана: артели поработают, казна заплатит жалованье и за материалы, и придёт доклад.' },
      { id: 'report', ack: true, show: s => s.turn >= 1, target: () => $('panel').querySelector('.scheme'),
        title: 'Что произошло за сезон',
        text: 'Доклад показал расходы и сколько сделано. Красная заливка на схеме — готовность участка, светлая полоска — прогноз на следующий сезон. Зимой и весной работы идут медленнее.' },
      { id: 'rhythm', ack: true, show: s => s.turn >= 1,
        title: 'Дальше — сами',
        text: 'Завершайте сезоны и следите: хватает ли казны, не падает ли настрой. Если настрой проседает — поднимите оплату в разделе «Оплата артелей» ниже. Когда участок откроется, придёт депеша.' },
      { id: 'opened', ack: true, show: s => anyOpened(s), target: () => $('panel').querySelector('.crewbar'),
        title: 'Участок открыт',
        text: 'Его артели освободились. Поставьте их бегунком на другой участок или распустите кнопкой «−»: иначе вы платите им зря.' },
      { id: 'stock', show: s => s.unlocked.rollingStock, done: (s, v) => v.hasRollingStock, target: () => $('panel').querySelector('[data-buy]'),
        title: 'Паровоз и вагон',
        text: 'Для первого рейса нужен паровоз и хотя бы один вагон. Купите их в разделе «Подвижной состав» ниже. Когда трасса будет готова, поезд можно будет отправить.' },
      { id: 'run', onModal: true, show: s => s.pendingEvents.includes('P03'), done: s => s.finished,
        title: 'Первый рейс',
        text: 'Всё готово. Отправьте поезд: игра посчитает время в пути и сравнит его с историческим. Потом — итог главы.' },
    ];
  }
  function tutActive() { return S.chapter === 'prologue' && S.state && !S.state.finished && !TUT.off && S.screen === 's-game'; }
  function tutCurrent() {
    if (!tutActive()) return null;
    const steps = tutSteps();
    const s = S.state, v = S.view;
    // Пропускаем выполненные шаги, в том числе сделанные раньше подсказки
    while (TUT.step < steps.length) {
      const st = steps[TUT.step];
      const finished = st.ack ? TUT.acked[st.id] : (st.done ? st.done(s, v) : false);
      if (!finished) break;
      TUT.step++; tutSave();
    }
    if (TUT.step >= steps.length) return null;
    return { st: steps[TUT.step], n: TUT.step + 1, total: steps.length };
  }
  function tutBlocksEnd() {
    const cur = tutCurrent();
    return !!(cur && cur.st.blockEnd && (!cur.st.show || cur.st.show(S.state, S.view)));
  }
  let tutScrolled = null;
  function coachUpdate() {
    const el = $('coach');
    document.querySelectorAll('.coach-hl').forEach(x => x.classList.remove('coach-hl'));
    const cur = tutCurrent();
    const visible = cur && (!cur.st.show || cur.st.show(S.state, S.view)) && (cur.st.onModal ? modalOpen() : !modalOpen()) && !mapOpen();
    el.classList.toggle('hidden', !visible);
    document.body.classList.toggle('coach-on', !!visible);
    if (!visible) return;
    const st = cur.st;
    el.classList.toggle('top', !!st.onModal);
    el.innerHTML = `<div class="coach-kicker">Обучение · шаг ${cur.n} из ${cur.total}</div>
      <div class="coach-title">${esc(st.title)}</div>
      <div class="coach-text">${esc(st.text)}</div>
      <div class="coach-row">
        ${st.ack ? '<button class="btn coach-ok" type="button" data-coach-ok>Понятно</button>' : '<span class="coach-wait">сделайте это, и подсказка сменится</span>'}
        <button class="link coach-off" type="button" data-coach-off>выключить подсказки</button>
      </div>`;
    const ok = el.querySelector('[data-coach-ok]');
    if (ok) ok.addEventListener('click', () => { haptic('tap'); TUT.acked[st.id] = true; tutSave(); coachUpdate(); syncTelegramButtons(); });
    el.querySelector('[data-coach-off]').addEventListener('click', async () => {
      if (!(await confirmBox('Выключить подсказки обучения? Их можно вернуть, начав пролог заново.'))) return;
      TUT.off = true; tutSave();
      renderPanel(); // на панели появится «Вернуть подсказки обучения»
      toast('Подсказки выключены. Вернуть — кнопкой внизу панели или в «Об игре».');
    });
    const target = st.target && st.target();
    if (target) {
      target.classList.add('coach-hl');
      if (tutScrolled !== st.id) { tutScrolled = st.id; try { target.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) {} }
    }
  }

  // ================= титул =================
  const CHAPTER_INFO = {
    prologue: { level: 1, levelLabel: 'обучение', title: 'Пролог. Царскосельская дорога', years: '1836–1838', desc: 'Обучение: два коротких участка, первый паровоз и первый рейс для публики.' },
    chapter1: { level: 2, levelLabel: 'умеренная', title: 'Глава I. Петербург — Москва', years: '1842–1851', desc: 'Трасса, колея, два пути, болота, Валдай, мосты и сроки. Главная дорога империи.' },
    chapter2: { level: 3, levelLabel: 'высокая', title: 'Глава II. Великий Сибирский путь', years: '1891–1904', desc: 'Через всю Сибирь к Тихому океану: стройка с двух концов, Байкал, выбор между Маньчжурией и Амуром.' },
    chapter3: { level: 4, levelLabel: 'очень высокая', title: 'Глава III. Байкало-Амурская магистраль', years: '1974–1984', desc: 'Стройка века: от Лены до Тынды через хребты и вечную мерзлоту, обходы и тоннели, «золотое звено».' },
    chapter4: { level: 5, levelLabel: 'особая', title: 'Глава IV. ВСМ «Центр — Юг»', years: '1988–1991', desc: 'Первая советская высокоскоростная магистраль: от Москвы на Крым и Кавказ, под 300 км/ч. Главе нужен особый подход.' },
  };
  const CHAPTER_ORDER = Object.keys(CHAPTER_INFO);
  // Сложность главы: пять делений, закрашенных по уровню
  const difficultyHtml = info => info.level ? `<div class="difficulty" title="Сложность">Сложность: <span class="dots">${'●'.repeat(info.level)}<span class="off">${'●'.repeat(5 - info.level)}</span></span> ${esc(info.levelLabel)}</div>` : '';
  const nextChapter = ch => {
    const ready = (S.home && S.home.chapters) || CHAPTER_ORDER;
    const n = CHAPTER_ORDER[CHAPTER_ORDER.indexOf(ch) + 1];
    return n && ready.includes(n) ? n : null;
  };
  // Эпоха оформления: тема берётся из карты главы (data-era), на титуле — гравюра
  function setEra(era) {
    document.documentElement.setAttribute('data-era', era || 'engraving');
    if (isSovietEra()) lexify(document.body);
  }

  async function openHome() {
    show('s-home');
    try { S.home = await api('GET', '/game'); } catch (err) { $('home-note').textContent = err.message; return; }
    const saves = S.home.saves || {};
    const done = (S.home.player && S.home.player.completed) || {};
    setEra('engraving');
    document.documentElement.removeAttribute('data-chapter');
    // Показываем только главы, которые сервер считает готовыми
    const ready = (S.home && S.home.chapters) || CHAPTER_ORDER;
    $('chapters').innerHTML = CHAPTER_ORDER.filter(ch => ready.includes(ch)).map(ch => {
      const info = CHAPTER_INFO[ch];
      const sv = saves[ch];
      let status = '';
      if (done[ch]) status = done[ch].halted ? 'Стройка остановлена — как в истории' : `Пройдена${done[ch].stars != null ? ` · звёзд ${done[ch].stars} из ${done[ch].max}` : ''}`;
      else if (sv && !sv.finished) status = `Идёт: ${SEASON_RU[sv.season].toLowerCase()} ${sv.year}`;
      else if (sv && sv.finished) status = sv.outcome === 'won' ? 'Пройдена' : sv.outcome === 'halted' ? 'Стройка остановлена' : 'Проиграна';
      const cont = sv && !sv.finished;
      const review = sv && sv.finished && (sv.outcome === 'won' || sv.outcome === 'halted');
      const locked = S.home.unlocked && !S.home.unlocked.includes(ch);
      if (locked) {
        return `<div class="chapter-card locked"><i class="corner tl">✥</i><i class="corner tr">✥</i><i class="corner bl">✥</i><i class="corner br">✥</i>
          <div class="years">${info.years}</div>
          <h3>${esc(info.title)}</h3>
          <div class="desc">${esc(info.desc)}</div>
          ${difficultyHtml(info)}
          <div class="status">Откроется после пролога</div>
        </div>`;
      }
      return `<div class="chapter-card"><i class="corner tl">✥</i><i class="corner tr">✥</i><i class="corner bl">✥</i><i class="corner br">✥</i>
        <div class="years">${info.years}</div>
        <h3>${esc(info.title)}</h3>
        <div class="desc">${esc(info.desc)}</div>
        ${difficultyHtml(info)}
        ${status ? `<div class="status">${esc(status)}</div>` : ''}
        <div class="row">
          ${cont ? `<button class="btn" data-resume="${ch}">Продолжить</button>` : ''}
          ${review ? `<button class="btn" data-resume="${ch}">Итоги</button>` : ''}
          <button class="btn ${cont || review ? 'ghost' : ''}" data-start="${ch}">${sv ? 'Начать заново' : 'Начать'}</button>
        </div>
      </div>`;
    }).join('');
    $('home-note').textContent = done.prologue || saves.chapter1 ? '' : 'Начните с пролога: это обучение, на каждом шаге подскажем, что делать и зачем.';
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
      if (ch === 'prologue') tutReset();
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
    setEra(S.content[r.chapter] && S.content[r.chapter].map.era);
    document.documentElement.setAttribute('data-chapter', r.chapter); // палитра и шрифты карты главы
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

  // ---- справочник по показателям: все числа — из balance.json и событий главы ----
  function eventThreshold(key, fallback) {
    const ev = (C().events || []).find(e => e.trigger && e.trigger[key] !== undefined);
    return ev ? ev.trigger[key] : fallback;
  }
  const favorRevision = () => eventThreshold('favorLte', 20);
  const moraleGrumble = () => eventThreshold('moraleLte', 35);
  const signed = n => (n > 0 ? `+${n}` : `−${Math.abs(n)}`);

  function helpHtml(key) {
    const s = S.state, v = S.view, b = C().balance, cb = b[S.chapter], cr = b.crews;
    const fv = cb.favor || {};
    const li = items => `<ul class="help-list">${items.filter(Boolean).map(x => `<li>${x}</li>`).join('')}</ul>`;
    switch (key) {
      case 'favor': return {
        title: 'Высочайшее благоволение',
        value: `${s.favor} из 100`,
        text: 'Насколько государь и начальство довольны вашей работой. Это ваш запас доверия: пока он есть, вам дают деньги и не мешают. Кончится — вас отстранят.',
        body: `<div class="sect-title">Растёт</div>${li([
          fv.milestoneBonus && `открыт участок: <b>${signed(fv.milestoneBonus)}</b>`,
          'решения в депешах, угодные начальству: число указано у варианта',
        ])}<div class="sect-title">Падает</div>${li([
          cb.behindSchedule && `отставание от графика больше чем на ${Math.round(cb.behindSchedule.lagShare * 100)}%: <b>${signed(-cb.behindSchedule.favorPenalty)}</b> каждый сезон`,
          fv.seasonLatePenalty && `после срока: <b>${signed(-fv.seasonLatePenalty)}</b> каждый сезон`,
          cb.petition && `прошение о деньгах: <b>${signed(-cb.petition.favorCost)}</b>`,
          cr.unpaidFavorPenalty && `не хватило на жалованье: <b>${signed(-cr.unpaidFavorPenalty)}</b>`,
          fv.incidentPenalty && `происшествие на первом рейсе: <b>${signed(-fv.incidentPenalty)}</b>`,
        ])}<div class="sect-title">Пороги</div>${li([
          `<b>${favorRevision()}</b> и ниже — приезжает ревизия: сезон уходит на бумаги или страдает настрой`,
          `<b>0</b> — вас отстраняют, глава проиграна`,
        ])}`,
      };
      case 'morale': return {
        title: 'Настрой артелей',
        value: `${s.morale} из 100`,
        text: `Выработка прямо пропорциональна настрою: при ${s.morale} артели работают на ${s.morale}% своих сил.`,
        body: `<div class="sect-title">Каждый сезон от оплаты</div>${li(['low', 'normal', 'high'].map(l => `${PAY_RU[l]} (${cr.pay[l].costPerCrew} за артель): <b>${cr.pay[l].moraleDeltaPerSeason ? signed(cr.pay[l].moraleDeltaPerSeason) : '0'}</b>${s.pay === l ? ' · сейчас' : ''}`))}
          <div class="sect-title">Ещё</div>${li([
            cr.unpaidMoralePenalty && `не хватило на жалованье: <b>${signed(-cr.unpaidMoralePenalty)}</b>`,
            'зимние и весенние депеши: бараки, осушение, ропот — число указано у варианта',
            `<b>${moraleGrumble()}</b> и ниже — ропот в артелях`,
          ])}`,
      };
      case 'treasury': {
        const pet = cb.petition;
        return {
          title: 'Казна',
          value: `${money(s.treasury)} тыс. руб.`,
          text: 'Деньги кончатся — работы встанут: материалы покупаются по мере работ, а без жалованья падают настрой и благоволение.',
          body: `<div class="sect-title">Приход</div>${li([
            cb.yearlyAllocation && `каждую весну ассигнования: <b>+${money(cb.yearlyAllocation)}</b>`,
            cb.revenuePerOpenKmPerSeason && `доход с открытых участков: ${cb.revenuePerOpenKmPerSeason} за км в сезон`,
            pet && `прошение: <b>+${money(pet.amount)}</b> за ${pet.favorCost} благоволения, не чаще раза в ${pet.cooldownSeasons} ${seasonsWord(pet.cooldownSeasons)}`,
          ])}<div class="sect-title">Расход</div>${li([
            `жалованье всем артелям, и свободным тоже: сейчас <b>${money(v.payPerSeason)}</b> за сезон`,
            `материалы — по мере работ, пропорционально стоимости участка`,
            `найм: ${cr.hireCostPerCrew} за артель`,
            'решения в депешах: цена указана у варианта',
          ])}`,
        };
      }
      case 'crews': return {
        title: 'Артели',
        value: `${s.crewsTotal}, свободно ${v.freeCrews}`,
        text: `Одна артель за сезон делает до ${cr.workPerCrewPerSeason} единиц работы, с поправкой на время года и настрой.`,
        body: li([
          `найм ${cr.hireCostPerCrew} за артель, не больше ${cr.maxHirePerSeason} за сезон — набирать людей надо заранее`,
          `на участке помещается до ${cr.maxCrewsPerKm} артели на километр`,
          'жалованье платится всем, свободные артели проедают казну впустую',
          'распустить можно только свободные',
          'когда участок открыт, его артели освобождаются — поставьте их на другой',
        ]),
      };
      case 'progress': return {
        title: 'Построено',
        value: `${Math.round(v.overallProgress)}%`,
        text: 'Доля всего объёма работ по трассе. Болото и холмы требуют больше работы, чем равнина.',
        body: li([
          cb.behindSchedule && `начальство ждёт равномерной работы до срока; отставание больше ${Math.round(cb.behindSchedule.lagShare * 100)}% от графика стоит ${cb.behindSchedule.favorPenalty} благоволения за сезон`,
          'график и срок видны на календаре под показателями',
        ]),
      };
    }
    return null;
  }

  function showHelp(key) {
    if (modalOpen()) return;
    const h = helpHtml(key);
    if (!h) return;
    haptic('tap');
    openModal(`<div class="kicker">Справочник главного инженера</div>
      <h2>${h.title}</h2>
      <div class="help-value">Сейчас: <b>${h.value}</b></div>
      <div class="text">${h.text}</div>
      ${DECOR.rule('✦')}
      <div class="help-body">${h.body}</div>
      <div class="hint">Числа — игровые, для баланса, а не исторические.</div>
      <button class="btn" data-next>Понятно</button>`, d => d.querySelector('[data-next]').addEventListener('click', () => { haptic('tap'); nextModal(); }));
  }

  // Памятка при первом открытии стройки в главе (один раз на устройстве)
  function memoKey() { return `koleya-memo-${S.chapter}`; }
  function memoSeen() { try { return localStorage.getItem(memoKey()) === '1'; } catch (_) { return true; } }
  function showMemo() {
    try { localStorage.setItem(memoKey(), '1'); } catch (_) {}
    const cb = C().balance[S.chapter];
    openModal(`<div class="kicker">Памятка главного инженера</div>
      <h2>Четыре вещи, за которыми надо следить</h2>
      ${DECOR.rule('❦')}
      <div class="help-body"><ul class="help-list">
        <li><b>Казна.</b> Жалованье платится всем артелям каждый сезон, материалы — по мере работ. Кончатся деньги — стройка встанет.</li>
        <li><b>Благоволение.</b> Доверие начальства. Падает от отставания, опоздания и прошений о деньгах. При ${favorRevision()} — ревизия, при 0 — отставка.</li>
        <li><b>Настрой.</b> От него зависит выработка. Скудная оплата его роняет.</li>
        <li><b>Срок.</b> ${cb.deadline ? `${SEASON_RU[cb.deadline.season].toLowerCase()} ${cb.deadline.year}. Календарь под показателями покажет, успеваете ли вы.` : 'Срока нет, но число сезонов ограничено — смотрите календарь.'}</li>
      </ul></div>
      <div class="hint">Нажмите на любой показатель вверху — откроется справка с точными числами.</div>
      <button class="btn" data-next>К работам</button>`, d => d.querySelector('[data-next]').addEventListener('click', () => { haptic('tap'); nextModal(); }));
  }

  function meter(v, cells = 5) {
    const f = Math.round(v / 100 * cells);
    return `<span class="meter${v <= 25 ? ' low' : ''}">${Array.from({ length: cells }, (_, i) => `<i class="${i < f ? 'f' : ''}"></i>`).join('')}</span>`;
  }
  // ---- календарь: сезон за клеткой от начала работ до крайнего срока ----
  const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
  const SEASON_ICON = { spring: 'в', summer: 'л', autumn: 'о', winter: 'з' };
  const di = (y, season) => y * 4 + SEASONS.indexOf(season);
  const fromDi = i => ({ year: Math.floor(i / 4), season: SEASONS[((i % 4) + 4) % 4] });
  function seasonsWord(n) { const a = n % 100, b = n % 10; if (a > 10 && a < 20) return 'сезонов'; if (b === 1) return 'сезон'; if (b >= 2 && b <= 4) return 'сезона'; return 'сезонов'; }
  function spanText(n) {
    const y = Math.floor(n / 4), r = n % 4;
    const yw = y % 10 === 1 && y % 100 !== 11 ? 'год' : (y % 10 >= 2 && y % 10 <= 4 && (y % 100 < 10 || y % 100 >= 20)) ? 'года' : 'лет';
    return y ? `${y} ${yw}${r ? ` ${r} ${seasonsWord(r)}` : ''}` : `${n} ${seasonsWord(n)}`;
  }

  function renderCalendar() {
    const s = S.state, v = S.view, b = C().balance, cb = b[S.chapter];
    const el = $('calendar');
    if (!s) return;
    const now = di(s.year, s.season);
    const startCfg = cb.constructionStart || { year: cb.startYear, season: cb.startSeason };
    const start = Math.min(now, di(startCfg.year, startCfg.season));
    const deadline = cb.deadline ? di(cb.deadline.year, cb.deadline.season) : null;
    // Крайний срок игры: после maxTurns ходов — отставка «сроки вышли»
    const limit = now + Math.max(0, cb.maxTurns - s.turn);
    const done = !!s.completedAt;
    // Лента целыми годами: от года начала до года отставки
    const y0 = fromDi(start).year, y1 = fromDi(limit).year;
    const years = [];
    for (let y = y0; y <= y1; y++) {
      const cells = SEASONS.map(season => {
        const i = di(y, season);
        const cls = ['cc'];
        if (i < start || i > limit) cls.push('out');
        else if (i < now) cls.push('past');
        else if (i === now) cls.push('now');
        if (deadline !== null && i > deadline && i <= limit) cls.push('late');
        if (i === deadline) cls.push('deadline');
        if (i === limit && !done) cls.push('limit');
        return `<i class="${cls.join(' ')}" title="${SEASON_RU[season]} ${y}"></i>`;
      }).join('');
      years.push(`<div class="cy${y === s.year ? ' cur' : ''}"><div class="cells">${cells}</div><div class="yl">${String(y).slice(2)}</div></div>`);
    }
    // Подпись: сколько осталось и где мы относительно графика
    let line;
    if (done) {
      line = `Трасса открыта: ${SEASON_RU[s.completedAt.season].toLowerCase()} ${s.completedAt.year}.`;
    } else if (deadline !== null) {
      const left = deadline - now;
      const dl = `${SEASON_RU[cb.deadline.season].toLowerCase()} ${cb.deadline.year}`;
      if (left > 0) line = `До срока (${dl}) — <b>${spanText(left)}</b>.`;
      else if (left === 0) line = `<b>Срок — этот сезон</b> (${dl}).`;
      else line = `<span class="bad">Опоздание ${spanText(-left)}.</span> До отставки — ${spanText(limit - now)}.`;
      if (left > 0 && s.unlocked.construction && cb.behindSchedule) {
        const cs = di(cb.constructionStart.year, cb.constructionStart.season);
        const expected = Math.max(0, Math.min(1, (now - cs) / Math.max(1, deadline - cs))) * 100;
        const behind = v.overallProgress < expected - cb.behindSchedule.lagShare * 100;
        line += ` По графику ≈${Math.round(expected)}%, построено ${Math.round(v.overallProgress)}%${behind ? ' — <span class="bad">отстаём, благоволение падает</span>' : ''}.`;
      }
    } else {
      line = `Срока нет, но на пролог осталось <b>${spanText(limit - now)}</b>.`;
    }
    const legend = `<div class="cal-legend">
      <span><i class="cc past"></i>прошло</span><span><i class="cc now"></i>сейчас</span>
      ${deadline !== null ? '<span><i class="cc deadline"></i>срок</span><span><i class="cc late"></i>опоздание</span>' : ''}
      <span><i class="cc limit"></i>отставка</span><span>клетка — сезон</span></div>`;
    el.innerHTML = `<div class="cal-strip">${years.join('')}</div>${legend}<div class="cal-line">${line}</div>`;
  }

  function renderRes() {
    const s = S.state, v = S.view;
    if (!s) return;
    renderCalendar();
    $('resbar').innerHTML = `
      <div class="res"><span class="lbl">${esc(C().map.title)}</span><span class="date"><span class="sglyph">${SEASON_GLYPH[s.season]}</span> ${SEASON_RU[s.season]} ${s.year}</span></div>
      <button class="res" data-help="treasury" type="button"><span class="lbl">Казна, тыс. руб. ⓘ</span><span class="val${s.treasury < 0 ? ' neg' : ''}">${money(s.treasury)}</span></button>
      <button class="res" data-help="crews" type="button"><span class="lbl">Артели своб./всего ⓘ</span><span class="val">${v.freeCrews} / ${s.crewsTotal}</span></button>
      <button class="res" data-help="favor" type="button"><span class="lbl">Благоволение ⓘ</span><span class="val-meter"><b class="${s.favor <= favorRevision() ? 'neg' : ''}">${s.favor}</b>${meter(s.favor)}</span></button>
      <button class="res" data-help="morale" type="button"><span class="lbl">Настрой ⓘ</span><span class="val-meter"><b class="${s.morale <= moraleGrumble() ? 'neg' : ''}">${s.morale}</b>${meter(s.morale)}</span></button>
      <button class="res" data-help="progress" type="button"><span class="lbl">Построено ⓘ</span><span class="val">${Math.round(v.overallProgress)}%</span></button>`;
    $('resbar').querySelectorAll('[data-help]').forEach(b => b.addEventListener('click', () => showHelp(b.dataset.help)));
    const act = Object.values(v.segments).filter(x => x.active);
    const opened = act.filter(x => x.opened).length;
    const building = act.filter(x => !x.opened && x.crews > 0).length;
    $('map-toggle-sub').textContent = s.unlocked.construction
      ? `открыто ${opened} из ${act.length}${building ? ` · строится ${building}` : ''}`
      : 'посмотреть трассу';
  }

  // ---- карта-чертёж (SVG) ----
  const SVGNS = 'http://www.w3.org/2000/svg';
  // Проекция чертежа. На вертикальном экране карта разворачивается вдоль трассы
  // (как старинные путевые карты): линия from → to идёт сверху вниз и занимает всю высоту.
  // P.northDeg — на сколько повернуть розу ветров, чтобы она показывала настоящий север.
  function projector(nodes, W, H, pad, along) {
    const lats = nodes.map(n => n.lat);
    const lat0 = (Math.min(...lats) + Math.max(...lats)) / 2;
    const kx = Math.cos(lat0 * Math.PI / 180);
    const base = n => [n.lon * kx, -n.lat];
    let alpha = 0;
    if (along && H > W * 1.15) {
      const [u0, v0] = base(along.from), [u1, v1] = base(along.to);
      alpha = Math.PI / 2 - Math.atan2(v1 - v0, u1 - u0);
    }
    const ca = Math.cos(alpha), sa = Math.sin(alpha);
    const rot = n => { const [u, v] = base(n); return [u * ca - v * sa, u * sa + v * ca]; };
    const pts = nodes.map(rot);
    const minX = Math.min(...pts.map(p => p[0])), maxX = Math.max(...pts.map(p => p[0]));
    const minY = Math.min(...pts.map(p => p[1])), maxY = Math.max(...pts.map(p => p[1]));
    const sc = Math.min((W - 2 * pad.x) / Math.max(1e-6, maxX - minX), (H - pad.top - pad.bottom) / Math.max(1e-6, maxY - minY));
    const offX = (W - (maxX - minX) * sc) / 2;
    const offY = pad.top + ((H - pad.top - pad.bottom) - (maxY - minY) * sc) / 2;
    const P = n => { const [x, y] = rot(n); return [offX + (x - minX) * sc, offY + (y - minY) * sc]; };
    P.northDeg = alpha * 180 / Math.PI;
    return P;
  }
  function lineLen(a, b) { return Math.hypot(b[0] - a[0], b[1] - a[1]); }

  // ---- масштаб карты пальцами ----
  // S.zoom: k — во сколько раз приближено, (x, y) — левый верхний угол окна в координатах чертежа.
  const ZOOM_MAX = 6;
  const mapDims = { W: 0, H: 0 };
  function clampZoom(z, W, H) {
    z.k = Math.max(1, Math.min(ZOOM_MAX, z.k));
    z.x = Math.max(0, Math.min(W - W / z.k, z.x));
    z.y = Math.max(0, Math.min(H - H / z.k, z.y));
    return z;
  }
  // Приблизить к точке экрана (px, py — в координатах SVG-окна), сохранив её под пальцем
  function zoomAt(k, px, py, from = S.zoom) {
    const cx = from.x + px / from.k, cy = from.y + py / from.k;
    S.zoom = clampZoom({ k, x: cx - px / k, y: cy - py / k }, mapDims.W, mapDims.H);
  }
  let zoomRaf = 0;
  function scheduleMap() { if (!zoomRaf) zoomRaf = requestAnimationFrame(() => { zoomRaf = 0; renderMap(); }); }
  function zoomBy(f) {
    haptic('sel');
    zoomAt(S.zoom.k * f, mapDims.W / 2, mapDims.H / 2);
    renderMap();
  }

  (function setupMapGestures() {
    const svg = $('map');
    const pts = new Map();
    let start = null, moved = false, lastTap = 0;
    const toSvg = e => {
      const r = svg.getBoundingClientRect();
      return [(e.clientX - r.left) * mapDims.W / r.width, (e.clientY - r.top) * mapDims.H / r.height];
    };
    const snapshot = () => {
      const list = [...pts.values()];
      if (list.length >= 2) {
        const [a, b] = list;
        start = { zoom: { ...S.zoom }, dist: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
      } else if (list.length === 1) {
        start = { zoom: { ...S.zoom }, p: list[0] };
      } else start = null;
    };
    svg.addEventListener('pointerdown', e => {
      pts.set(e.pointerId, toSvg(e));
      if (pts.size === 1) moved = false;
      snapshot();
    });
    svg.addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId) || !start) return;
      pts.set(e.pointerId, toSvg(e));
      const list = [...pts.values()];
      if (list.length >= 2 && start.dist) {
        const [a, b] = list;
        const dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
        const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const k = start.zoom.k * dist / start.dist;
        // точка чертежа под начальной серединой остаётся под текущей серединой
        const cx = start.zoom.x + start.mid[0] / start.zoom.k, cy = start.zoom.y + start.mid[1] / start.zoom.k;
        const kk = Math.max(1, Math.min(ZOOM_MAX, k));
        S.zoom = clampZoom({ k: kk, x: cx - mid[0] / kk, y: cy - mid[1] / kk }, mapDims.W, mapDims.H);
        moved = true;
        scheduleMap();
      } else if (list.length === 1 && start.p) {
        const [x, y] = list[0];
        const dx = x - start.p[0], dy = y - start.p[1];
        if (Math.hypot(dx, dy) > 6) moved = true;
        if (moved && start.zoom.k > 1) {
          S.zoom = clampZoom({ k: start.zoom.k, x: start.zoom.x - dx / start.zoom.k, y: start.zoom.y - dy / start.zoom.k }, mapDims.W, mapDims.H);
          scheduleMap();
        }
      }
    });
    const up = e => {
      if (!pts.has(e.pointerId)) return;
      const p = pts.get(e.pointerId);
      pts.delete(e.pointerId);
      snapshot();
      // двойной тап: приблизить в точку, на сильном приближении — весь чертёж
      if (!moved && pts.size === 0 && e.type === 'pointerup') {
        const now = Date.now();
        if (now - lastTap < 300) {
          lastTap = 0;
          haptic('sel');
          if (S.zoom.k > 2.5) S.zoom = { k: 1, x: 0, y: 0 };
          else zoomAt(S.zoom.k * 2, p[0], p[1]);
          renderMap();
        } else lastTap = now;
      }
    };
    svg.addEventListener('pointerup', up);
    svg.addEventListener('pointercancel', up);
    // После перетаскивания касание не должно открывать участок
    svg.addEventListener('click', e => { if (moved) { e.stopPropagation(); e.preventDefault(); } }, true);
    // Колесо мыши — на компьютере
    svg.addEventListener('wheel', e => {
      e.preventDefault();
      const [x, y] = toSvg(e);
      zoomAt(S.zoom.k * Math.exp(-e.deltaY * 0.0015), x, y);
      scheduleMap();
    }, { passive: false });
  })();

  // Ширина подписи станции шрифтом главы (--map-font-station) — для раскладки без наложений
  const measureCtx = document.createElement('canvas').getContext('2d');
  function measureLabel(text, size) {
    const cs = getComputedStyle(document.documentElement);
    const family = cs.getPropertyValue('--map-font-station').trim() || cs.getPropertyValue('--font-display').trim() || 'serif';
    const style = cs.getPropertyValue('--map-station-style').trim() || 'italic';
    measureCtx.font = `${style} ${size}px ${family}`;
    return measureCtx.measureText(text).width;
  }
  function renderMap() {
    const svg = $('map');
    const c = C();
    if (!c || !mapOpen()) return;
    const box = $('map-wrap').getBoundingClientRect();
    const W = Math.max(300, Math.round(box.width)), H = Math.max(220, Math.round(box.height));
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const visibleNodes = c.map.nodes.filter(n => !(S.state.routeVariant && n.variant && n.variant !== S.state.routeVariant));
    const fr = c.map.historical.firstRun;
    const P = projector(visibleNodes, W, H, { x: 70, top: 64, bottom: 34 }, { from: c.nodesById[fr.from], to: c.nodesById[fr.to] });
    const s = S.state, v = S.view;
    const parts = [];
    // Масштаб пальцами: содержимое в группе с transform, украшения поверх — неподвижны.
    // Подписи и кружки делим на zk, чтобы при приближении они оставались читаемого размера.
    mapDims.W = W; mapDims.H = H;
    const Z = clampZoom(S.zoom, W, H);
    const zk = Z.k, inv = 1 / zk;

    parts.push(`<defs>
      <clipPath id="map-clip"><rect x="8" y="8" width="${W - 16}" height="${H - 16}"/></clipPath>
      <pattern id="p-forest" patternTransform="scale(${inv})" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M1 6 L3 2 M5 7 L7 3" class="hatch-forest"/></pattern>
      <pattern id="p-swamp" patternTransform="scale(${inv})" width="10" height="6" patternUnits="userSpaceOnUse"><path d="M0 3 H4 M6 3 H9" class="hatch-swamp"/></pattern>
      <pattern id="p-hills" patternTransform="scale(${inv})" width="10" height="8" patternUnits="userSpaceOnUse"><path d="M1 6 Q5 0 9 6" class="hatch-hills"/></pattern>
      <pattern id="p-steppe" patternTransform="scale(${inv})" width="14" height="8" patternUnits="userSpaceOnUse"><path d="M1 6 l2 -3 l2 3 M8 6 l2 -3 l2 3" class="hatch-plain-l"/></pattern>
      <pattern id="p-taiga" patternTransform="scale(${inv})" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M3 8 L5 2 L7 8 Z" class="hatch-forest"/></pattern>
      <pattern id="p-mountains" patternTransform="scale(${inv})" width="14" height="10" patternUnits="userSpaceOnUse"><path d="M1 9 L5 2 L9 9 M6 9 L10 4 L13 9" class="hatch-hills"/></pattern>
      <pattern id="p-permafrost" patternTransform="scale(${inv})" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M5 2 V8 M2 5 H8 M3 3 L7 7 M7 3 L3 7" class="hatch-frost"/></pattern>
      <pattern id="p-plain" patternTransform="scale(${inv})" width="12" height="12" patternUnits="userSpaceOnUse"><circle cx="6" cy="6" r="0.6" class="hatch-plain"/></pattern>
    </defs>`);
    // Рамка — двойная линия
    parts.push(`<rect x="3" y="3" width="${W - 6}" height="${H - 6}" class="frame"/><rect x="7" y="7" width="${W - 14}" height="${H - 14}" class="frame thin"/>`);
    // Текстура подложки: дерево (по умолчанию), акварель, гравюра-штриховка или типографский растр.
    // Для просмотра вариантов: #…&maptex=hatch | halftone | watercolor | wood
    const TEX = (location.hash.match(/maptex=(\w+)/) || [])[1] || c.map.mapTexture || 'wood';
    const hatchAngles = [0, 35, 70, 110, 145, 20];
    parts.push(`<defs>
      <filter id="tex-watercolor" x="-2%" y="-2%" width="104%" height="104%" color-interpolation-filters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="${(0.012 * inv).toFixed(5)}" numOctaves="3" seed="3" result="n"/>
        <feDisplacementMap in="SourceGraphic" in2="n" scale="${(5 * inv).toFixed(2)}" xChannelSelector="R" yChannelSelector="G" result="d"/>
        <feTurbulence type="fractalNoise" baseFrequency="${(0.045 * inv).toFixed(5)}" numOctaves="2" seed="9" result="m"/>
        <feColorMatrix in="m" type="matrix" values="0 0 0 0 0.35  0 0 0 0 0.26  0 0 0 0 0.18  0.38 0 0 0 -0.15" result="mm"/>
        <feComposite in="mm" in2="d" operator="in" result="mi"/><feBlend in="mi" in2="d" mode="multiply"/>
      </filter>
      <filter id="wood-grain" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="${(0.004 * inv).toFixed(5)} ${(0.06 * inv).toFixed(5)}" numOctaves="3" seed="7" result="n"/>
        <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.35  0 0 0 0 0.25  0 0 0 0 0.16  0.45 0 0 0 -0.17" result="g"/>
        <feComposite in="g" in2="SourceGraphic" operator="in" result="gi"/><feBlend in="gi" in2="SourceGraphic" mode="multiply"/>
      </filter>
      ${hatchAngles.map((a, i) => `<pattern id="tex-hatch-${i}" patternUnits="userSpaceOnUse" width="${(5 + i % 3) * inv}" height="${(5 + i % 3) * inv}" patternTransform="rotate(${a})"><rect width="${(5 + i % 3) * inv}" height="${(5 + i % 3) * inv}" class="w${i}"/><line x1="0" y1="0" x2="0" y2="${(5 + i % 3) * inv}" class="hatch-line" style="stroke-width:${(0.7 * inv).toFixed(2)}px"/></pattern>`).join('')}
      ${[0, 1, 2, 3, 4, 5].map(i => { const st = (4 + (i % 3) * 1.5) * inv, r = (0.55 + (i % 3) * 0.25) * inv; return `<pattern id="tex-dots-${i}" patternUnits="userSpaceOnUse" width="${st}" height="${st}" patternTransform="rotate(${15 + i * 10})"><rect width="${st}" height="${st}" class="w${i}"/><circle cx="${st / 2}" cy="${st / 2}" r="${r}" class="dot"/></pattern>`; }).join('')}
      ${[0, 1, 2, 3, 4, 5].map(i => { const st = (2.6 + (i % 3) * 0.7) * inv, r = (0.32 + (i % 2) * 0.12) * inv; return `<pattern id="tex-stipple-${i}" patternUnits="userSpaceOnUse" width="${st}" height="${st}" patternTransform="rotate(${i * 23}) skewX(${10 + i * 7})"><rect width="${st}" height="${st}" class="w${i}"/><circle cx="${st * 0.3}" cy="${st * 0.4}" r="${r}" class="dot"/></pattern>`; }).join('')}
      ${[0, 1, 2, 3, 4, 5].map(i => { const st = (6 + (i % 3) * 2) * inv; return `<pattern id="tex-grid-${i}" patternUnits="userSpaceOnUse" width="${st}" height="${st}"${i % 2 ? ' patternTransform="rotate(45)"' : ''}><rect width="${st}" height="${st}" class="w${i}"/><path d="M0 0 H${st} M0 0 V${st}" class="grid-line" style="stroke-width:${(0.5 * inv).toFixed(2)}px"/></pattern>`; }).join('')}
    </defs>`);
    parts.push(`<g clip-path="url(#map-clip)"><rect x="0" y="0" width="${W}" height="${H}" class="wood-wall"/><g class="zc" id="map-zoom" transform="translate(${(-Z.x * zk).toFixed(2)} ${(-Z.y * zk).toFixed(2)}) scale(${zk})">`);
    const bm = c.basemap;
    const woodPath = rs => rs.map(r => 'M' + r.map(([lon, lat]) => { const [x, y] = P({ lon, lat }); return `${x.toFixed(1)} ${y.toFixed(1)}`; }).join('L') + 'Z').join('');
    let regionSlot = -1;
    if (bm) {
      const byTone = {};
      for (const pc of bm.pieces) (byTone[pc.f] = byTone[pc.f] || []).push(pc);
      const PATTERN = { hatch: 'tex-hatch', halftone: 'tex-dots', stipple: 'tex-stipple', grid: 'tex-grid' }[TEX];
      const texFill = f => (f < 0 || !PATTERN ? '' : ` style="fill:url(#${PATTERN}-${f})"`);
      const texFilter = TEX === 'wood' ? ' filter="url(#wood-grain)"' : TEX === 'watercolor' ? ' filter="url(#tex-watercolor)"' : '';
      parts.push(`<g class="wood tex-${TEX}"${texFilter}>${Object.entries(byTone).map(([f, list]) => list.map(pc => `<path d="${woodPath(pc.r)}" class="wood-land ${f < 0 ? 'wf' : 'w' + f}"${texFill(+f)}/>`).join('')).join('')}</g>`);
      parts.push(bm.lakes.map(l => `<path d="${woodPath(l.r)}" class="wood-lake"/>`).join(''));
      parts.push(`<g class="wood-rivers">${bm.rivers.map(rv => `<path d="M${rv.l.map(([lon, lat]) => P({ lon, lat }).map(v => v.toFixed(1)).join(' ')).join('L')}" style="stroke-width:${(rv.w * 0.35).toFixed(2)}px"/>`).join('')}</g>`);
      regionSlot = parts.length; parts.push('');
    }

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
        } else if (f.kind === 'crossing') {
          // Озеро поперёк трассы; паром — пунктир по воде, обходная дорога — дуга по берегу
          parts.push(`<ellipse cx="${m[0] + nx * 10}" cy="${m[1] + ny * 10}" rx="${Math.min(40, L * 0.35)}" ry="14" transform="rotate(${Math.atan2(dy, dx) * 180 / Math.PI} ${m[0] + nx * 10} ${m[1] + ny * 10})" class="lake"/>`);
          if (sv.features[fid] === 'ferry') parts.push(`<path d="M${m[0] - dx / L * 22} ${m[1] - dy / L * 22} L${m[0] + dx / L * 22} ${m[1] + dy / L * 22}" class="ferry-line"/>`);
        } else if (f.kind === 'grade') {
          const val = sv.features[fid];
          if (val === 'bypass') {
            parts.push(`<path d="M${m[0] - dx / L * 10} ${m[1] - dy / L * 10} q${nx * 14} ${ny * 14} ${dx / L * 20} ${dy / L * 20}" class="bypass"/>`);
          }
          parts.push(`<path d="M${m[0] + nx * 8 - dx / L * 4} ${m[1] + ny * 8 - dy / L * 4} l${dx / L * 4 + nx * 4} ${dy / L * 4 + ny * 4} l${dx / L * 4 - nx * 4} ${dy / L * 4 - ny * 4}" class="grade-mark"/>`);
        }
      });
    }
    // Трасса: сначала светлый кант, чтобы линия читалась на любом тоне дерева
    for (const { a, b, sv } of segs) if (sv.active || !decided) parts.push(`<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" class="route-edge"/>`);
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
      if (!alt && !sv.opened && s.unlocked.construction && (sv.progress > 0 || sv.crews > 0)) {
        const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const dx = b[0] - a[0], dy = b[1] - a[1], Ln = Math.hypot(dx, dy) || 1;
        let nx = -dy / Ln, ny = dx / Ln;
        if (nx > 0) { nx = -nx; ny = -ny; } // подписи станций справа — проценты слева
        parts.push(`<text x="${m[0] + nx * 17 * inv}" y="${m[1] + (ny * 17 + 4) * inv}" text-anchor="end" class="seg-pct" style="font-size:${(10.5 * inv).toFixed(2)}px;stroke-width:${(3 * inv).toFixed(2)}px">${Math.round(sv.progress)}%</text>`);
      }
      if (sv.opened && !alt) {
        const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const dx = b[0] - a[0], dy = b[1] - a[1], Ln = Math.hypot(dx, dy) || 1;
        let nx = -dy / Ln, ny = dx / Ln;
        if (nx > 0) { nx = -nx; ny = -ny; }
        parts.push(`<text x="${m[0] + nx * 15 * inv}" y="${m[1] + (ny * 15 + 4) * inv}" text-anchor="end" class="seg-pct done" style="font-size:${(10.5 * inv).toFixed(2)}px;stroke-width:${(3 * inv).toFixed(2)}px">✓</text>`);
      }
      if (sv.crews > 0 && !sv.opened) {
        const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        parts.push(`<g class="crew-badge" transform="translate(${m[0]} ${m[1]}) scale(${inv}) translate(${-m[0]} ${-m[1]})"><circle cx="${m[0]}" cy="${m[1]}" r="8.5"/><text x="${m[0]}" y="${m[1] + 3.5}" text-anchor="middle">${sv.crews}</text></g>`);
      }
      if (!alt) parts.push(`<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" class="seg-hit" style="stroke-width:${(22 * inv).toFixed(2)}px" data-seg="${seg.id}"/>`);
    }
    // Станции. Подписи раскладываем: если рядом уже есть подпись с той же стороны — переносим
    // на другую сторону, а если тесно с обеих — прячем подпись мелкой станции.
    const fs = Math.max(10, Math.min(13, W / 34));
    const placed = [];
    const nodesToDraw = c.map.nodes.filter(n => !(decided && n.variant && n.variant !== s.routeVariant))
      .map(n => ({ n, p: P(n), rank: n.kind === 'capital' ? 0 : n.kind === 'town' ? 1 : 2 }))
      .sort((a, b) => a.rank - b.rank);
    const clash = (sx, sy, right, w) => placed.some(q => Math.abs(q.y - sy) < fs * 1.5 && (right ? sx < q.x2 && sx + w > q.x1 : sx - w < q.x2 && sx > q.x1));
    for (const { n, p: [x, y] } of nodesToDraw) {
      if (n.kind === 'capital') parts.push(`<circle cx="${x}" cy="${y}" r="${6.5 * inv}" class="node"/><circle cx="${x}" cy="${y}" r="${3 * inv}" class="node inner"/>`);
      else parts.push(`<circle cx="${x}" cy="${y}" r="${(n.kind === 'town' ? 4 : 3) * inv}" class="node${n.kind === 'station' ? ' small' : ''}"/>`);
      const name = n.name.replace(/\s*\(.+\)/, '');
      const size = n.kind === 'station' ? fs - 1 : fs + 1;
      const w = measureLabel(name, size) + 4;
      // экранные координаты для проверки наложений
      const sx = (x - Z.x) * zk, sy = (y - Z.y) * zk;
      let right = sx < W * 0.62;
      if (clash(sx + (right ? 9 : -9), sy, right, w)) right = !right;
      if (clash(sx + (right ? 9 : -9), sy, right, w) && n.kind !== 'capital') continue; // тесно — подпись появится при приближении
      const lx = sx + (right ? 9 : -9);
      placed.push({ y: sy, x1: right ? lx : lx - w, x2: right ? lx + w : lx });
      parts.push(`<text x="${x + (right ? 9 : -9) * inv}" y="${y + 4 * inv}" text-anchor="${right ? 'start' : 'end'}" class="node-label" font-size="${(size * inv).toFixed(2)}" style="stroke-width:${(3 * inv).toFixed(2)}px">${esc(name)}</text>`);
    }
    if (bm && regionSlot >= 0) {
      // Подписи регионов: экранные рамки не пересекают подписи станций и трассу; не влезла — не пишем
      const toS = ([x, y]) => [(x - Z.x) * zk, (y - Z.y) * zk];
      const obst = placed.map(q => ({ x1: q.x1 - 4, x2: q.x2 + 4, y1: q.y - fs, y2: q.y + 5 }));
      for (const { a, b } of segs) {
        const A = toS(a), B = toS(b), L = Math.max(1, lineLen(A, B));
        for (let t = 0; t <= L; t += 8) { const x = A[0] + (B[0] - A[0]) * t / L, y = A[1] + (B[1] - A[1]) * t / L; obst.push({ x1: x - 8, x2: x + 8, y1: y - 8, y2: y + 8 }); }
      }
      for (const nd of nodesToDraw) { const [x, y] = toS(nd.p); obst.push({ x1: x - 8, x2: x + 8, y1: y - 8, y2: y + 8 }); }
      // неподвижные украшения: картуш, роза ветров, масштабная линейка
      obst.push({ x1: 0, x2: Math.min(W - 28, 230) + 20, y1: 0, y2: 60 }, { x1: W - 90, x2: W, y1: H - 110, y2: H }, { x1: 0, x2: 200, y1: H - 44, y2: H });
      const hit = r => obst.some(q => !(r.x2 < q.x1 || r.x1 > q.x2 || r.y2 < q.y1 || r.y1 > q.y2));
      const inPoly = (rings, x, y) => { let c = false; for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
      const rs = Math.max(9, Math.min(12, W / 40));
      const out = [];
      for (const pc of bm.pieces) {
        if (!pc.n || !pc.lp) continue;
        const [cx, cy] = toS(P({ lon: pc.lp[0], lat: pc.lp[1] }));
        const m = pc.n.match(/^(.*) (губ\.|обл\.|у\.|АССР|АО|край)$/);
        const lines = m && pc.n.length > 14 ? [m[1], m[2]] : [pc.n];
        // ширина с учётом разрядки букв главы (--map-region-spacing)
        const spacing = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--map-region-spacing')) || 1.5;
        const w = Math.max(...lines.map(t => t.length)) * (rs * 0.7 + spacing) + 10, h = lines.length * rs * 1.2 + 4;
        // Кандидаты: точка подписи, затем сетка по видимой части детали, ближние — раньше
        const scr = pc.r.map(r => r.map(([lon, lat]) => toS(P({ lon, lat }))));
        const xs = scr.flat().map(q => q[0]), ys = scr.flat().map(q => q[1]);
        const x0 = Math.max(12 + w / 2, Math.min(...xs)), x1 = Math.min(W - 12 - w / 2, Math.max(...xs));
        const y0 = Math.max(60 + h / 2, Math.min(...ys)), y1 = Math.min(H - 44 - h / 2, Math.max(...ys));
        const cands = [[cx, cy]];
        for (let y = y0; y <= y1; y += 18) for (let x = x0; x <= x1; x += 24) cands.push([x, y]);
        cands.sort((a, b) => (a === cands[0] ? -1 : b === cands[0] ? 1 : Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy)));
        // Сначала подпись целиком внутри детали; не вышло — достаточно, чтобы внутри был её центр
        let ok = null;
        for (const strict of [true, false]) {
          for (const [x, y] of cands.slice(0, 400)) {
            const r = { x1: x - w / 2, x2: x + w / 2, y1: y - h / 2, y2: y + h / 2 };
            if (r.x1 < 12 || r.x2 > W - 12 || r.y1 < 60 || r.y2 > H - 44 || hit(r)) continue;
            const probe = strict ? [[r.x1, r.y1], [r.x2, r.y1], [r.x1, r.y2], [r.x2, r.y2], [x, y]] : [[x, y]];
            if (!probe.every(([qx, qy]) => inPoly(scr, qx, qy))) continue;
            ok = { x, y, r }; break;
          }
          if (ok) break;
        }
        if (!ok) continue;
        obst.push(ok.r);
        const ux = ok.x / zk + Z.x, uy = ok.y / zk + Z.y;
        out.push(`<text class="wood-region" text-anchor="middle" font-size="${(rs * inv).toFixed(2)}">${lines.map((t, i) => `<tspan x="${ux.toFixed(1)}" y="${(uy + ((i - (lines.length - 1) / 2) * rs * 1.2 + rs * 0.35) * inv).toFixed(1)}">${esc(t.toUpperCase())}</tspan>`).join('')}</text>`);
      }
      parts[regionSlot] = out.join('');
    }
    parts.push(`</g></g>`);
    // Роза ветров и масштабная линейка: в вёрстах (1 верста = 1,0668 км), в советских главах — в км
    parts.push(DECOR.rose(W - 44, H - 58, 26, P.northDeg));
    {
      const a0 = c.map.nodes[0], a1 = c.map.nodes[c.map.nodes.length - 1];
      const pxPerKm = zk * Math.hypot(P(a1)[0] - P(a0)[0], P(a1)[1] - P(a0)[1]) /
        (Math.hypot((a1.lon - a0.lon) * Math.cos((a0.lat + a1.lat) / 2 * Math.PI / 180), a1.lat - a0.lat) * 111.32 || 1);
      const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
      const unitKm = isSovietEra() ? 1 : 1.0668;
      const versts = steps.find(v => v * unitKm * pxPerKm >= 72) || steps[steps.length - 1];
      const L = versts * unitKm * pxPerKm;
      const x0 = 20, y0 = H - 24;
      const ticks = [0, 1, 2, 3].map(i => `<rect x="${x0 + i * L / 4}" y="${y0 - 3}" width="${L / 4}" height="4" class="${i % 2 ? 'scale-w' : 'scale-b'}"/>`).join('');
      parts.push(`<g class="scale">${ticks}<text x="${x0}" y="${y0 + 11}" class="scale-t">0</text><text x="${x0 + L}" y="${y0 + 11}" text-anchor="end" class="scale-t">${versts} ${isSovietEra() ? 'км' : 'вёрст'}</text></g>`);
    }
    // Картуш
    parts.push(`<g class="cartouche"><rect x="14" y="14" width="${Math.min(W - 28, 230)}" height="36" class="cartouche-box"/>
      <rect x="11" y="11" width="${Math.min(W - 28, 230) + 6}" height="42" class="cartouche-box thin"/>
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
    if (S.selected) {
      el.innerHTML = (s.unlocked.construction ? crewBar() : '') + segmentPanel(c.segById[S.selected]);
      bindSegmentPanel();
      bindCrewBar(el);
      syncTelegramButtons();
      return;
    }

    const parts = [];
    if (!s.unlocked.construction) {
      parts.push(`<div class="hint">Строительство откроется после первых депеш.</div>`);
    } else {
      parts.push(crewBar());
      const unopened = c.map.segments.some(x => v.segments[x.id].active && !v.segments[x.id].opened);
      if (v.freeCrews > 0 && unopened) {
        parts.push(`<div class="report-note bad">Без дела ${v.freeCrews} ${pluralCrews(v.freeCrews)}: жалованье идёт, работа стоит. Выберите участок и добавьте людей.</div>`);
      }
      // Линейная схема дороги по дирекциям: станции и перегоны, перегон закрашен на % готовности
      const groups = {};
      for (const seg of c.map.segments) {
        if (!v.segments[seg.id].active) continue;
        const g = seg.directorate || 'main';
        (groups[g] = groups[g] || []).push(seg);
      }
      const gName = { main: 'Участки', ...(c.map.directorates || {}) };
      for (const [g, list] of Object.entries(groups)) {
        const crews = list.reduce((a, x) => a + v.segments[x.id].crews, 0);
        parts.push(`<div class="sect"><div class="sect-title fleur">${gName[g]} · ${crews} ${pluralCrews(crews)}</div><div class="scheme">`);
        parts.push(stationRow(list[0].from));
        for (const seg of list) { parts.push(schemeRow(seg)); parts.push(stationRow(seg.to)); }
        parts.push(`</div></div>`);
      }
      parts.push(crewsSection());
    }
    if (s.unlocked.rollingStock) parts.push(stockSection());
    parts.push(financeSection());
    el.innerHTML = parts.join('');
    el.querySelectorAll('[data-seg]').forEach(b => b.addEventListener('click', () => selectSeg(b.dataset.seg)));
    bindSliders(el);
    bindCommon();
    // Кнопка сезона и наставник зависят от того, что игрок только что сделал на панели
    syncTelegramButtons();
  }

  function stationRow(nodeId) {
    const n = C().nodesById[nodeId];
    return `<div class="st-row"><span class="rail"><i class="st-dot${n.kind === 'capital' ? ' capital' : ''}"></i></span>
      <span class="st-name">${esc(n.name.replace(/\s*\(.+\)/, ''))}</span></div>`;
  }

  // Сколько процентов участка даст сезон при n артелях (по текущему темпу и настрою)
  function seasonGain(seg, n) {
    const sv = S.view.segments[seg.id];
    const perCrew = C().balance.crews.workPerCrewPerSeason * sv.seasonMult * S.state.morale / 100;
    const left = sv.work - sv.workDone;
    return sv.work ? Math.min(left, n * perCrew) / sv.work * 100 : 0;
  }

  function schemeRow(seg) {
    const sv = S.view.segments[seg.id];
    const terr = Object.entries(seg.terrain).sort((a, b) => b[1] - a[1]).map(([t]) => TERRAIN_RU[t]).join(', ');
    const feats = (seg.features || []).map(f => C().map.features[f].kind === 'bridge' ? '⌒' : '⟋').join('');
    const gain = sv.opened ? 0 : seasonGain(seg, sv.crews);
    return `<div class="sg-row${sv.opened ? ' opened' : ''}">
      <span class="rail"><span class="rail-track${sv.opened ? ' done' : ''}">
        <i class="proj" data-proj="${seg.id}" style="height:${Math.min(100, sv.progress + gain)}%"></i>
        <i class="fill" style="height:${sv.progress}%"></i>
      </span></span>
      <div class="sg-body">
        <button class="sg-head" data-seg="${seg.id}" type="button">
          <span class="sg-meta">${sv.lengthKm} км · ${terr}${feats ? ` · ${feats}` : ''} ›</span>
          <span class="sg-pct">${sv.opened ? 'открыт' : `${Math.round(sv.progress)}%`}</span>
        </button>
        ${sv.opened ? '' : sliderHtml(seg)}
      </div>
    </div>`;
  }

  function sliderHtml(seg) {
    const sv = S.view.segments[seg.id];
    const gain = seasonGain(seg, sv.crews);
    return `<div class="sg-slider">
      <input type="range" min="0" max="${sv.maxCrews}" step="1" value="${sv.crews}" data-slider="${seg.id}" aria-label="Артели на участке ${esc(segName(seg))}">
      <span class="sg-crews"><b data-crews="${seg.id}">${sv.crews}</b> арт.<small data-gain="${seg.id}">${sv.crews ? `+${Math.round(gain)}% за сезон` : 'нет людей'}</small></span>
    </div>`;
  }

  // Бегунки: пока тянешь — только подписи и прогноз на схеме; при отпускании — отправка
  function bindSliders(el) {
    el.querySelectorAll('[data-slider]').forEach(inp => {
      const id = inp.dataset.slider;
      const seg = C().segById[id];
      let last = +inp.value;
      inp.addEventListener('input', () => {
        const sv = S.view.segments[id];
        const cap = Math.min(sv.maxCrews, sv.crews + S.view.freeCrews);
        let n = +inp.value;
        if (n > cap) { n = cap; inp.value = String(cap); }
        if (n !== last) { last = n; haptic('sel'); }
        const gain = seasonGain(seg, n);
        el.querySelectorAll(`[data-crews="${id}"]`).forEach(x => { x.textContent = n; });
        el.querySelectorAll(`[data-gain="${id}"]`).forEach(x => { x.textContent = n ? `+${Math.round(gain)}% за сезон` : 'нет людей'; });
        el.querySelectorAll(`[data-proj="${id}"]`).forEach(x => { x.style.height = `${Math.min(100, sv.progress + gain)}%`; });
        const free = S.view.freeCrews + sv.crews - n;
        el.querySelectorAll('[data-free]').forEach(x => { x.textContent = free; });
      });
      inp.addEventListener('change', () => setCrewsLocal(id, +inp.value));
    });
  }

  // Строка найма, закреплённая наверху панели: не нужно листать вниз
  function crewBar() {
    const s = S.state, v = S.view, b = C().balance;
    const hire5 = Math.min(5, v.hireLeft), dis5 = Math.min(5, v.freeCrews);
    return `<div class="crewbar">
      <div class="cb-row">
        <div class="cb-count"><span class="lbl">Артели</span><span><b data-free>${v.freeCrews}</b> своб. из ${s.crewsTotal}</span></div>
        <div class="cb-btns">
          <button class="mini" data-dismiss="${dis5}" ${dis5 < 1 ? 'disabled' : ''} aria-label="Распустить ${dis5}">−${dis5 || 5}</button>
          <button class="mini" data-dismiss="1" ${v.freeCrews < 1 ? 'disabled' : ''} aria-label="Распустить одну">−1</button>
          <span class="cb-sep"></span>
          <button class="mini" data-hire="1" ${v.hireLeft < 1 ? 'disabled' : ''} aria-label="Нанять одну">+1</button>
          <button class="mini" data-hire="${hire5}" ${hire5 < 1 ? 'disabled' : ''} aria-label="Нанять ${hire5}">+${hire5 || 5}</button>
        </div>
      </div>
      <div class="cb-note">найм ${b.crews.hireCostPerCrew} за артель · ${v.hireLeft ? `ещё ${v.hireLeft} в этот сезон` : 'в этот сезон больше не нанять'} · жалованье ${money(v.payPerSeason)} за сезон · распускаются только свободные</div>
    </div>`;
  }

  function crewsSection() {
    const s = S.state, b = C().balance;
    const pay = b.crews.pay;
    return `<div class="sect"><div class="sect-title">Оплата артелей</div>
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
      ${pet && s.unlocked.construction ? `<button class="btn ghost" data-petition ${s.petitionCooldown > 0 ? 'disabled' : ''}>Прошение о средствах: +${money(pet.amount)} в казну, благоволение ${s.favor} → ${Math.max(0, s.favor - pet.favorCost)}${s.petitionCooldown > 0 ? ` (через ${s.petitionCooldown} сез.)` : ''}</button>
        <div class="hint">${s.favor - pet.favorCost <= 0 ? 'Это прошение станет последним: благоволение кончится, и вас отстранят.' : s.favor - pet.favorCost <= favorRevision() ? `После прошения благоволение опустится до ${favorRevision()} и ниже — жди ревизии.` : `Ревизия приезжает при благоволении ${favorRevision()} и ниже, отставка — при 0.`}</div>` : ''}
      ${S.chapter === 'prologue' && TUT.off ? '<button class="btn ghost" data-tut-on type="button">Вернуть подсказки обучения</button>' : ''}
      <button class="link" data-home type="button">В меню</button>
    </div>`;
  }

  function bindCrewBar(el) {
    el.querySelectorAll('[data-hire]').forEach(b => b.addEventListener('click', async () => {
      flushCrews(); await waitCrews();
      await act({ type: 'HIRE_CREWS', amount: +b.dataset.hire });
      renderGame();
    }));
    el.querySelectorAll('[data-dismiss]').forEach(b => b.addEventListener('click', async () => {
      flushCrews(); await waitCrews();
      await act({ type: 'DISMISS_CREWS', amount: +b.dataset.dismiss });
      renderGame();
    }));
  }

  function bindCommon() {
    const el = $('panel');
    bindCrewBar(el);
    el.querySelectorAll('[data-pay]').forEach(b => b.addEventListener('click', () => act({ type: 'SET_PAY', level: b.dataset.pay }).then(renderGame)));
    el.querySelectorAll('[data-buy]').forEach(b => b.addEventListener('click', async () => {
      const r = await act({ type: 'BUY', itemId: b.dataset.buy, qty: 1 });
      renderGame();
      if (r) handleLog(r.log || []);
    }));
    el.querySelectorAll('[data-petition]').forEach(b => b.addEventListener('click', async () => {
      const pet = C().balance[S.chapter].petition;
      if (!(await confirmBox(`Подать прошение? Казна +${money(pet.amount)}, благоволение ${S.state.favor} → ${Math.max(0, S.state.favor - pet.favorCost)}.`))) return;
      const r = await act({ type: 'PETITION_FUNDS' });
      renderGame();
      if (r) handleLog(r.log || []);
    }));
    el.querySelectorAll('[data-home]').forEach(b => b.addEventListener('click', () => { flushCrews(); openHome(); }));
    el.querySelectorAll('[data-tut-on]').forEach(b => b.addEventListener('click', tutRestore));
  }

  function segmentPanel(seg) {
    const s = S.state, sv = S.view.segments[seg.id], c = C();
    const terr = Object.entries(seg.terrain).map(([t, sh]) => `${TERRAIN_RU[t]} ${Math.round(sh * 100)}%`).join(', ');
    const parts = [`<button class="link back" data-back type="button">← все участки</button>
      <h3>${esc(segName(seg))}</h3>
      <div class="sub">${sv.lengthKm} км · ${terr}${seg.directorate ? ` · ${seg.directorate === 'north' ? 'Северная' : 'Южная'} дирекция` : ''}</div>
      <div class="bar${sv.opened ? ' done' : ''}"><i class="proj-h" data-projh="${seg.id}" style="width:${sv.opened ? 0 : Math.min(100, sv.progress + seasonGain(seg, sv.crews))}%"></i><i style="width:${sv.progress}%"></i></div>
      <div class="kv"><span>${sv.opened ? 'Участок открыт' : 'Готовность'}</span><span>${Math.round(sv.progress)}%</span></div>`];
    if (!sv.opened) {
      parts.push(`<div class="kv"><span>Осталось работ / денег на материалы</span><span>${Math.round(sv.work - sv.workDone)} / ${money(sv.costLeft)}</span></div>
        <div class="kv"><span>Темп сезона (${SEASON_RU[s.season].toLowerCase()})</span><span>×${sv.seasonMult.toFixed(2)}</span></div>`);
      if (s.unlocked.construction) {
        parts.push(`<div class="sect"><div class="sect-title">Артели на участке (до ${sv.maxCrews})</div>
          ${sliderHtml(seg)}
          <div class="hint">Свободно <span data-free>${S.view.freeCrews}</span>. Прогноз на сезон учитывает время года и настрой.</div></div>`);
      }
    }
    const feats = seg.features || [];
    if (feats.length) {
      parts.push(`<div class="sect"><div class="sect-title">Особенности</div>`);
      for (const fid of feats) {
        const f = c.map.features[fid];
        const val = sv.features[fid];
        const label = { wooden: 'деревянный', iron: 'железный', steep: 'крутой уклон', bypass: 'обход', ferry: 'паром-ледокол', circum: 'обходная дорога' };
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
    bindSliders(el);
    el.querySelectorAll('[data-feat]').forEach(b => b.addEventListener('click', () =>
      act({ type: 'SET_FEATURE', segmentId: S.selected, feature: b.dataset.feat, value: b.dataset.val }).then(renderGame)));
  }

  // ================= факты =================
  // Легенды-версии (shownWith) показываем рядом с фактами, к которым они относятся
  function withVersions(refs) {
    const c = C();
    const out = [...refs];
    for (const f of c.facts) {
      if (!out.includes(f.id) && (f.shownWith || []).some(r => refs.includes(r))) out.push(f.id);
    }
    return out;
  }
  function factBody(f) {
    const tag = f.status === 'to_verify' ? '<span class="tag">уточняется</span> ' : f.status === 'legend' ? '<span class="tag legend">легенда</span> ' : '';
    const src = (f.sources || []).map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>`).join('; ');
    const note = f.status !== 'verified' && f.note ? `<div class="src">Примечание: ${esc(f.note)}</div>` : '';
    return `${tag}<div class="ft">${esc(f.text)}</div>${src ? `<div class="src">Источник: ${src}</div>` : ''}${note}`;
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
    if (S.state && S.chapter !== 'prologue' && S.state.unlocked.construction && !S.state.finished && !memoSeen() && !S.modalQueue.memo) {
      S.modalQueue.memo = true;
      S.modalQueue.push(() => { S.modalQueue.memo = false; showMemo(); });
    }
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
    openModal(`<div class="doc-head"><div><div class="kicker">Ведомость · доклад по строительству</div>
      <h2>Итоги ${SEASON_GEN[r.season]} ${r.year} года</h2></div>${DECOR.seal(String(r.year))}</div>
      ${DECOR.rule('✦')}
      <div class="ledger">${lines.join('')}</div>${progHtml}${notes.join('')}
      ${DECOR.signature('Составил', 'главный инженер')}
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
    const order = ['spring', 'summer', 'autumn', 'winter'];
    const now = S.state.year * 4 + order.indexOf(S.state.season);
    if (a.active_from && now < a.active_from.year * 4 + order.indexOf(a.active_from.season)) return false;
    if (a.active_until && now >= a.active_until.year * 4 + order.indexOf(a.active_until.season)) return false;
    return true;
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

  const EVENT_ADVISOR_KEY = { E18: 'revision', T14: 'revision' };

  // Иллюстрация к событию: архивное изображение (если есть) или рисунок игры
  function plateHtml(evId) {
    const ill = C().illustrations || { drawings: [], archive: [] };
    const arch = (ill.archive || []).find(a => (a.events || []).includes(evId));
    if (arch) {
      const lic = { 'public-domain': 'общественное достояние', CC0: 'CC0', 'CC-BY': 'CC BY', 'CC-BY-SA': 'CC BY-SA' }[arch.license] || arch.license;
      return `<figure class="plate archive"><div class="ph"><img src="${esc(arch.file)}" alt="${esc(arch.title)}"></div>
        <figcaption>${esc(arch.title)}. ${esc(arch.author)}${arch.year ? `, ${esc(arch.year)}` : ''}. <a href="${esc(arch.source.url)}" target="_blank" rel="noopener">${esc(arch.source.title)}</a> · ${esc(lic)}</figcaption></figure>`;
    }
    const d = (ill.drawings || []).find(x => (x.events || []).includes(evId));
    if (!d || !window.KoleyaPlates) return '';
    return `<figure class="plate drawing">${window.KoleyaPlates.draw(d.plate, d.arg)}<figcaption>Рисунок игры</figcaption></figure>`;
  }

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
    const inNo = (s.firedEvents.length + s.pendingEvents.length) * 7 + s.turn + 101;
    openModal(`<div class="doc-head"><div><div class="kicker">${kicker} · ${SEASON_RU[s.season].toLowerCase()} ${s.year}</div>
      <div class="stamp">Входящая № ${inNo}</div></div>${DECOR.seal('')}</div>
      ${plateHtml(ev.id)}
      <h2>${esc(ev.title)}</h2>
      ${isLegend ? '<span class="tag legend">слух · легенда</span>' : ''}
      <div class="text">${esc(ev.text)}</div>
      ${intro}
      ${!isLegend && (ev.fact_refs || []).length ? `<div class="facts">${factsHtml(ev.fact_refs)}</div>` : ''}
      ${DECOR.rule('❧')}
      ${choices}
      ${DECOR.signature('Канцелярия строительства', 'к исполнению')}`, d => d.querySelectorAll('[data-choice]').forEach(b => b.addEventListener('click', () => choose(ev, b.dataset.choice))));
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
      ${DECOR.rule('❦')}
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
    // Лента пути: станции по доле пройденного времени, паровозик едет по ней
    let acc = 0;
    const total = run.legs.reduce((a, l) => a + l.minutes, 0) || 1;
    const ticks = run.legs.filter(l => l.segment).map(l => {
      acc += l.minutes;
      return `<i class="rt-stop" style="left:${(acc / total * 100).toFixed(1)}%"><span>${esc(c.nodesById[l.to].name.replace(/\s*\(.+\)/, ''))}</span></i>`;
    }).join('');
    const ride = `<div class="ride"><div class="rt-line"></div>${ticks}<div class="rt-train">${DECOR.loco()}</div></div>`;
    openModal(`<div class="kicker">Первый поезд</div>
      <h2>${esc(c.nodesById[c.map.historical.firstRun.from].name.replace(/\s*\(.+\)/, ''))} — ${esc(c.nodesById[c.map.historical.firstRun.to].name)}</h2>
      ${ride}
      <div class="bigtime" data-count="${run.minutes}">${hm(reducedMotion ? run.minutes : 0)}</div>
      <div class="compare">${run.historicalMinutes ? `Исторически — ${hm(run.historicalMinutes)}. ${diff === 0 ? 'Ровно как тогда.' : diff < 0 ? `Вы быстрее на ${hm(-diff)}.` : `Вы медленнее на ${hm(diff)}.`} ` : ''}Путь ${run.km} км, стоянок ${run.stops}.</div>
      <div style="margin-top:10px">${legs}</div>${extra}
      <div class="facts">${factsHtml([c.map.historical.firstRun.fact_ref])}</div>
      <button class="btn" data-next>Далее</button>`, d => {
        d.querySelector('[data-next]').addEventListener('click', () => { haptic('tap'); nextModal(); });
        const svgEl = d.querySelector('.rt-train svg');
        if (svgEl) svgEl.classList.add('anim');
        // Часы в пути отсчитываются синхронно с поездом
        const el = d.querySelector('[data-count]');
        if (el && !reducedMotion) {
          const target = +el.dataset.count, t0 = performance.now(), dur = 3200;
          const tick = now => {
            const k = Math.min(1, (now - t0) / dur);
            el.textContent = hm(Math.round(target * (1 - Math.pow(1 - k, 2))));
            if (k < 1) requestAnimationFrame(tick); else { haptic('ok'); el.classList.add('arrived'); }
          };
          requestAnimationFrame(tick);
        }
      });
  }

  function showFinished() {
    closeModal();
    renderFinal();
    show('s-final');
    haptic(S.state.outcome === 'won' || S.state.outcome === 'halted' ? 'ok' : 'bad');
  }

  const SCALE_RU = {
    deadline: ['Сроки', sc => sc.value === 0 ? 'Открыли к сроку' : `Опоздание: ${sc.value} сез.`],
    treasury: ['Казна', sc => `Израсходовано ${money(sc.value)} при плане ${money(sc.plan)}`],
    reliability: ['Надёжность', sc => sc.value ? `Происшествий: ${sc.value}` : 'Без происшествий'],
    speed: ['Скорость', sc => `Первый поезд: ${hm(sc.value)} против ${hm(sc.historical)}`],
    history: ['Как в истории', sc => `Совпало ключевых решений: ${sc.value} из ${sc.of}`],
  };
  const starsHtml = n => `<span class="stars">${'★'.repeat(n)}<span class="off">${'★'.repeat(5 - n)}</span></span>`;

  function renderFinal() {
    const s = S.state, c = C();
    const el = $('s-final');
    // Финал главы после пролога — сразу «как было», без ожидания модалок
    if (s.outcome === 'halted') {
      // Глава, которую нельзя пройти: стройку останавливают извне, как в истории
      el.innerHTML = `<h2 class="sheet-title">${esc(c.map.title)}: стройка остановлена</h2>
        <div class="history"><div class="h">Эту главу нельзя было пройти</div><div class="t">Так было и в истории: магистраль не достроили. Вы успели построить ${Math.round(S.view.overallProgress)}% трассы к ${SEASON_GEN[s.season]} ${s.year} года.</div></div>
        <h3 class="sheet-title" style="font-size:21px;margin-top:18px">Ваши решения и история</h3>
        ${comparisonHtml()}
        <h3 class="sheet-title" style="font-size:21px;margin-top:18px">Что было дальше</h3>
        ${afterwordHtml()}
        ${c.quizAvailable ? `<button class="btn route" data-quiz>${S.quiz && S.quiz.done ? 'Итоги викторины' : 'Викторина главы'}</button>` : ''}
        <button class="btn ghost" data-museum>Музей</button>
        <button class="btn ghost" data-home>В меню</button>`;
    } else if (s.outcome !== 'won') {
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
      const scaleName = x => (x.id === 'history' && c.map.historyScaleLabel) || SCALE_RU[x.id][0];
      const scales = sc.scales.map(x => `<div class="scale"><span>${scaleName(x)}</span>${starsHtml(x.stars)}<span class="sd">${esc(SCALE_RU[x.id][1](x))}</span></div>`).join('');
      el.innerHTML = `<h2 class="sheet-title">${esc(c.map.title)}: глава пройдена</h2>
        <div class="kv"><span>Итог</span><span>${sc.total} из ${sc.max} ★</span></div>
        ${scales}
        <h3 class="sheet-title" style="font-size:21px;margin-top:18px">Как было на самом деле</h3>
        ${S.chapter === 'prologue' ? `<div class="history" style="margin-top:14px"><div class="h">Обучение пройдено</div><div class="t">В главе I всё то же, но крупнее: двенадцать участков и две дирекции, срок — осень 1851 года, решения о трассе, колее и мостах. Следите за календарём и не держите артели без дела.</div></div>` : ''}
        ${comparisonHtml()}
        ${epilogueHtml()}
        ${S.chapter === 'prologue' || !c.quizAvailable ? '' : `<button class="btn route" data-quiz>${S.quiz && S.quiz.done ? 'Итоги викторины' : 'Викторина главы'}</button>`}
        ${nextChapter(S.chapter) ? `<button class="btn${S.chapter === 'prologue' ? ' route' : ' ghost'}" data-next-chapter>К следующей главе: ${esc(CHAPTER_INFO[nextChapter(S.chapter)].title)}</button>` : ''}
        <button class="btn ghost" data-museum>Музей</button>
        <button class="btn ghost" data-home>В меню</button>`;
    }
    el.querySelectorAll('[data-home]').forEach(b => b.addEventListener('click', openHome));
    el.querySelectorAll('[data-restart]').forEach(b => b.addEventListener('click', () => startChapter(S.chapter)));
    el.querySelectorAll('[data-quiz]').forEach(b => b.addEventListener('click', openQuiz));
    el.querySelectorAll('[data-museum]').forEach(b => b.addEventListener('click', openMuseum));
    el.querySelectorAll('[data-next-chapter]').forEach(b => b.addEventListener('click', () => startChapter(nextChapter(S.chapter))));
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

  // Хронология после остановки стройки: события главы с пометкой epilogue, в порядке показа
  function afterwordHtml() {
    const c = C();
    const evs = S.state.firedEvents.map(id => c.eventsById[id]).filter(e => e && e.epilogue);
    return evs.map(e => `<div class="history" style="margin-top:12px"><div class="h">${esc(e.title)}</div><div class="t">${esc(e.text)}</div></div>
      <div class="facts">${factsHtml(e.fact_refs || [])}</div>`).join('') || '';
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
  $('btn-about').addEventListener('click', () => { haptic('tap'); renderAboutTut(); show('s-about'); });
  $('btn-about-tut').addEventListener('click', tutRestore);
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
