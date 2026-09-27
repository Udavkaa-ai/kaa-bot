// Гравированные рисунки игры («таблицы»): собственные иллюстрации, не архивные.
// Всё — штриховая SVG-графика 240×120, цвета — классами из токенов темы (style.css).
// Анимации внутри рисунков — только CSS и выключаются при prefers-reduced-motion.
(function () {
  'use strict';
  const W = 240, H = 120;
  const f = n => n.toFixed(1);
  const range = (n, fn) => Array.from({ length: n }, (_, i) => fn(i)).join('');

  // ---------- общие элементы ----------
  const ground = (y = 100) => `<line x1="0" y1="${y}" x2="${W}" y2="${y}" class="p-ink"/>` +
    range(26, i => `<line x1="${4 + i * 9.2}" y1="${y + 3}" x2="${9 + i * 9.2}" y2="${y + 3}" class="p-thin"/>`);
  const fir = (x, y, h) => {
    const w = h * 0.42;
    return `<g class="p-ink">${range(3, i => {
      const t = y - h + i * h * 0.28, b = t + h * 0.42;
      return `<path d="M${f(x)} ${f(t)} L${f(x - w * (0.55 + i * 0.22))} ${f(b)} L${f(x + w * (0.55 + i * 0.22))} ${f(b)} Z" class="p-paper"/>`;
    })}<line x1="${x}" y1="${y - h * 0.15}" x2="${x}" y2="${y}"/>${range(4, i => `<line x1="${f(x - 2 + i)}" y1="${f(y - h + 8 + i * 6)}" x2="${f(x - 6 - i * 2)}" y2="${f(y - h + 14 + i * 6)}" class="p-thin"/>`)}</g>`;
  };
  const person = (x, y, { lean = 0, hat = true, armTo = null, legSpread = 5 } = {}) => {
    const hx = x + lean, hy = y - 52;
    let s = `<circle cx="${f(hx)}" cy="${f(hy)}" r="4.2" class="p-paper p-ink"/>`;
    if (hat) s += `<path d="M${f(hx - 6)} ${f(hy - 3.5)} H${f(hx + 6)} M${f(hx - 3.5)} ${f(hy - 3.5)} V${f(hy - 8)} H${f(hx + 3.5)} V${f(hy - 3.5)}" class="p-ink"/>`;
    s += `<path d="M${f(hx)} ${f(hy + 4)} L${f(x)} ${f(y - 24)}" class="p-ink p-thick"/>`;
    s += `<path d="M${f(x)} ${f(y - 24)} L${f(x - legSpread)} ${y} M${f(x)} ${f(y - 24)} L${f(x + legSpread)} ${y}" class="p-ink"/>`;
    const ax = armTo ? armTo[0] : x + lean + 8, ay = armTo ? armTo[1] : y - 36;
    s += `<path d="M${f(hx)} ${f(hy + 9)} L${f(ax)} ${f(ay)}" class="p-ink"/>`;
    return `<g>${s}</g>`;
  };
  const waves = (y, cls = 'p-water') => `<g class="${cls} p-waves">${range(9, i => `<path d="M${-30 + i * 34} ${y} q8 -4 16 0 t16 0" />`)}</g>`;
  const smoke = (x, y) => `<g class="p-smoke">${range(4, i => `<circle class="puff q${i + 1}" cx="${x}" cy="${y}" r="4.5"/>`)}</g>`;
  const svg = (body, label) => `<svg class="plate-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">${body}</svg>`;

  const plates = {
    // Указ, депеша: лист с текстом, печать, перо и чернильница
    decree() {
      return svg(`
        <g transform="rotate(-4 120 60)">
          <rect x="62" y="14" width="112" height="88" class="p-paper p-ink"/>
          <path d="M62 14 l6 -5 h112 v88 l-6 5" class="p-ink p-thin"/>
          <line x1="76" y1="30" x2="160" y2="30" class="p-ink p-thick"/>
          ${range(7, i => `<line x1="76" y1="${42 + i * 7}" x2="${i === 6 ? 128 : 160}" y2="${42 + i * 7}" class="p-thin p-ink"/>`)}
          <circle cx="150" cy="88" r="9" class="p-wax"/><circle cx="150" cy="88" r="5.5" class="p-wax-ring"/>
        </g>
        <path d="M186 104 c12 -30 22 -52 40 -78 c-6 18 -14 36 -34 70 z" class="p-paper p-ink"/>
        <path d="M188 100 L222 30" class="p-thin p-ink"/>
        ${range(6, i => `<line x1="${f(196 + i * 4)}" y1="${f(86 - i * 9)}" x2="${f(204 + i * 4)}" y2="${f(84 - i * 9)}" class="p-thin p-ink"/>`)}
        <path d="M24 104 h26 l-3 -16 h-20 z" class="p-fill"/><ellipse cx="37" cy="88" rx="10" ry="2.5" class="p-paper p-ink"/>
        ${ground(106)}`, 'Лист указа с печатью, перо и чернильница');
    },
    // Изыскания: теодолит на треноге, изыскатель, реечник с полосатой рейкой, лес
    survey() {
      return svg(`
        ${fir(18, 100, 46)}${fir(40, 100, 34)}${fir(226, 100, 40)}
        <path d="M90 60 L78 100 M90 60 L91 100 M90 60 L103 100" class="p-ink"/>
        <rect x="83" y="52" width="14" height="8" class="p-fill"/>
        <line x1="78" y1="54" x2="106" y2="50" class="p-ink p-thick"/>
        ${person(114, 100, { lean: -2, armTo: [104, 52] })}
        <line x1="190" y1="38" x2="190" y2="100" class="p-ink p-thick"/>
        ${range(6, i => `<line x1="190" y1="${40 + i * 10}" x2="190" y2="${45 + i * 10}" class="p-route p-thick"/>`)}
        ${person(180, 100, { armTo: [189, 60], legSpread: 4 })}
        <path d="M106 51 L186 47" class="p-dash"/>
        ${ground()}`, 'Изыскатели с теодолитом и рейкой');
    },
    // Землекопы: насыпь, тачка с крутящимся колесом, рабочий с лопатой
    navvies() {
      return svg(`
        <path d="M10 100 L58 70 L186 70 L232 100 Z" class="p-paper p-ink"/>
        ${range(12, i => `<line x1="${f(16 + i * 4)}" y1="${f(97 - i * 2.4)}" x2="${f(24 + i * 4)}" y2="${f(97 - i * 2.4)}" class="p-thin p-ink"/>`)}
        ${range(12, i => `<line x1="${f(224 - i * 4)}" y1="${f(97 - i * 2.4)}" x2="${f(216 - i * 4)}" y2="${f(97 - i * 2.4)}" class="p-thin p-ink"/>`)}
        ${person(96, 70, { lean: 7, armTo: [112, 58] })}
        <path d="M112 58 L132 54 L148 60 L140 66 L118 64 Z" class="p-fill"/>
        <line x1="108" y1="57" x2="120" y2="60" class="p-ink"/>
        <g class="p-wheel"><circle cx="146" cy="65" r="5" class="p-paper p-ink"/><path d="M141 65 H151 M146 60 V70" class="p-thin p-ink"/></g>
        ${person(176, 70, { lean: -6, armTo: [188, 62] })}
        <path d="M188 62 L196 76" class="p-ink p-thick"/><path d="M193 74 l6 4 l-3 3 z" class="p-fill"/>
        <path d="M200 70 q6 -9 14 0 z" class="p-fill"/>
        ${ground()}`, 'Землекопы на насыпи с тачкой и лопатой');
    },
    // Ферменный мост над рекой; iron — многоугольный пояс и частая решётка
    bridge(kind = 'wooden') {
      const top = kind === 'iron'
        ? `<path d="M28 72 L60 50 L120 42 L180 50 L212 72" class="p-ink p-thick"/>`
        : `<line x1="28" y1="48" x2="212" y2="48" class="p-ink p-thick"/>`;
      const yTop = x => kind === 'iron' ? (x < 60 ? 72 - (x - 28) * 22 / 32 : x < 120 ? 50 - (x - 60) * 8 / 60 : x < 180 ? 42 + (x - 120) * 8 / 60 : 50 + (x - 180) * 22 / 32) : 48;
      const panels = kind === 'iron' ? 12 : 9;
      const step = 184 / panels;
      let web = '';
      for (let i = 0; i <= panels; i++) {
        const x = 28 + i * step;
        web += `<line x1="${f(x)}" y1="${f(yTop(x))}" x2="${f(x)}" y2="72" class="p-thin p-ink"/>`;
        if (i < panels) {
          const x2 = x + step;
          web += `<line x1="${f(x)}" y1="${f(yTop(x))}" x2="${f(x2)}" y2="72" class="p-ink"/>`;
          web += `<line x1="${f(x2)}" y1="${f(yTop(x2))}" x2="${f(x)}" y2="72" class="p-ink"/>`;
        }
      }
      return svg(`
        <path d="M0 72 L28 72 L20 104 L0 104 Z M240 72 L212 72 L220 104 L240 104 Z" class="p-paper p-ink"/>
        ${range(6, i => `<line x1="${2 + i * 3}" y1="${80 + i * 4}" x2="${10 + i * 3}" y2="${80 + i * 4}" class="p-thin p-ink"/>`)}
        <rect x="112" y="72" width="16" height="34" class="p-paper p-ink"/>
        ${range(5, i => `<line x1="112" y1="${78 + i * 6}" x2="128" y2="${78 + i * 6}" class="p-thin p-ink"/>`)}
        ${top}<line x1="28" y1="72" x2="212" y2="72" class="p-ink p-thick"/>${web}
        <line x1="0" y1="70" x2="240" y2="70" class="p-route"/>
        <rect x="0" y="92" width="240" height="28" class="p-water-fill"/>
        ${waves(98)}${waves(108)}`, kind === 'iron' ? 'Железный ферменный мост' : 'Деревянный ферменный мост');
    },
    // Первый поезд у платформы: вокзал, публика, флаг, паровоз с дымом
    station() {
      return svg(`
        <rect x="160" y="44" width="70" height="46" class="p-paper p-ink"/>
        <path d="M154 46 L195 22 L236 46 Z" class="p-paper p-ink"/>
        ${range(3, i => `<rect x="${168 + i * 20}" y="56" width="10" height="16" class="p-fill"/>`)}
        <line x1="195" y1="22" x2="195" y2="8" class="p-ink"/><path d="M195 8 h12 l-3 4 l3 4 h-12" class="p-route-fill p-flag"/>
        <rect x="100" y="86" width="140" height="6" class="p-paper p-ink"/>
        ${person(120, 86, {})}${person(134, 86, { lean: 1 })}${person(148, 86, { hat: false, armTo: [154, 66] })}
        ${smoke(26, 36)}
        <g class="p-ink">
          <path d="M20 40 h14 l-3 10 h-8 z" class="p-fill"/><rect x="23" y="50" width="6" height="10" class="p-paper"/>
          <rect x="14" y="60" width="62" height="16" rx="8" class="p-paper"/>
          ${range(8, i => `<line x1="${20 + i * 7}" y1="62" x2="${20 + i * 7}" y2="74" class="p-thin"/>`)}
          <rect x="74" y="50" width="20" height="30" class="p-paper"/><rect x="78" y="55" width="10" height="7" class="p-paper"/>
          <line x1="8" y1="80" x2="96" y2="80"/>
          <g class="p-wheel"><circle cx="30" cy="86" r="7" class="p-paper"/><path d="M23 86 H37 M30 79 V93" class="p-thin"/></g>
          <g class="p-wheel"><circle cx="58" cy="84" r="9" class="p-paper"/><path d="M49 84 H67 M58 75 V93" class="p-thin"/></g>
          <g class="p-wheel"><circle cx="84" cy="86" r="7" class="p-paper"/><path d="M77 86 H91 M84 79 V93" class="p-thin"/></g>
        </g>
        ${ground(94)}`, 'Первый поезд у платформы');
    },
    // Паром-ледокол на озере: горы, льдины, вагоны на палубе
    ferry() {
      return svg(`
        <path d="M0 64 L28 30 L52 52 L80 20 L112 56 L138 34 L170 60 L200 28 L240 58 L240 64 Z" class="p-paper p-ink"/>
        ${range(14, i => `<line x1="${f(30 + i * 14)}" y1="${f(44 + (i % 3) * 5)}" x2="${f(36 + i * 14)}" y2="${f(52 + (i % 3) * 5)}" class="p-thin p-ink"/>`)}
        <rect x="0" y="64" width="240" height="56" class="p-water-fill"/>
        ${waves(76)}${waves(92)}${waves(108)}
        <g class="p-ship">
          ${smoke(104, 40)}${smoke(124, 42)}
          <path d="M60 84 L196 84 L184 100 L72 100 Z" class="p-paper p-ink"/>
          <rect x="100" y="48" width="8" height="20" class="p-fill"/><rect x="120" y="50" width="8" height="18" class="p-fill"/>
          <rect x="84" y="68" width="92" height="16" class="p-paper p-ink"/>
          ${range(4, i => `<rect x="${88 + i * 22}" y="71" width="18" height="10" class="p-paper p-ink"/>`)}
          ${range(10, i => `<circle cx="${80 + i * 11}" cy="92" r="1.6" class="p-fill"/>`)}
        </g>
        <path d="M14 104 l14 -4 l10 4 l-8 4 z M200 110 l16 -5 l12 5 l-10 3 z M30 88 l12 -3 l8 3 l-8 3 z" class="p-paper p-ink"/>`, 'Паром-ледокол на озере среди гор');
    },
    // Зимний лагерь: бараки с дымом, падающий снег, ели
    winter() {
      return svg(`
        ${fir(20, 100, 44)}${fir(222, 100, 50)}${fir(200, 100, 32)}
        <rect x="60" y="66" width="56" height="34" class="p-paper p-ink"/><path d="M54 68 L88 48 L122 68 Z" class="p-paper p-ink"/>
        <rect x="128" y="72" width="46" height="28" class="p-paper p-ink"/><path d="M122 74 L151 56 L180 74 Z" class="p-paper p-ink"/>
        ${range(6, i => `<line x1="60" y1="${72 + i * 5}" x2="116" y2="${72 + i * 5}" class="p-thin p-ink"/>`)}
        <rect x="80" y="84" width="10" height="16" class="p-fill"/><rect x="100" y="76" width="8" height="7" class="p-route-fill p-window"/>
        <rect x="96" y="44" width="5" height="12" class="p-fill"/>${smoke(98, 40)}
        <rect x="160" y="54" width="4" height="10" class="p-fill"/>${smoke(162, 50)}
        <g class="p-snow">${range(28, i => `<circle cx="${(i * 37) % 236 + 2}" cy="${(i * 23) % 100}" r="${i % 3 ? 1 : 1.5}" class="flake f${i % 4}"/>`)}</g>
        ${ground()}`, 'Зимние бараки строителей под снегом');
    },
    // Паводок: размытая насыпь, погнутые рельсы, дождь, вода
    flood() {
      return svg(`
        <path d="M0 26 q20 -14 40 -2 q18 -14 36 0 q22 -12 40 2 q16 -10 34 0 q24 -14 44 0 q20 -10 46 0 v-26 H0 Z" class="p-paper p-ink"/>
        <g class="p-rain">${range(30, i => `<line x1="${(i * 29) % 240}" y1="${30 + (i * 17) % 30}" x2="${(i * 29) % 240 - 4}" y2="${38 + (i * 17) % 30}" class="drop d${i % 3}"/>`)}</g>
        <path d="M0 80 L70 64 L96 64 L108 80 Z M240 80 L170 64 L150 64 L136 80 Z" class="p-paper p-ink"/>
        <path d="M0 62 L70 62 Q110 90 150 62 L240 62" class="p-ink p-thick"/><path d="M0 58 L70 58 Q110 86 150 58 L240 58" class="p-ink"/>
        <rect x="0" y="80" width="240" height="40" class="p-water-fill"/>
        ${waves(86)}${waves(98)}${waves(110)}
        <path d="M112 84 l14 -6 l6 8 l-10 4 z" class="p-paper p-ink"/>`, 'Паводок размыл насыпь');
    },
    // Колея: два рельса в разрезе на шпале и размер между ними
    gauge() {
      const rail = x => `<path d="M${x - 8} 74 h16 v-4 h-6 v-16 h5 v-6 h-14 v6 h5 v16 h-6 z" class="p-paper p-ink"/>`;
      return svg(`
        <rect x="24" y="74" width="192" height="12" class="p-paper p-ink"/>
        ${range(18, i => `<line x1="${28 + i * 10.5}" y1="76" x2="${34 + i * 10.5}" y2="84" class="p-thin p-ink"/>`)}
        ${rail(70)}${rail(170)}
        <path d="M70 34 V44 M170 34 V44 M70 38 H170" class="p-route"/>
        <path d="M70 38 l7 -3 v6 z M170 38 l-7 -3 v6 z" class="p-route-fill"/>
        <text x="120" y="30" text-anchor="middle" class="p-label">ширина колеи</text>
        ${range(9, i => `<line x1="${70 + i * 12.5}" y1="96" x2="${70 + i * 12.5}" y2="${i % 2 ? 100 : 103}" class="p-thin p-ink"/>`)}
        <line x1="70" y1="96" x2="170" y2="96" class="p-ink"/>
        ${ground(108)}`, 'Рельсы в разрезе и ширина колеи');
    },
  };

  window.KoleyaPlates = { draw: (name, arg) => (plates[name] ? plates[name](arg) : ''), names: Object.keys(plates) };
})();
