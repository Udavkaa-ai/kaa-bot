// Рисунки игры в духе картонного театра теней: силуэты на подсвеченном заднике,
// три плана глубины, кулисы и падуга. Собственные иллюстрации, не архивные.
// Сцена 240×120; цвета — классами из токенов темы (style.css), в разметке цветов нет.
// Движение — SMIL внутри SVG (повороты вокруг шарниров фигур); при
// prefers-reduced-motion анимации не выводятся вовсе.
(function () {
  'use strict';
  const W = 240, H = 120, FLOOR = 104;
  const f = n => (+n).toFixed(1);
  const range = (n, fn) => Array.from({ length: n }, (_, i) => fn(i)).join('');
  let uid = 0;
  let still = false;

  // ---------- движение ----------
  const ease = n => Array(n).fill('.45 0 .55 1').join(';');
  // Покачивание вокруг точки (шарнир): угол a → b → a
  const swing = (a, b, cx, cy, dur, begin = 0) => still ? '' :
    `<animateTransform attributeName="transform" type="rotate" additive="sum" values="${a} ${cx} ${cy};${b} ${cx} ${cy};${a} ${cx} ${cy}" keyTimes="0;.5;1" calcMode="spline" keySplines="${ease(2)}" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/>`;
  const drift = (dx, dy, dur, begin = 0) => still ? '' :
    `<animateTransform attributeName="transform" type="translate" additive="sum" values="0 0;${dx} ${dy};0 0" keyTimes="0;.5;1" calcMode="spline" keySplines="${ease(2)}" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/>`;
  const slide = (from, to, dur, begin = 0) => still ? '' :
    `<animateTransform attributeName="transform" type="translate" additive="sum" values="${from};${to}" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/>`;
  const spin = (cx, cy, dur) => still ? '' :
    `<animateTransform attributeName="transform" type="rotate" values="0 ${cx} ${cy};360 ${cx} ${cy}" dur="${dur}s" repeatCount="indefinite"/>`;
  const flicker = (vals, dur, begin = 0) => still ? '' :
    `<animate attributeName="opacity" values="${vals}" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/>`;

  // ---------- сцена ----------
  function stage(body, label, { lamp = [0.55, 0.35], sun = [0.78, 0.42] } = {}) {
    const id = `kp${++uid}`;
    const valance = `M0 0 H240 V5 ${range(16, () => 'q-7.5 7 -15 0')} Z`;
    return `<svg class="plate-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">
      <defs>
        <linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="s-sky0"/><stop offset=".75" class="s-sky1"/></linearGradient>
        <radialGradient id="${id}l" cx="${lamp[0]}" cy="${lamp[1]}" r=".75"><stop offset="0" class="s-lamp0"/><stop offset=".55" class="s-lamp0"/><stop offset="1" class="s-lamp1"/></radialGradient>
      </defs>
      <rect width="${W}" height="${H}" fill="url(#${id}s)"/>
      <g class="s-poster">
        <path d="M${f(W * sun[0])} ${f(H * sun[1])} L240 0 H196 Z M${f(W * sun[0])} ${f(H * sun[1])} L240 60 V30 Z M${f(W * sun[0])} ${f(H * sun[1])} L150 0 H120 Z" class="s-ray"/>
        <circle cx="${f(W * sun[0])}" cy="${f(H * sun[1])}" r="30" class="s-sun"/>
      </g>
      ${body}
      <rect width="${W}" height="${H}" fill="url(#${id}l)"/>
      <g class="s-near s-curtain">
        <path d="${valance}"/>
        <path d="M0 0 H14 C9 30 13 70 7 120 H0 Z"/><path d="M240 0 H226 C231 30 227 70 233 120 H240 Z"/>
        <path d="M0 116 H240 V120 H0 Z"/>
      </g>
      <g class="st s-fold"><path d="M5 8 C4 40 6 80 3 118" stroke-width=".5"/><path d="M235 8 C236 40 234 80 237 118" stroke-width=".5"/></g>
    </svg>`;
  }

  // ---------- декорации ----------
  const fir = (x, y, h) => {
    const w = h * 0.36;
    let d = '';
    for (let i = 0; i < 4; i++) {
      const top = y - h + i * h * 0.2, bot = top + h * 0.34, half = w * (0.42 + i * 0.2);
      d += `M${f(x)} ${f(top)} L${f(x - half)} ${f(bot)} Q${f(x)} ${f(bot - 3)} ${f(x + half)} ${f(bot)} Z `;
    }
    return `<path d="${d} M${f(x - 1.2)} ${f(y - h * 0.2)} h2.4 V${y} h-2.4 Z"/>`;
  };
  const firs = (xs, y, h) => xs.map((x, i) => fir(x, y, h * (0.75 + ((i * 7) % 5) / 10))).join('');
  const hills = (y, amp, seed) => {
    let d = `M0 ${y}`;
    for (let i = 0; i <= 8; i++) d += ` Q${i * 30 + 15} ${f(y - amp * (0.5 + Math.abs(Math.sin(seed + i * 1.7))))} ${(i + 1) * 30} ${f(y - amp * 0.2 * Math.cos(seed + i))}`;
    return `<path d="${d} V120 H0 Z"/>`;
  };
  const ground = (y = FLOOR) => `<path d="M0 ${y} H240 V120 H0 Z"/>`;
  const birds = (pts) => pts.map(([x, y, s], i) => `<g>${drift(3, -2, 3 + i)}<path d="M${x} ${y} q${2 * s} ${-2 * s} ${4 * s} 0 q${2 * s} ${-2 * s} ${4 * s} 0" class="st" stroke-width=".8"/></g>`).join('');
  const puffs = (x, y, n = 4, big = 1) => `<g class="s-smoke">${range(n, i => still
    ? `<circle cx="${f(x + i * 6 * big)}" cy="${f(y - i * 6 * big)}" r="${f((2.5 + i * 1.6) * big)}" opacity="${f(0.55 - i * 0.1)}"/>`
    : `<circle cx="${x}" cy="${y}" r="2" opacity="0">
        <animate attributeName="r" values="${f(2 * big)};${f(8 * big)}" dur="3s" begin="${i * 0.75}s" repeatCount="indefinite"/>
        <animate attributeName="cx" values="${x};${f(x + 26 * big)}" dur="3s" begin="${i * 0.75}s" repeatCount="indefinite"/>
        <animate attributeName="cy" values="${y};${f(y - 24 * big)}" dur="3s" begin="${i * 0.75}s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values=".7;0" dur="3s" begin="${i * 0.75}s" repeatCount="indefinite"/>
      </circle>`)}</g>`;
  const waves = (y, amp, dur, cls) => `<g class="${cls}"><g>${slide('0 0', '-40 0', dur)}<path d="M-10 ${y} ${range(9, () => `q10 ${-amp} 20 0 q10 ${amp} 20 0`)} V120 H-10 Z"/></g></g>`;

  // ---------- фигура-марионетка ----------
  // Ноги в точке (x, y), лицом вправо (dir = 1) или влево (-1). Локальный рост ~48.
  // arms — список рук [[локоть], [кисть], props?, anim?]; props рисуются в системе руки.
  function figure(x, y, o = {}) {
    const { dir = 1, k = 1, hat = 'top', coat = 'frock', lean = 0, legs = 'stand', arms = [], rod = true, sway = 0, extra = '' } = o;
    const sh = [lean * 0.8, -38];
    const legPath = {
      stand: 'M-1.6 -19 L-3 -1 M1.6 -19 L2.8 -1',
      walk: 'M-1.4 -19 L-6 -9 L-8 -1 M1.4 -19 L4 -9 L7 -1',
      brace: 'M-1.4 -19 L-7 -1 M1.6 -19 L6 -10 L8 -1',
      kneel: 'M-1.4 -19 L-9 -12 L-9 -1 M1.6 -19 L6 -8 L3 -1',
    }[legs];
    const coatPath = coat === 'frock'
      ? `M${f(sh[0] - 5)} -39 L${f(sh[0] + 5)} -39 L6.5 -26 L8.5 -15 L-8.5 -15 L-6.5 -26 Z`
      : coat === 'shirt'
        ? `M${f(sh[0] - 5.2)} -39 L${f(sh[0] + 5.2)} -39 L6.4 -19 L-6.4 -19 Z`
        : `M${f(sh[0] - 5.5)} -39 L${f(sh[0] + 5.5)} -39 L9 -8 L-9 -8 Z`; // тулуп, шинель
    const hx = sh[0] + lean * 0.3, hy = -45;
    const hats = {
      top: `M${f(hx - 3.6)} ${hy - 3} h7.4 l-.4 -7 h-6.6 Z M${f(hx - 5.6)} ${hy - 3.4} h11.4 v1.4 h-11.4 Z`,
      cap: `M${f(hx - 4.3)} ${hy - 2.4} q0 -4.8 4.4 -4.8 q4.4 0 4.6 4.8 Z M${f(hx + 2.5)} ${hy - 3.1} h5 v1.2 h-5 Z`,
      fur: `M${f(hx - 5)} ${hy - 1} q0 -6.5 5 -6.5 q5 0 5 6.5 v2 h-10 Z`,
      helmet: `M${f(hx - 4.6)} ${hy - 1.6} q0 -5.6 4.6 -5.6 q4.6 0 4.6 5.6 Z M${f(hx - 5.8)} ${hy - 2} h11.8 v1.3 h-11.8 Z`,
      shako: `M${f(hx - 3.8)} ${hy - 3} l.6 -6 h6.4 l.6 6 Z M${f(hx + 2)} ${hy - 3.2} h4.6 v1.1 h-4.6 Z`,
      none: '',
    }[hat];
    let armsSvg = '';
    for (const a of arms) {
      const [el, hand, props = '', anim = ''] = a;
      armsSvg += `<g>${anim}<path d="M${f(sh[0])} ${sh[1]} L${el[0]} ${el[1]} L${hand[0]} ${hand[1]}" class="st" stroke-width="2.7"/>${props}
        <circle cx="${el[0]}" cy="${el[1]}" r=".75" class="s-pin"/></g>`;
    }
    const body = `
      <path d="${legPath}" class="st" stroke-width="3.3"/>
      <path d="M-4.5 -1.6 h5.6 v1.6 h-5.6 Z M${legs === 'walk' ? '5' : '0.6'} -1.6 h5.2 v1.6 h-5.2 Z"/>
      <path d="${coatPath}"/>
      <rect x="${f(hx - 1.5)}" y="-43" width="3" height="5"/>
      <circle cx="${f(hx)}" cy="${hy}" r="4"/>
      <path d="M${f(hx + 3.6)} ${hy - 1.2} l1.8 1.7 l-2 .5 Z"/>
      ${hat === 'none' ? `<path d="M${f(hx - 3.8)} ${hy - 1} q1 -4.6 4.8 -4.4 q-2.4 1 -4.8 4.4 Z"/>` : `<path d="${hats}"/>`}
      ${armsSvg}${extra}
      <circle cx="${f(sh[0])}" cy="-38" r=".75" class="s-pin"/><circle cx="0" cy="-19" r=".75" class="s-pin"/>`;
    const rodLine = rod ? `<line x1="${f(x + 1)}" y1="${f(y - 26 * k)}" x2="${f(x + 4 * dir)}" y2="120" class="st s-rod" stroke-width=".6"/>` : '';
    return `${rodLine}<g transform="translate(${f(x)} ${f(y)}) scale(${f(dir * k)} ${f(k)})">${sway ? swing(-sway, sway, 0, 0, 3.4 + (x % 7) / 5) : ''}${body}</g>`;
  }

  // ---------- паровоз и вагоны (локально: рельс на y = 0, лицом вправо) ----------
  function wheel(cx, cy, r, turn = 1.6) {
    return `<g><circle cx="${cx}" cy="${cy}" r="${r}"/><g class="st s-spoke" stroke-width=".6">${spin(cx, cy, turn)}
      ${range(3, i => { const a = i * Math.PI / 3; return `<line x1="${f(cx - Math.cos(a) * (r - 1))}" y1="${f(cy - Math.sin(a) * (r - 1))}" x2="${f(cx + Math.cos(a) * (r - 1))}" y2="${f(cy + Math.sin(a) * (r - 1))}"/>`; })}</g></g>`;
  }
  function loco(smoke = true, turn = 1.6) {
    return `
      <path d="M-44 -17 h19 v10 h-19 Z"/>${wheel(-39, -3.5, 3.5, turn)}${wheel(-30, -3.5, 3.5, turn)}
      <path d="M-23 -9 h56 v3 h-56 Z"/>
      <rect x="-3" y="-20" width="33" height="12" rx="5.5"/>
      <path d="M-22 -30 h21 v2 h-21 Z M-20 -28 h16 v19 h-16 Z"/>
      <rect x="-17" y="-25.5" width="6" height="6" class="s-hole"/>
      <path d="M9 -20 a3.4 3.4 0 0 1 6.8 0 Z"/>
      <path d="M22 -20 L20.5 -27 L16.5 -34 h14 l-4 7 L25.5 -20 Z"/>
      <path d="M31 -9 L38 0 H29 Z"/>
      <path d="M-15 -4 L10 -4" class="st" stroke-width="1.2"/>
      ${wheel(-12, -6, 6, turn)}${wheel(4, -6, 6, turn)}${wheel(20, -3.8, 3.8, turn)}${wheel(28, -3.8, 3.8, turn)}
      ${smoke ? puffs(23.5, -36, 4) : ''}`;
  }
  // Тепловоз советской эпохи: капотный кузов, кабины с окнами, красная полоса, две тележки
  function diesel(turn = 1.6) {
    return `
      <path d="M-42 -8 V-20 L-36 -26 H34 L42 -20 V-8 Z"/>
      <rect x="31" y="-23.5" width="6" height="5" class="s-hole"/><rect x="-37" y="-23.5" width="6" height="5" class="s-hole"/>
      ${range(8, i => `<rect x="${-26 + i * 7}" y="-22" width="3" height="6" class="s-hole" opacity=".55"/>`)}
      <rect x="-42" y="-14" width="84" height="1.8" class="s-acc"/>
      <rect x="-3" y="-29" width="6" height="3"/>
      <path d="M-40 -8 h80 v2.5 h-80 Z"/>
      ${wheel(-31, -3.6, 3.6, turn)}${wheel(-22, -3.6, 3.6, turn)}${wheel(22, -3.6, 3.6, turn)}${wheel(31, -3.6, 3.6, turn)}
      <circle cx="41" cy="-11" r="1.4" class="s-acc">${flicker('1;.4;1', 1.6)}</circle>
      ${puffs(0, -30, 3, 0.7)}`;
  }
  function wagon(x) {
    return `<g transform="translate(${x} 0)"><path d="M-21 -22 h42 v14 h-42 Z"/>${range(4, i => `<rect x="${-17 + i * 9.5}" y="-19" width="6" height="5" class="s-hole"/>`)}
      <path d="M-22 -8 h44 v2 h-44 Z"/>${wheel(-14, -3.6, 3.6)}${wheel(-7, -3.6, 3.6)}${wheel(7, -3.6, 3.6)}${wheel(14, -3.6, 3.6)}</g>`;
  }
  // Пятиэтажка: коробка с сеткой окон, часть светится
  const block = (x, y, w, h, floors) => `<path d="M${x} ${y} h${w} v${-h} h${-w} Z"/>${range(floors, r => range(Math.floor(w / 7), c => `<rect x="${x + 2.5 + c * 7}" y="${f(y - h + 3 + r * (h - 4) / floors)}" width="3.4" height="${f((h - 4) / floors - 2.4)}" class="s-hole" opacity="${(r * 3 + c) % 4 ? 0.35 : 1}"/>`))}`;
  function carriage(x) {
    return `<g transform="translate(${x} 0)">
      <path d="M-20 -22 q20 -5 40 0 v14 h-40 Z"/>
      ${range(4, i => `<rect x="${-16 + i * 9}" y="-19" width="5" height="6" class="s-hole"/>`)}
      <path d="M-22 -8 h44 v2 h-44 Z"/>${wheel(-12, -3.6, 3.6)}${wheel(12, -3.6, 3.6)}</g>`;
  }
  const rails = (y, x1 = 0, x2 = 240) => `<path d="M${x1} ${y} H${x2} V${y + 1.4} H${x1} Z"/>${range(Math.floor((x2 - x1) / 8), i => `<rect x="${x1 + 2 + i * 8}" y="${y + 1.4}" width="4" height="1.6"/>`)}`;

  const plates = {
    // Кабинет: окно, шкаф, чиновник читает указ, курьер с поклоном, свеча
    decree() {
      return stage(`
        <g class="s-far">
          <path d="M150 18 h44 v70 h-44 Z"/><path d="M150 18 a22 14 0 0 1 44 0 Z"/>
        </g>
        <g class="s-hole-far">${range(2, c => range(3, r => `<rect x="${154 + c * 20}" y="${22 + r * 21}" width="16" height="17"/>`))}</g>
        <g class="s-mid">
          <path d="M22 30 h34 v74 h-34 Z M20 26 h38 v5 h-38 Z"/>
          ${range(4, i => `<rect x="25" y="${35 + i * 17}" width="28" height="1.6" class="s-hole"/>`)}
        </g>
        <g class="s-near">
          ${ground()}
          <path d="M112 76 h62 v4 h-62 Z M116 80 h3 l-1 24 h-2 Z M167 80 h3 l-1 24 h-2 Z M114 84 h56 v1.4 h-56 Z"/>
          <path d="M160 76 v-3 h7 v3 Z M163 73 L178 58" class="st" stroke-width=".9"/>
          <path d="M126 76 v-3 h6 v3 Z M128 73 h2 v-11 h-2 Z"/>
          <g class="s-flame">${swing(-8, 8, 129, 62, 1.1)}<path d="M129 62 q-3.2 -4 0 -9 q3.2 5 0 9 Z"/></g>
          <g class="s-flame-core">${flicker('1;.6;1;.8;1', 0.9)}<path d="M129 61.5 q-1.2 -2 0 -4 q1.2 2 0 4 Z"/></g>
          ${figure(96, FLOOR, { hat: 'none', sway: 1, arms: [
            [[3, -31], [6, -33]],
            [[7, -30], [18, -33], '<path d="M4 -34.5 h16 v2.2 h-16 Z"/><path d="M5.5 -32.3 h13 v17 q-3 2 -6.5 0 q-3.5 -2 -6.5 0 Z" class="s-hole"/><path d="M5.5 -32.3 v17 q3 -2 6.5 0 q3.5 2 6.5 0 v-17" class="st" stroke-width=".7"/><path d="M7.5 -29 h9 M7.5 -26.5 h9 M7.5 -24 h9 M7.5 -21.5 h6" class="st" stroke-width=".5"/><circle cx="15" cy="-19" r="1.8" class="s-acc"/>'],
          ] })}
          ${figure(204, FLOOR, { dir: -1, hat: 'shako', coat: 'coat', lean: 5, sway: 1.2, arms: [
            [[6, -30], [10, -24]],
            [[3, -29], [-1, -22], '<path d="M-4 -24 h6 v-3 h-6 Z"/>'],
          ] })}
        </g>`, 'Чиновник читает указ, курьер с поклоном, свеча на столе', { lamp: [0.55, 0.45] });
    },

    // Изыскания: лес, теодолит на треноге, изыскатель, реечник с полосатой рейкой
    survey() {
      return stage(`
        <g class="s-far">${hills(72, 16, 1)}${firs([30, 44, 170, 186, 200], 76, 22)}</g>
        ${birds([[120, 22, 1.2], [132, 28, 0.9], [110, 30, 0.8]])}
        <g class="s-mid">${hills(90, 8, 3)}${firs([16, 60, 214, 228], 96, 34)}</g>
        <g class="s-near">
          ${ground()}${fir(26, FLOOR, 50)}${fir(222, FLOOR, 44)}
          <path d="M70 70 L60 104 M70 70 L71 104 M70 70 L81 104" class="st" stroke-width="1.6"/>
          <path d="M63 64 h15 v7 h-15 Z M66 71 h9 v2 h-9 Z"/><path d="M78 65 h5 v4 h-5 Z"/>
          ${figure(92, FLOOR, { dir: -1, hat: 'top', lean: 6, legs: 'brace', sway: 0.6, arms: [
            [[8, -30], [12, -35]], [[4, -28], [10, -32]],
          ] })}
          <path d="M83 66 L186 58" class="st s-sight" stroke-width=".9" stroke-dasharray="4 3">${still ? '' : '<animate attributeName="stroke-dashoffset" values="14;0" dur="1.2s" repeatCount="indefinite"/>'}</path>
          <g>${swing(-1.5, 1.5, 188, 104, 4)}
            <path d="M186.6 40 h3 v64 h-3 Z"/>
            ${range(6, i => `<rect x="187.2" y="${43 + i * 10}" width="1.8" height="5" class="s-hole"/>`)}
            ${figure(178, FLOOR, { hat: 'cap', coat: 'shirt', rod: false, arms: [[[5, -32], [9, -44]], [[4, -26], [9, -26]]] })}
          </g>
        </g>`, 'Изыскатели с теодолитом и полосатой рейкой в лесу', { lamp: [0.5, 0.4] });
    },

    // Землекопы: насыпь, рабочий с лопатой, тачечник, десятник
    navvies() {
      const shovel = `<path d="M11 -22 L22 -4" class="st" stroke-width="1.3"/><path d="M19 -6 l6 -3 l3 6 l-6 3 Z"/>`;
      return stage(`
        <g class="s-far">${hills(70, 10, 5)}${firs([24, 36, 48, 190, 204, 218], 72, 20)}</g>
        <g class="s-mid">
          <path d="M0 86 L60 62 H180 L240 86 V104 H0 Z"/>
          ${rails(60, 60, 180)}
        </g>
        <g class="s-near">
          ${ground()}
          <path d="M150 104 q12 -16 26 -16 q12 0 22 16 Z"/>
          ${figure(52, FLOOR, { hat: 'top', sway: 0.8, arms: [
            [[6, -33], [14, -40]], [[-2, -30], [-2, -22], '<path d="M-3 -22 l1 -8" class="st" stroke-width="1"/>'],
          ] })}
          ${figure(104, FLOOR, { hat: 'cap', coat: 'shirt', lean: 7, legs: 'walk', arms: [
            [[9, -28], [15, -22]], [[8, -27], [14, -21]],
          ], extra: `<g><path d="M14 -24 L22 -22 L36 -20 L34 -12 L20 -12 Z"/>${wheel(32, -6, 6, 1.2)}<path d="M18 -12 l-2 10" class="st" stroke-width="1.4"/></g>` })}
          ${figure(186, 90, { dir: -1, hat: 'cap', coat: 'shirt', lean: 6, legs: 'brace', rod: false, arms: [
            [[7, -30], [11, -22], shovel, swing(0, 26, 4.8, -38, 1.8)],
            [[4, -28], [9, -24], '', swing(0, 18, 3.6, -38, 1.8)],
          ] })}
        </g>`, 'Землекопы насыпают полотно: тачка, лопата, десятник', { lamp: [0.45, 0.35] });
    },

    // Мост через реку; по нему идёт поезд. wooden — деревянные фермы на ряжах, iron — металл на каменных быках
    bridge(kind = 'wooden') {
      const iron = kind === 'iron' || kind === 'bam';
      const DECK = 62, L = 22, R = 218, spans = iron ? 3 : 4, sw = (R - L) / spans;
      let truss = '';
      for (let s = 0; s < spans; s++) {
        const x0 = L + s * sw, x1 = x0 + sw, panels = iron ? 6 : 4, pw = sw / panels;
        const bot = x => iron ? DECK + 4 + 12 * Math.sin(Math.PI * (x - x0) / sw) : DECK + 12;
        truss += `<path d="M${f(x0)} ${DECK} H${f(x1)}" class="st" stroke-width="2.4"/>`;
        let low = `M${f(x0)} ${f(bot(x0))}`;
        for (let p = 1; p <= panels; p++) low += ` L${f(x0 + p * pw)} ${f(bot(x0 + p * pw))}`;
        truss += `<path d="${low}" class="st" stroke-width="${iron ? 2 : 1.8}"/>`;
        for (let p = 0; p <= panels; p++) {
          const x = x0 + p * pw;
          truss += `<path d="M${f(x)} ${DECK} V${f(bot(x))}" class="st" stroke-width=".9"/>`;
          if (p < panels) {
            truss += `<path d="M${f(x)} ${DECK} L${f(x + pw)} ${f(bot(x + pw))}" class="st" stroke-width=".9"/>`;
            if (!iron) truss += `<path d="M${f(x + pw)} ${DECK} L${f(x)} ${f(bot(x))}" class="st" stroke-width=".9"/>`;
          }
        }
      }
      const piers = range(spans + 1, i => {
        const x = L + i * sw;
        return iron
          ? `<path d="M${f(x - 5)} ${DECK + 4} h10 l2 42 h-14 Z"/>${range(4, j => `<rect x="${f(x - 5)}" y="${DECK + 12 + j * 8}" width="10" height=".8" class="s-hole"/>`)}`
          : `<path d="M${f(x - 7)} 108 L${f(x - 2)} ${DECK + 12} M${f(x + 7)} 108 L${f(x + 2)} ${DECK + 12} M${f(x - 5)} 96 L${f(x + 5)} 84 M${f(x + 5)} 96 L${f(x - 5)} 84" class="st" stroke-width="1.3"/><path d="M${f(x - 9)} 100 h18 l-3 -6 h-12 Z"/>`;
      });
      return stage(`
        <g class="s-far">${hills(64, 14, iron ? 2 : 7)}</g>
        <g class="s-mid">${firs([20, 34, 206, 222], 80, 22)}</g>
        ${waves(92, 2, 5, 's-water-far')}
        <g class="s-near">
          <path d="M0 ${DECK} H${L} L${L - 4} 120 H0 Z M240 ${DECK} H${R} L${R + 4} 120 H240 Z"/>
          ${piers}${truss}${rails(DECK - 3, 0, 240)}
          <g>${slide('-120 0', '380 0', 11)}<g transform="translate(0 ${DECK - 3}) scale(.72)">${kind === 'bam' ? `${diesel(0.9)}${wagon(-66)}${wagon(-112)}` : `${loco(true, 0.9)}${carriage(-66)}${carriage(-112)}`}</g></g>
        </g>
        ${waves(104, 2.4, 3.6, 's-water')}`, iron ? 'Поезд идёт по металлическому мосту на каменных быках' : 'Поезд идёт по деревянному мосту на ряжах', { lamp: [0.5, 0.3] });
    },

    // Первый поезд у платформы: город с куполами, вокзал, публика, флаг
    station() {
      const flag = still
        ? '<path d="M200 8 q6 -2 12 1 v8 q-6 -3 -12 -1 Z" class="s-acc"/>'
        : `<path class="s-acc" d="M200 8 q6 -2 12 1 v8 q-6 -3 -12 -1 Z"><animate attributeName="d" values="M200 8 q6 -2 12 1 v8 q-6 -3 -12 -1 Z;M200 8 q6 3 12 0 v8 q-6 2 -12 1 Z;M200 8 q6 -2 12 1 v8 q-6 -3 -12 -1 Z" dur="1.4s" repeatCount="indefinite"/></path>`;
      const dome = (x, y, s) => `<path d="M${x - 5 * s} ${y} q0 -${7 * s} ${5 * s} -${11 * s} q${5 * s} ${4 * s} ${5 * s} ${11 * s} Z"/><rect x="${f(x - 4 * s)}" y="${y}" width="${8 * s}" height="${16 * s}"/><path d="M${x} ${f(y - 11 * s)} v-${5 * s} M${f(x - 2 * s)} ${f(y - 14 * s)} h${4 * s}" class="st" stroke-width=".7"/>`;
      return stage(`
        <g class="s-far">${hills(72, 6, 4)}${dome(40, 52, 1.2)}${dome(56, 58, 0.8)}${dome(90, 56, 1)}<path d="M28 72 h80 v-10 h-80 Z"/></g>
        <g class="s-mid">
          <path d="M136 50 h96 v40 h-96 Z M130 52 L184 30 L238 52 Z"/>
          <path d="M178 30 h12 v-6 a6 6 0 0 0 -12 0 Z"/>
        </g>
        <g class="s-hole">${range(5, i => `<path d="M${142 + i * 18} 84 v-18 a4 4 0 0 1 8 0 v18 Z">${flicker('1;.75;1', 2.4 + i * 0.3, i * 0.4)}</path>`)}</g>
        <g class="s-near">
          ${ground()}<path d="M118 92 H240 V96 H118 Z"/>
          <path d="M200 92 V8" class="st" stroke-width="1"/>
          ${figure(132, 92, { hat: 'top', rod: false, sway: 0.7, arms: [[[3, -30], [5, -22]], [[4, -33], [8, -44], '<path d="M5 -46 h7 v-7 h-6 Z M3 -45.6 h11 v1.4 h-11 Z"/>', swing(-12, 14, 0.6, -38, 1.3)]] })}
          ${figure(150, 92, { hat: 'shako', coat: 'coat', rod: false, k: 0.94 })}
          ${figure(166, 92, { hat: 'none', coat: 'coat', rod: false, k: 0.86, arms: [[[5, -32], [9, -40]]] })}
          ${figure(182, 92, { hat: 'cap', rod: false, k: 0.9, sway: 1 })}
          <g transform="translate(62 104)">${loco(true, 0)}${carriage(-66)}</g>
        </g>
        ${flag}`, 'Первый поезд у вокзала, публика машет шляпами', { lamp: [0.45, 0.35] });
    },

    // Паром-ледокол на озере среди гор, льдины
    ferry() {
      return stage(`
        <g class="s-far"><path d="M0 70 L22 40 L40 56 L70 24 L100 60 L130 36 L160 58 L190 30 L220 52 L240 44 V76 H0 Z"/></g>
        <g class="s-mid"><path d="M0 78 L30 58 L50 70 L84 48 L112 74 L150 60 L186 76 L214 56 L240 72 V84 H0 Z"/></g>
        ${birds([[60, 20, 1], [72, 16, 1.2], [180, 22, 0.9]])}
        ${waves(84, 1.6, 7, 's-water-far')}
        <g class="s-near">
          <g>${drift(0, 1.4, 3.2)}${swing(-0.8, 0.8, 120, 96, 4.4)}
            ${puffs(98, 50, 4, 1.1)}${puffs(122, 50, 4, 1.1)}
            <path d="M52 86 L196 86 L186 102 Q120 108 64 102 Z"/>
            <path d="M92 62 h9 v24 h-9 Z M116 62 h9 v24 h-9 Z M90 58 h13 v4 h-13 Z M114 58 h13 v4 h-13 Z"/>
            <path d="M74 72 h98 v14 h-98 Z M150 64 h18 v8 h-18 Z"/>
            ${range(4, i => `<rect x="${80 + i * 22}" y="75" width="16" height="7" class="s-hole"/>`)}
            ${range(11, i => `<circle cx="${70 + i * 11}" cy="94" r="1.5" class="s-hole"/>`)}
            <path d="M60 86 V60 M60 62 L90 72 M188 86 V64 M188 66 L168 72" class="st" stroke-width=".6"/>
          </g>
        </g>
        ${waves(106, 2.2, 3.4, 's-water')}
        <g class="s-ice">
          <g>${drift(-10, 0, 9)}<path d="M8 108 l14 -4 l12 3 l-6 5 l-16 1 Z"/></g>
          <g>${drift(8, 0, 11, 2)}<path d="M196 110 l18 -5 l14 4 l-10 5 Z"/></g>
          <g>${drift(-6, 0, 8, 1)}<path d="M150 112 l10 -3 l9 3 l-8 3 Z"/></g>
        </g>
`, 'Паром-ледокол с вагонами на озере среди гор', { lamp: [0.5, 0.25] });
    },

    // Зимовка: бараки со светящимися окнами, дым, снег, рабочий с вязанкой
    winter() {
      const flakes = range(34, i => {
        const x = (i * 37) % 226 + 7, y0 = (i * 23) % 110, dur = 5 + (i % 5);
        return still ? `<circle cx="${x}" cy="${y0}" r="${i % 3 ? 0.9 : 1.4}"/>`
          : `<circle cx="${x}" cy="${y0}" r="${i % 3 ? 0.9 : 1.4}"><animate attributeName="cy" values="${y0 - 120};${y0}" dur="${dur}s" begin="-${(i * 0.7) % dur}s" repeatCount="indefinite"/><animate attributeName="cx" values="${x};${x - 6};${x}" dur="${dur / 2}s" repeatCount="indefinite"/></circle>`;
      });
      return stage(`
        <circle cx="196" cy="26" r="9" class="s-moon"/>
        <g class="s-far">${hills(74, 8, 2)}${firs([16, 30, 44, 58, 150, 164, 214, 228], 78, 26)}</g>
        <g class="s-mid">${firs([10, 30, 222], 98, 40)}</g>
        <g class="s-near">
          <path d="M0 102 Q40 96 80 102 T160 100 T240 102 V120 H0 Z"/>
          <path d="M62 102 V74 h48 v28 Z M56 76 L86 56 L116 76 Z"/>
          <path d="M126 102 V80 h40 v22 Z M121 82 L146 66 L171 82 Z"/>
          <path d="M98 64 h5 v-10 h-5 Z M156 72 h4 v-9 h-4 Z"/>
          ${figure(196, 103, { dir: -1, hat: 'fur', coat: 'coat', legs: 'walk', sway: 0.6, arms: [[[6, -32], [2, -44], '<path d="M-8 -46 L14 -42 L14 -39 L-8 -43 Z"/>'], [[3, -28], [7, -22]]] })}
        </g>
        <g class="s-hole">
          <rect x="72" y="82" width="8" height="8">${flicker('1;.6;1;.85;1', 3)}</rect>
          <rect x="92" y="82" width="8" height="8">${flicker('1;.8;.6;1', 2.6, 0.7)}</rect>
          <rect x="140" y="86" width="7" height="7">${flicker('1;.7;1', 3.4, 1.1)}</rect>
        </g>
        ${puffs(100, 52, 4)}${puffs(158, 61, 3, 0.8)}
        <g class="s-snow">${flakes}</g>`, 'Зимние бараки строителей, снег и дым', { lamp: [0.7, 0.2] });
    },

    // Паводок: тучи, дождь, размытая насыпь, провисшие рельсы, рабочий с фонарём
    flood() {
      const rain = range(26, i => {
        const x = (i * 29) % 250, y = (i * 17) % 60 + 16;
        return `<line x1="${x}" y1="${y}" x2="${x - 5}" y2="${y + 10}" stroke-width=".7">${still ? '' : `<animateTransform attributeName="transform" type="translate" values="0 -30;-12 60" dur="${0.7 + (i % 4) * 0.12}s" begin="-${(i % 7) * 0.1}s" repeatCount="indefinite"/>`}</line>`;
      });
      return stage(`
        <g class="s-mid s-cloud">${drift(-6, 0, 8)}<path d="M-10 30 q14 -18 34 -8 q10 -16 32 -6 q16 -14 36 0 q18 -12 34 2 q20 -14 40 0 q16 -10 34 2 q16 -6 30 4 V0 H-10 Z"/></g>
        <g class="st s-rain">${rain}</g>
        <g class="s-far">${hills(80, 8, 6)}</g>
        ${waves(88, 1.8, 6, 's-water-far')}
        <g class="s-near">
          <path d="M0 74 H78 L98 104 H0 Z M240 74 H156 L140 104 H240 Z"/>
          ${rails(71, 0, 78)}${rails(71, 156, 240)}
          <path d="M78 71 Q116 94 156 71" class="st" stroke-width="1.4"/><path d="M78 73.4 Q116 96 156 73.4" class="st" stroke-width=".7"/>
          <g>${drift(3, -1, 2.6)}<path d="M104 92 l6 -6 l7 2 l-2 7 Z"/></g>
          ${figure(40, 74, { hat: 'cap', coat: 'coat', legs: 'brace', rod: false, arms: [[[7, -32], [14, -28], '<path d="M14 -28 v4" class="st" stroke-width=".6"/><rect x="11.5" y="-24" width="5" height="6" rx="1"/>'], [[4, -30], [2, -22]]] })}
          <g class="s-lantern">${flicker('1;.5;1;.8;1', 1.3)}<rect x="52.3" y="51" width="3" height="3.4"/></g>
          ${figure(206, 74, { dir: -1, hat: 'top', rod: false, sway: 0.7, arms: [[[7, -34], [15, -38]], [[3, -28], [5, -22]]] })}
        </g>
        ${waves(98, 2.6, 3, 's-water')}`, 'Паводок размыл насыпь, рельсы провисли над промоиной', { lamp: [0.5, 0.55] });
    },

    // Колея: рельсы в разрезе на шпале, размер между головками, два инженера
    gauge() {
      const rail = x => `<path d="M${x - 9} 90 h18 v-3 h-6.5 l-1 -14 h4.5 v-6.5 h-12 v6.5 h4.5 l-1 14 h-6.5 Z"/>`;
      return stage(`
        <g class="s-far">${hills(78, 8, 8)}</g>
        <g class="s-near">
          ${ground()}
          <path d="M50 90 h140 v8 h-140 Z"/>
          ${range(10, i => `<rect x="${56 + i * 13.5}" y="93" width="7" height=".8" class="s-hole"/>`)}
          ${rail(80)}${rail(160)}
          ${figure(34, FLOOR, { hat: 'top', sway: 0.6, arms: [[[6, -32], [12, -40]], [[3, -28], [5, -22]]] })}
          ${figure(208, FLOOR, { dir: -1, hat: 'top', sway: 0.6, arms: [[[5, -30], [9, -34], '<path d="M9 -36 h4 v6 h-4 Z"/>'], [[3, -28], [5, -22]]] })}
        </g>
        <g class="s-measure">
          <path d="M80 62 V52 M160 62 V52 M84 56 H156" class="st" stroke-width=".9"/>
          <path d="M80 56 l7 -3 v6 Z M160 56 l-7 -3 v6 Z"/>
          <text x="120" y="46" text-anchor="middle" class="s-label">ширина колеи</text>
        </g>`, 'Рельсы в разрезе на шпале и ширина колеи', { lamp: [0.5, 0.45] });
    },
  };

  Object.assign(plates, {
    // Стройка века: митинг, красные флаги, транспарант с названием стройки
    rally() {
      const flag = (x, h, d) => `<path d="M${x} ${FLOOR - 26} V${FLOOR - 26 - h}" class="st" stroke-width="1"/>${still ? `<path d="M${x} ${FLOOR - 26 - h} h14 v8 h-14 Z" class="s-acc"/>` : `<path class="s-acc" d="M${x} ${FLOOR - 26 - h} q7 -2 14 1 v8 q-7 -3 -14 -1 Z"><animate attributeName="d" values="M${x} ${FLOOR - 26 - h} q7 -2 14 1 v8 q-7 -3 -14 -1 Z;M${x} ${FLOOR - 26 - h} q7 3 14 0 v8 q-7 2 -14 1 Z;M${x} ${FLOOR - 26 - h} q7 -2 14 1 v8 q-7 -3 -14 -1 Z" dur="${1.2 + d}s" repeatCount="indefinite"/></path>`}`;
      return stage(`
        <g class="s-far">${hills(76, 10, 3)}${firs([22, 36, 200, 214, 228], 80, 22)}</g>
        <g class="s-near">
          ${ground()}
          <path d="M60 26 h120 v18 h-120 Z" class="s-acc"/>
          <text x="120" y="40" text-anchor="middle" class="s-banner">БАМ</text>
          <path d="M64 44 V78 M176 44 V78" class="st" stroke-width="1.4"/>
          ${flag(30, 34, 0)}${flag(46, 26, 0.3)}${flag(192, 30, 0.2)}${flag(212, 38, 0.4)}
          ${range(9, i => figure(30 + i * 22, FLOOR, { dir: i % 3 ? 1 : -1, k: 0.78 + (i % 3) * 0.06, hat: ['cap', 'none', 'helmet'][i % 3], coat: i % 2 ? 'shirt' : 'coat', rod: false, sway: 0.8,
            arms: i % 4 === 1 ? [[[5, -34], [9, -46]]] : [[[3, -28], [5, -22]]] }))}
        </g>`, 'Митинг строителей с красными флагами и транспарантом «БАМ»', { lamp: [0.5, 0.35], sun: [0.5, 0.62] });
    },

    // Разведка с воздуха: гидросамолёт над тайгой и озером
    plane() {
      return stage(`
        <g class="s-far">${hills(70, 16, 2)}</g>
        <g class="s-mid">${firs([12, 26, 40, 54, 180, 196, 212, 228], 92, 26)}</g>
        ${waves(94, 1.4, 6, 's-water-far')}
        <g class="s-near">
          <g>${still ? '' : `<animateTransform attributeName="transform" type="translate" values="-60 6;300 -8" dur="12s" repeatCount="indefinite"/>`}
            <g transform="translate(0 40)">
              <path d="M-26 0 q4 -6 20 -6 h24 l8 4 l-8 4 h-40 Z"/>
              <path d="M-4 -6 l6 -2 h30 l2 2 Z M-30 -8 l6 0 l4 6 h-8 Z"/>
              <path d="M-40 -9 h64 v2 h-64 Z" />
              <path d="M-14 3 l-4 8 M6 3 l4 8" class="st" stroke-width="1"/>
              <path d="M-24 11 h18 q3 0 3 2 h-24 Z M0 11 h18 q3 0 3 2 h-24 Z"/>
              <g class="s-rotor"><rect x="30" y="-8" width="1.2" height="12">${still ? '' : '<animate attributeName="height" values="12;2;12" dur=".15s" repeatCount="indefinite"/>'}</rect></g>
            </g>
          </g>
          ${ground(108)}
        </g>
        ${waves(110, 1.8, 3.4, 's-water')}`, 'Гидросамолёт снимает трассу с воздуха над тайгой', { sun: [0.2, 0.3] });
    },

    // Палаточный городок: палатки, вагончики со светом, костёр, гитарист
    camp() {
      const flame = still ? '<path d="M120 96 q-5 -8 0 -16 q5 8 0 16 Z" class="s-acc"/>'
        : `<path class="s-acc" d="M120 96 q-5 -8 0 -16 q5 8 0 16 Z"><animate attributeName="d" values="M120 96 q-5 -8 0 -16 q5 8 0 16 Z;M120 96 q-6 -6 -1 -13 q7 6 1 13 Z;M120 96 q-5 -8 0 -16 q5 8 0 16 Z" dur=".8s" repeatCount="indefinite"/></path>`;
      return stage(`
        <circle cx="200" cy="24" r="8" class="s-moon"/>
        <g class="s-far">${hills(72, 10, 4)}${firs([14, 28, 42, 170, 184, 198, 212, 226], 76, 24)}</g>
        <g class="s-near">
          ${ground()}
          <path d="M18 104 L40 74 L62 104 Z M70 104 L88 80 L106 104 Z"/>
          <path d="M40 74 V104 M88 80 V104" class="st s-hole-line" stroke-width=".8"/>
          <path d="M150 104 V78 q0 -6 6 -6 h52 q6 0 6 6 V104 Z"/>
          ${[160, 176, 192].map((x, i) => `<rect x="${x}" y="82" width="9" height="8" class="s-hole">${flicker('1;.6;1', 2.2 + i * 0.4, i * 0.3)}</rect>`).join('')}
          <path d="M112 100 l16 -6 M112 94 l16 6" class="st" stroke-width="2"/>
          ${flame}${puffs(121, 78, 3, 0.8)}
          ${figure(100, FLOOR, { hat: 'none', coat: 'shirt', legs: 'kneel', rod: false, k: 0.9, arms: [[[6, -30], [12, -26], '<path d="M4 -28 l12 -4 l2 3 l-12 4 Z M14 -32 l6 -6" class="st" stroke-width="1.4"/>', swing(0, 6, 0, -38, 0.6)], [[4, -26], [10, -24]]] })}
          ${figure(138, FLOOR, { dir: -1, hat: 'cap', coat: 'shirt', rod: false, k: 0.9, sway: 1 })}
        </g>`, 'Палатки и вагончики первых строителей, костёр и гитара', { lamp: [0.5, 0.75], sun: [0.8, 0.5] });
    },

    // Портал тоннеля в скале: облицовка, путь, проходчик с перфоратором, тепловоз выходит на свет
    tunnel() {
      return stage(`
        <g class="s-far">${hills(56, 20, 6)}</g>
        <g class="s-mid"><path d="M0 104 L0 60 L40 30 L80 44 L120 14 L170 40 L210 26 L240 48 V104 Z"/></g>
        <g class="s-near">
          <path d="M60 104 V58 q60 -38 120 0 V104 Z"/>
          <path d="M86 104 V70 a34 30 0 0 1 68 0 V104 Z" class="s-portal"/>
          <path d="M86 70 a34 30 0 0 1 68 0" class="st s-lining" stroke-width="2.2"/>
          <path d="M80 104 V68 a40 36 0 0 1 80 0 V104" class="st s-lining" stroke-width=".8"/>
          <path d="M92 50 h56 v8 h-56 Z" class="s-acc"/>
          ${ground()}
          <path d="M104 104 L96 120 M136 104 L144 120" class="st" stroke-width="1.6"/>
          <g>${still ? '' : '<animateTransform attributeName="transform" type="translate" values="0 0;0 0;0 14;0 14" keyTimes="0;.4;.9;1" dur="7s" repeatCount="indefinite"/>'}
            <g transform="translate(120 100) scale(.6)"><path d="M-30 -2 V-30 q0 -8 8 -8 h44 q8 0 8 8 V-2 Z"/><rect x="-22" y="-32" width="14" height="10" class="s-hole"/><rect x="8" y="-32" width="14" height="10" class="s-hole"/>
              <circle cx="0" cy="-12" r="3" class="s-acc">${flicker('1;.5;1', 1.2)}</circle><rect x="-30" y="-20" width="60" height="2" class="s-acc"/></g>
          </g>
          ${figure(46, FLOOR, { hat: 'helmet', coat: 'coat', legs: 'brace', rod: false, lean: 4, arms: [[[7, -30], [14, -24], `<g>${drift(0.6, 0.4, 0.12)}<path d="M13 -26 l12 3 l-1 3 l-12 -3 Z M24 -23 l6 1" class="st" stroke-width="1.4"/></g>`], [[6, -27], [12, -22]]] })}
          ${figure(194, FLOOR, { dir: -1, hat: 'helmet', coat: 'coat', rod: false, sway: 0.8, arms: [[[6, -33], [11, -40]]] })}
        </g>`, 'Портал тоннеля в скале, проходчик с перфоратором, тепловоз выходит на свет', { lamp: [0.5, 0.5], sun: [0.84, 0.3] });
    },

    // Посёлок-город: пятиэтажки, кран, вокзал, флаг
    town() {
      return stage(`
        <g class="s-far">${hills(70, 14, 1)}${firs([14, 30, 214, 228], 74, 22)}</g>
        <g class="s-mid">${block(20, 96, 44, 36, 5)}${block(176, 96, 44, 30, 4)}</g>
        <g class="s-near">
          ${ground()}
          <path d="M150 104 V30 M150 32 H206 M150 32 L140 40 M206 32 V40" class="st" stroke-width="1.6"/>
          <path d="M146 104 h8 v-4 h-8 Z M136 40 h8 v6 h-8 Z"/>
          <g>${swing(-3, 3, 196, 32, 3.6)}<path d="M196 32 V56" class="st" stroke-width=".6"/><rect x="189" y="56" width="14" height="10"/></g>
          <path d="M72 104 V70 h66 V104 Z M68 70 h74 v-5 h-74 Z"/>
          ${range(5, i => `<rect x="${77 + i * 12}" y="76" width="7" height="14" class="s-hole">${flicker('1;.7;1', 2.5 + i * 0.3, i * 0.5)}</rect>`)}
          <path d="M105 65 V40" class="st" stroke-width="1"/>
          ${still ? '<path d="M105 40 h14 v8 h-14 Z" class="s-acc"/>' : '<path class="s-acc" d="M105 40 q7 -2 14 1 v8 q-7 -3 -14 -1 Z"><animate attributeName="d" values="M105 40 q7 -2 14 1 v8 q-7 -3 -14 -1 Z;M105 40 q7 3 14 0 v8 q-7 2 -14 1 Z;M105 40 q7 -2 14 1 v8 q-7 -3 -14 -1 Z" dur="1.4s" repeatCount="indefinite"/></path>'}
          ${figure(40, FLOOR, { hat: 'fur', coat: 'coat', rod: false, k: 0.85, sway: 0.8 })}
          ${figure(56, FLOOR, { dir: -1, hat: 'none', coat: 'coat', rod: false, k: 0.8, arms: [[[5, -32], [9, -40]]] })}
        </g>`, 'Новый город на БАМе: пятиэтажки, кран и вокзал', { sun: [0.72, 0.38] });
    },

    // Путеукладчик опускает звено на насыпь, монтёры принимают рельсы
    tracklayer() {
      return stage(`
        <g class="s-far">${hills(66, 14, 5)}${firs([16, 30, 44, 58, 190, 206, 222], 72, 24)}</g>
        <g class="s-mid"><path d="M0 104 L0 92 L240 86 V104 Z"/></g>
        <g class="s-near">
          ${ground()}
          <path d="M0 98 H240 V104 H0 Z"/>
          ${rails(96, 0, 132)}
          <g transform="translate(64 96)">${diesel(0)}</g>
          <path d="M100 74 L170 40 M104 88 L170 40" class="st" stroke-width="2"/>
          <path d="M96 70 h16 v26 h-16 Z"/>
          <g>${still ? '' : '<animateTransform attributeName="transform" type="translate" values="0 0;0 18;0 18;0 0" keyTimes="0;.45;.7;1" dur="6s" repeatCount="indefinite"/>'}
            <path d="M160 42 V70 M180 42 V70" class="st" stroke-width=".6"/>
            <path d="M136 70 h64 v2 h-64 Z M136 75 h64 v2 h-64 Z"/>
            ${range(8, i => `<rect x="${139 + i * 8}" y="72" width="4" height="4"/>`)}
          </g>
          ${figure(146, 98, { hat: 'helmet', coat: 'shirt', legs: 'brace', rod: false, k: 0.85, arms: [[[4, -32], [8, -38]], [[5, -30], [10, -36]]] })}
          ${figure(212, 98, { dir: -1, hat: 'cap', coat: 'shirt', rod: false, k: 0.85, arms: [[[6, -32], [12, -40]]], sway: 0.8 })}
        </g>`, 'Путеукладчик опускает рельсовое звено на насыпь', { sun: [0.85, 0.4] });
    },

    // Золотое звено: две бригады навстречу, последнее звено, транспарант
    goldlink() {
      return stage(`
        <g class="s-far">${hills(66, 18, 7)}${firs([14, 28, 212, 226], 72, 22)}</g>
        <g class="s-near">
          ${ground()}
          <path d="M0 98 H240 V104 H0 Z"/>
          ${rails(96, 0, 100)}${rails(96, 140, 240)}
          <g>${still ? '' : '<animateTransform attributeName="transform" type="translate" values="0 -14;0 -14;0 0;0 0" keyTimes="0;.3;.7;1" dur="5s" repeatCount="indefinite"/>'}
            <path d="M100 96 H140 V97.6 H100 Z" class="s-acc"/>${range(5, i => `<rect x="${102 + i * 8}" y="97.6" width="4" height="1.6" class="s-acc"/>`)}
          </g>
          <path d="M64 22 h112 v14 h-112 Z" class="s-acc"/>
          <text x="120" y="32.5" text-anchor="middle" class="s-banner s-banner-sm">ЗОЛОТОЕ ЗВЕНО</text>
          <path d="M68 36 V60 M172 36 V60" class="st" stroke-width="1"/>
          ${figure(84, 98, { hat: 'helmet', coat: 'shirt', legs: 'brace', rod: false, k: 0.85, lean: 3, arms: [[[6, -30], [14, -26]], [[5, -28], [13, -24]]] })}
          ${figure(156, 98, { dir: -1, hat: 'helmet', coat: 'shirt', legs: 'brace', rod: false, k: 0.85, lean: 3, arms: [[[6, -30], [14, -26]], [[5, -28], [13, -24]]] })}
          ${range(3, i => figure(22 + i * 16, 98, { hat: ['cap', 'none', 'fur'][i], coat: 'coat', rod: false, k: 0.7, sway: 1, arms: i === 1 ? [[[4, -34], [8, -46]]] : [] }))}
          ${range(3, i => figure(186 + i * 16, 98, { dir: -1, hat: ['none', 'cap', 'helmet'][i], coat: 'coat', rod: false, k: 0.7, sway: 1, arms: i === 0 ? [[[4, -34], [8, -46]]] : [] }))}
        </g>`, 'Две бригады укладывают последнее звено под транспарантом', { sun: [0.5, 0.5] });
    },
  });

  // Скоростной электропоезд (локально: рельс на y = 0, лицом вправо)
  function emu(cars = 3) {
    const car = (x, head) => `<g transform="translate(${x} 0)">
      ${head ? '<path d="M-24 -6 V-20 q0 -4 4 -4 H14 q16 0 26 18 V-6 Z"/>' : '<path d="M-24 -6 V-20 q0 -4 4 -4 H24 q4 0 4 4 V-6 Z"/>'}
      ${range(head ? 4 : 6, i => `<rect x="${-20 + i * 7}" y="-20" width="4.5" height="5" class="s-hole"/>`)}
      <rect x="-24" y="-12" width="${head ? 60 : 52}" height="1.6" class="s-acc"/>
      ${wheel(-16, -3, 3, 0.5)}${wheel(head ? 22 : 20, -3, 3, 0.5)}</g>`;
    return `${range(cars - 1, i => car(-56 * (i + 1), false))}${car(0, true)}
      <path d="M-6 -24 l5 -8 l6 8 M-3 -28 h6" class="st" stroke-width=".8"/>`;
  }

  Object.assign(plates, {
    // Скоростная линия: опоры контактной сети, поезд проносится, линии скорости
    hsr() {
      return stage(`
        <g class="s-far">${hills(76, 10, 2)}${firs([20, 34, 206, 222], 80, 20)}</g>
        <g class="s-mid"><path d="M0 104 L0 90 L240 86 V104 Z"/></g>
        <g class="s-near">
          ${ground()}<path d="M0 98 H240 V104 H0 Z"/>
          ${range(5, i => `<path d="M${14 + i * 54} 98 V44 h14" class="st" stroke-width="1.6"/>`)}
          <path d="M0 50 H240" class="st" stroke-width=".6"/>
          <g>${still ? '' : '<animateTransform attributeName="transform" type="translate" values="-200 0;420 0" dur="4.5s" repeatCount="indefinite"/>'}
            <g transform="translate(40 96) scale(.9)">${emu(3)}</g>
            <g class="st s-speed" stroke-width=".8">${range(4, i => `<path d="M${-150 - i * 14} ${74 + i * 5} h-40"/>`)}</g>
          </g>
        </g>`, 'Скоростной электропоезд проносится мимо опор контактной сети', { sun: [0.22, 0.4] });
    },
    // Остановленная стройка: насыпь обрывается, рельсы кончаются, шлагбаум, бурьян
    halt() {
      return stage(`
        <g class="s-far">${hills(74, 12, 5)}</g>
        <g class="s-mid">${firs([190, 204, 218, 232], 90, 26)}</g>
        <g class="s-near">
          ${ground()}
          <path d="M0 104 V90 H150 L176 104 Z"/>
          ${rails(88, 0, 96)}
          ${range(6, i => `<rect x="${104 + i * 8}" y="89.4" width="4" height="1.6"/>`)}
          <path d="M92 88 V74 M92 76 H130" class="st" stroke-width="1.6"/>
          ${range(4, i => `<rect x="${96 + i * 9}" y="74.6" width="4.5" height="2.8" class="s-acc"/>`)}
          <path d="M140 104 q2 -10 -2 -16 M146 104 q-1 -8 4 -14 M152 104 q1 -7 -3 -11 M60 90 q2 -8 -1 -12 M66 90 q-2 -6 3 -10" class="st s-weed" stroke-width=".9"/>
          ${figure(200, FLOOR, { dir: -1, hat: 'none', coat: 'coat', rod: false, k: 0.85, sway: 0.5, arms: [[[3, -28], [5, -22]]] })}
        </g>`, 'Насыпь обрывается, рельсы кончаются у шлагбаума', { sun: [0.3, 0.7] });
    },
  });

  function draw(name, arg) {
    if (!plates[name]) return '';
    still = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    return plates[name](arg);
  }
  window.KoleyaPlates = { draw, names: Object.keys(plates) };
})();
