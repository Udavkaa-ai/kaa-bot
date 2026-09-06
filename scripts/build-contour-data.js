#!/usr/bin/env node
// Сборка данных для мини-игры «Контур» (public/contour/data.json).
//
// Источник: Natural Earth 1:50m admin-0 countries (GeoJSON, public domain):
//   https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson
// Запуск:  node scripts/build-contour-data.js path/to/ne_50m_admin_0_countries.geojson
//
// Что делает:
//  1. Оставляет только страны (без зависимых территорий и спорных клочков), русские названия + алиасы.
//  2. Выкидывает далёкие заморские куски (Гвиана у Франции, Аляска у США) и совсем мелкие островки —
//     силуэт должен читаться на экране телефона.
//  3. Строит топологию (общие дуги у соседей), упрощает контуры адаптивно: у маленькой страны
//     детализация выше, у Россия/Канады — ниже; общая граница у обеих стран остаётся одной линией.
//  4. Для пар соседей собирает границу из общих дуг, склеивает в цепочки, отбрасывает пары,
//     где граница слишком короткая относительно картинки (Россия–Норвегия и т.п.).
//  5. Пишет компактный JSON: квантованные координаты с дельта-кодированием.

const fs = require('fs');
const path = require('path');
const topology = require('topojson-server').topology;
const { presimplify } = require('topojson-simplify');
const { quantize } = require('topojson-client');

const SRC = process.argv[2];
if (!SRC) { console.error('usage: node scripts/build-contour-data.js ne_50m_admin_0_countries.geojson'); process.exit(1); }
const OUT = path.join(__dirname, '..', 'public', 'contour', 'data.json');

// ---------- 1. отбор стран и имена ----------
const EXCLUDE_ADMIN = new Set([
  'Antarctica', 'Siachen Glacier', 'Western Sahara', 'Somaliland', 'Northern Cyprus',
  'Jersey', 'Guernsey', 'Isle of Man', 'Aland', 'Macao S.A.R', 'Hong Kong S.A.R.',
  'Aruba', 'Curaçao', 'Sint Maarten',
  // атоллы и россыпи островков — силуэта нет
  'Kiribati', 'Federated States of Micronesia', 'Palau', 'Seychelles', 'Tonga',
]);
const INCLUDE_TYPES = new Set(['Sovereign country', 'Country', 'Sovereignty']);
const INCLUDE_ADMIN = new Set(['Kosovo', 'Israel', 'Palestine', 'Greenland']);

// Русские названия, которые в Natural Earth слишком официальные, и разговорные алиасы для поиска.
const RENAME = {
  'China': 'Китай', 'Kosovo': 'Косово', 'United Kingdom': 'Великобритания',
  'Democratic Republic of the Congo': 'ДР Конго', 'Republic of the Congo': 'Республика Конго',
  'United Republic of Tanzania': 'Танзания', 'Czechia': 'Чехия', 'eSwatini': 'Эсватини',
  'North Macedonia': 'Северная Македония', 'Federated States of Micronesia': 'Микронезия',
  'The Gambia': 'Гамбия', 'The Bahamas': 'Багамы', 'East Timor': 'Восточный Тимор',
  'Ivory Coast': 'Кот-д’Ивуар', 'Cabo Verde': 'Кабо-Верде', 'Turkey': 'Турция',
  'Vatican': 'Ватикан', 'Dominican Republic': 'Доминикана', 'São Tomé and Principe': 'Сан-Томе и Принсипи',
  'Trinidad and Tobago': 'Тринидад и Тобаго', 'Saint Kitts and Nevis': 'Сент-Китс и Невис',
  'Saint Vincent and the Grenadines': 'Сент-Винсент и Гренадины', 'Saint Lucia': 'Сент-Люсия',
  'Antigua and Barbuda': 'Антигуа и Барбуда', 'Bosnia and Herzegovina': 'Босния и Герцеговина',
  'United Arab Emirates': 'ОАЭ', 'South Korea': 'Южная Корея', 'North Korea': 'Северная Корея',
  'Laos': 'Лаос', 'Vietnam': 'Вьетнам', 'Syria': 'Сирия', 'Iran': 'Иран', 'Bolivia': 'Боливия',
  'Venezuela': 'Венесуэла', 'Brunei': 'Бруней', 'Moldova': 'Молдова', 'Russia': 'Россия',
  'Taiwan': 'Тайвань', 'Myanmar': 'Мьянма', 'Belarus': 'Беларусь', 'Kyrgyzstan': 'Кыргызстан',
  'Central African Republic': 'ЦАР', 'South Sudan': 'Южный Судан', 'Guinea-Bissau': 'Гвинея-Бисау',
  'Equatorial Guinea': 'Экваториальная Гвинея', 'Papua New Guinea': 'Папуа — Новая Гвинея',
  'Solomon Islands': 'Соломоновы Острова', 'Marshall Islands': 'Маршалловы Острова',
  'United States of America': 'США', 'Haiti': 'Гаити', 'Turkmenistan': 'Туркменистан',
};
const ALIASES = {
  'США': ['Соединённые Штаты', 'Америка', 'Штаты', 'USA'], 'Великобритания': ['Англия', 'Британия', 'Соединённое Королевство'],
  'Россия': ['РФ', 'Российская Федерация'], 'Нидерланды': ['Голландия'], 'Северная Македония': ['Македония'],
  'Эсватини': ['Свазиленд'], 'Мьянма': ['Бирма'], 'Беларусь': ['Белоруссия'], 'Кыргызстан': ['Киргизия'],
  'Молдова': ['Молдавия'], 'ДР Конго': ['Конго', 'Заир', 'Демократическая Республика Конго'], 'Республика Конго': ['Конго'],
  'Кот-д’Ивуар': ['Кот-дИвуар', 'Кот д Ивуар', 'Берег Слоновой Кости'], 'ОАЭ': ['Эмираты', 'Объединённые Арабские Эмираты'],
  'ЦАР': ['Центральноафриканская Республика'], 'Чехия': ['Чешская Республика'], 'Южная Корея': ['Корея', 'Республика Корея'],
  'Северная Корея': ['КНДР', 'Корея'], 'Китай': ['КНР'], 'Доминикана': ['Доминиканская Республика'],
  'Восточный Тимор': ['Тимор', 'Тимор-Лешти'], 'Кабо-Верде': ['Острова Зелёного Мыса'], 'Папуа — Новая Гвинея': ['Папуа', 'Папуа Новая Гвинея'],
  'Тайвань': ['Китайская Республика'], 'Иран': ['Персия'], 'Багамы': ['Багамские Острова'], 'Косово': ['Республика Косово'],
  'Новая Зеландия': ['НЗ'], 'Бруней': ['Бруней-Даруссалам'], 'Гренландия': [], 'Босния и Герцеговина': ['Босния'],
  'Тринидад и Тобаго': ['Тринидад'], 'Сан-Томе и Принсипи': ['Сан-Томе'], 'Антигуа и Барбуда': ['Антигуа'],
  'Сент-Китс и Невис': ['Сент-Китс'], 'Сент-Винсент и Гренадины': ['Сент-Винсент'], 'Шри-Ланка': ['Цейлон'], 'Туркменистан': ['Туркмения'], 'Гаити': ['Республика Гаити'],
};

const raw = JSON.parse(fs.readFileSync(SRC, 'utf8'));
let feats = raw.features.filter(f => {
  const p = f.properties;
  if (EXCLUDE_ADMIN.has(p.ADMIN)) return false;
  return INCLUDE_TYPES.has(p.TYPE) || INCLUDE_ADMIN.has(p.ADMIN);
});

// ---------- 2. чистка колец ----------
const DEG2KM = 111.32;
function ringArea(ring) { // км², плоское приближение
  let s = 0;
  const lat0 = ring.reduce((a, c) => a + c[1], 0) / ring.length;
  const kx = DEG2KM * Math.cos(lat0 * Math.PI / 180), ky = DEG2KM;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    s += (ring[j][0] * kx) * (ring[i][1] * ky) - (ring[i][0] * kx) * (ring[j][1] * ky);
  }
  return Math.abs(s) / 2;
}
function bboxOf(rings) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const r of rings) for (const [x, y] of r) {
    if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y;
  }
  return b;
}
function center(b) { return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]; }

const countries = [];
for (const f of feats) {
  const p = f.properties;
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  const withArea = polys.map(poly => ({ poly, area: ringArea(poly[0]), bbox: bboxOf([poly[0]]) }))
    .sort((a, b) => b.area - a.area);
  const admin = p.ADMIN;
  const main = withArea[0];
  const mainExtent = Math.max(main.bbox[2] - main.bbox[0], main.bbox[3] - main.bbox[1]);
  const minArea = Math.max(10, main.area * 0.0005);
  // Кластер «своих» кусков растим от главного полигона: кусок остаётся, если он не дальше D
  // от любого уже оставленного (по зазору между bbox). Так остаются цепочки островов
  // (Индонезия, Филиппины, Япония), а Галапагосы, Канары, Аляска и Гвиана отваливаются.
  const D = Math.max(6, mainExtent * 0.2);
  const gap = (a, b) => Math.hypot(Math.max(0, a[0] - b[2], b[0] - a[2]), Math.max(0, a[1] - b[3], b[1] - a[3]));
  const kept = [main];
  // Аляска примыкает к основной части по bbox (Алеуты тянутся на запад), но силуэт США
  // с ней — уже другая игра; отсекаем явно.
  const forceDrop = admin === 'United States of America' ? (it => it.bbox[2] < -128) : (() => false);
  const rest = withArea.slice(1).filter(it => it.area >= minArea && !forceDrop(it));
  let grew = true;
  while (grew) {
    grew = false;
    for (let i = rest.length - 1; i >= 0; i--) {
      if (kept.some(k => gap(rest[i].bbox, k.bbox) <= D)) { kept.push(rest[i]); rest.splice(i, 1); grew = true; }
    }
  }
  kept.sort((a, b) => b.area - a.area); // главный полигон — первым, клиент опирается на это
  const name = RENAME[admin] || p.NAME_RU;
  const id = p.ADM0_ISO && p.ADM0_ISO !== '-99' && admin !== 'Kosovo' ? p.ADM0_ISO : (admin === 'Kosovo' ? 'XKX' : p.ISO_A3_EH);
  if (!name || !id || id === '-99') { console.warn('skip (no id/name):', admin); continue; }
  // Микрогосударства из островков — силуэта нет, в игру не берём
  if (main.area < 150) { console.warn(`skip (tiny ${main.area.toFixed(0)} km²):`, admin, name); continue; }
  countries.push({
    id, name, admin,
    aliases: ALIASES[name] || [],
    label: [p.LABEL_X, p.LABEL_Y],
    pop: p.POP_EST || 0,
    area: kept.reduce((a, it) => a + it.area, 0),
    geometry: { type: 'MultiPolygon', coordinates: kept.map(it => it.poly) },
  });
}
countries.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
console.log(`стран: ${countries.length}`);

// ---------- 3. топология + адаптивное упрощение ----------
const fc = { type: 'FeatureCollection', features: countries.map((c, i) => ({ type: 'Feature', id: i, properties: {}, geometry: c.geometry })) };
let topo = topology({ countries: fc });
topo = presimplify(topo); // веса Висвалингама в третьей координате (deg²)

// Какие страны используют какую дугу
const arcUsers = topo.arcs.map(() => new Set());
function walkArcs(geom, fn) {
  if (geom.type === 'Polygon') geom.arcs.forEach(ring => ring.forEach(fn));
  else if (geom.type === 'MultiPolygon') geom.arcs.forEach(poly => poly.forEach(ring => ring.forEach(fn)));
}
topo.objects.countries.geometries.forEach(g => walkArcs(g, a => arcUsers[a < 0 ? ~a : a].add(g.id)));

// Порог для дуги — по самой маленькой стране, которой она принадлежит:
// маленькие страны детальнее, огромные — грубее (площадь в deg² ≈ km² / 12000)
const K = 4e-5;      // доля площади страны (deg²) ≈ 2 px² при силуэте в 300 px
const MIN_W = 1e-6, MAX_W = 0.08;
const thresholds = topo.arcs.map((arc, i) => {
  let minArea = Infinity;
  for (const cid of arcUsers[i]) minArea = Math.min(minArea, countries[cid].area / 12000);
  if (!isFinite(minArea)) minArea = 1;
  return Math.min(MAX_W, Math.max(MIN_W, minArea * K));
});
let before = 0, after = 0;
topo.arcs = topo.arcs.map((arc, i) => {
  before += arc.length;
  const t = thresholds[i];
  const kept = arc.filter((pt, j) => j === 0 || j === arc.length - 1 || pt[2] >= t);
  after += kept.length;
  return kept.map(pt => [pt[0], pt[1]]);
});
console.log(`точек: ${before} → ${after}`);

const Q = 1e5;
topo = quantize(topo, Q);
const tf = topo.transform;

// ---------- 4. границы соседей ----------
function arcKm(arc) {
  let s = 0;
  for (let i = 1; i < arc.length; i++) {
    const lat = ((arc[i][1] + arc[i - 1][1]) / 2) * Math.PI / 180;
    s += Math.hypot((arc[i][0] - arc[i - 1][0]) * Math.cos(lat), arc[i][1] - arc[i - 1][1]) * DEG2KM;
  }
  return s;
}
// Абсолютные квантованные координаты дуги (дельты → абсолют, в целых)
function absArc(i) {
  const arc = topo.arcs[i];
  const out = [];
  let x = 0, y = 0;
  for (const [dx, dy] of arc) { x += dx; y += dy; out.push([x, y]); }
  return out;
}
function toLonLat([x, y]) { return [x * tf.scale[0] + tf.translate[0], y * tf.scale[1] + tf.translate[1]]; }

const pairMap = new Map();
arcUsers.forEach((users, i) => {
  if (users.size < 2) return;
  const ids = [...users].sort((a, b) => a - b);
  for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) {
    const key = `${ids[a]}-${ids[b]}`;
    if (!pairMap.has(key)) pairMap.set(key, { a: ids[a], b: ids[b], arcs: [] });
    pairMap.get(key).arcs.push(i);
  }
});

// Склейка дуг в цепочки по общим концам
function chains(arcIdx) {
  const arcs = arcIdx.map(i => absArc(i));
  const key = p => `${p[0]},${p[1]}`;
  const used = new Array(arcs.length).fill(false);
  const out = [];
  for (let s = 0; s < arcs.length; s++) {
    if (used[s]) continue;
    used[s] = true;
    let chain = arcs[s].slice();
    let grew = true;
    while (grew) {
      grew = false;
      for (let j = 0; j < arcs.length; j++) {
        if (used[j]) continue;
        const a = arcs[j];
        const head = key(chain[0]), tail = key(chain[chain.length - 1]);
        if (key(a[0]) === tail) { chain = chain.concat(a.slice(1)); used[j] = true; grew = true; }
        else if (key(a[a.length - 1]) === tail) { chain = chain.concat(a.slice(0, -1).reverse()); used[j] = true; grew = true; }
        else if (key(a[a.length - 1]) === head) { chain = a.slice(0, -1).concat(chain); used[j] = true; grew = true; }
        else if (key(a[0]) === head) { chain = a.slice(1).reverse().concat(chain); used[j] = true; grew = true; }
      }
    }
    out.push(chain);
  }
  return out;
}

// Кольца в квантованных целых — собираем сами из дуг, чтобы координаты совпадали с границами
function ringsOf(geomIdx) {
  const g = topo.objects.countries.geometries[geomIdx];
  const polys = g.type === 'Polygon' ? [g.arcs] : g.arcs;
  return polys.map(poly => poly.map(ring => {
    const pts = [];
    ring.forEach(a => {
      const arc = a < 0 ? absArc(~a).reverse() : absArc(a);
      if (pts.length) arc.shift();
      pts.push(...arc);
    });
    if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
    return pts;
  }));
}

const pairs = [];
for (const pr of pairMap.values()) {
  const ch = chains(pr.arcs).map(c => ({ pts: c, km: arcKm(c.map(toLonLat)) })).sort((a, b) => b.km - a.km);
  const longest = ch[0].km;
  // Мелкие обрывки (анклавы, вторые куски) — не рисуем и не считаем
  const keptCh = ch.filter(c => c.km >= Math.max(15, longest * 0.15));
  const totalKm = keptCh.reduce((s, c) => s + c.km, 0);
  const A = countries[pr.a], B = countries[pr.b];
  const small = A.area <= B.area ? pr.a : pr.b;
  // Картинка: меньшая страна целиком + вся граница. Граница должна быть заметной частью картинки.
  const bb = bboxOf([...ringsOf(small).flat(), ...keptCh.map(c => c.pts)].map(r => r.map(toLonLat)));
  const latC = (bb[1] + bb[3]) / 2 * Math.PI / 180;
  const diagKm = Math.hypot((bb[2] - bb[0]) * Math.cos(latC), bb[3] - bb[1]) * DEG2KM;
  if (totalKm < 30 || totalKm < diagKm * 0.12) { if (process.env.DEBUG) console.log(`  drop ${A.name}–${B.name}: ${totalKm.toFixed(0)} км при диагонали ${diagKm.toFixed(0)}`); continue; }
  pairs.push({ a: pr.a, b: pr.b, km: Math.round(totalKm), chains: keptCh.map(c => c.pts) });
}
pairs.sort((x, y) => x.a - y.a || x.b - y.b);
console.log(`пар соседей с границей: ${pairs.length} (всего смежных: ${pairMap.size})`);

// ---------- 5. запись ----------
function encodeLine(pts) { // дельта-кодирование: [x0,y0,dx1,dy1,...]
  const out = [];
  let px = 0, py = 0;
  for (const [x, y] of pts) { out.push(x - px, y - py); px = x; py = y; }
  return out;
}
const outCountries = countries.map((c, i) => ({
  id: c.id, name: c.name, alias: c.aliases, label: c.label.map(v => +v.toFixed(3)),
  pop: c.pop, area: Math.round(c.area),
  polys: ringsOf(i).map(poly => poly.map(encodeLine)),
}));
const outPairs = pairs.map(p => ({ a: p.a, b: p.b, km: p.km, border: p.chains.map(encodeLine) }));
const data = { v: 1, q: Q, transform: tf, countries: outCountries, pairs: outPairs };
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(data));
const zlib = require('zlib');
const json = fs.readFileSync(OUT);
console.log(`записано ${OUT}: ${(json.length / 1024).toFixed(0)} KB, gzip ${(zlib.gzipSync(json).length / 1024).toFixed(0)} KB`);

// Сводка по детализации для контроля
for (const nm of ['Люксембург', 'Ливан', 'Эстония', 'Италия', 'Россия', 'Индонезия', 'США', 'Франция']) {
  const c = outCountries.find(x => x.name === nm);
  if (c) console.log(`  ${nm}: полигонов ${c.polys.length}, точек ${c.polys.reduce((s, p) => s + p.reduce((t, r) => t + r.length / 2, 0), 0)}`);
}
