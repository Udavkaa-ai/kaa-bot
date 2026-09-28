#!/usr/bin/env node
// Подложки карт глав в стиле фанерной карты-пазла: регионы того времени, озёра, реки.
//   KOLEYA_GEO_SRC=<папка с исходниками> node koleya/scripts/build-basemaps.js
// Исходники (в репозиторий не кладутся, десятки мегабайт):
//   - Natural Earth 1:10m (общественное достояние): ne_10m_admin_1_states_provinces, ne_10m_admin_0_countries,
//     ne_10m_lakes, ne_10m_rivers_lake_centerlines — https://github.com/nvkelso/natural-earth-vector (geojson/)
//   - RISTAT, Russian Empire Historical GIS Maps (1897), CC0 — губернии и уезды; перевести из GeoPackage:
//     python3 koleya/scripts/gpkg-to-geojson.py "<файл>" provinces_1897 provinces_1897.geojson
//     python3 koleya/scripts/gpkg-to-geojson.py "<файл>" districts_1897 districts_1897.geojson
// Результат: koleya/miniapp/basemap/<глава>.json — контуры обрезаны по окну главы и упрощены.
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = process.env.KOLEYA_GEO_SRC;
if (!SRC) { console.error('Задайте KOLEYA_GEO_SRC — папку с исходными geojson'); process.exit(1); }
const DATA = path.join(__dirname, '..', 'data');
const OUT = path.join(__dirname, '..', 'miniapp', 'basemap');
const load = f => JSON.parse(fs.readFileSync(path.join(SRC, f), 'utf8')).features;

const ATTRIBUTION = {
  empire: 'Границы губерний и уездов 1897 г.: Kessler G., Markevich A. Electronic Repository of Russian Historical Statistics, 18th–21st centuries, https://ristat.org/, Version I (2020); подготовка GIS — R. Stapel (IISH). Реки, озёра, соседние страны: Natural Earth.',
  soviet: 'Контуры регионов: Natural Earth (общественное достояние), названия — на время главы. Реки, озёра: Natural Earth.',
};

// Главы: источник регионов, поля окна, допуск упрощения
const CHAPTERS = {
  prologue: { src: 'districts', era: 'empire', pad: 0.9 },
  chapter1: { src: 'provinces', era: 'empire', pad: 0.6 },
  chapter2: { src: 'provinces', era: 'empire', pad: 0.45 },
  chapter3: { src: 'modern', era: 'soviet', pad: 0.5, countries: ['RUS'] },
  chapter4: { src: 'modern', era: 'soviet', pad: 0.6, countries: ['RUS', 'UKR'] },
};
// Земли Российской империи (их покрывают губернии RISTAT) — не рисуем поверх соседними странами
const EMPIRE_LANDS = ['RUS', 'FIN', 'EST', 'LVA', 'LTU', 'BLR', 'UKR', 'KAZ', 'POL', 'MDA', 'UZB', 'TKM', 'KGZ', 'TJK', 'GEO', 'ARM', 'AZE'];

// Названия того времени
const empireName = ru => ru.replace(/^Санкт-Петербургская/, 'С.-Петербургская').replace(/ губерния$/, ' губ.').replace(/ область$/, ' обл.');
// Уезды для пролога (1836): уезд вокруг столицы — С.-Петербургский (в наборе — поздний «Петроградский»),
// Петергофский до 1849 г. назывался Ораниенбаумским (ru.wikipedia, «Санкт-Петербургская губерния»)
const DISTRICT_1836 = { 'Петроградский': 'С.-Петербургский', 'Петергофский': 'Ораниенбаумский' };
const districtName = ru => `${DISTRICT_1836[ru] || ru} у.`;
const SOVIET = {
  'Забайкальский край': 'Читинская обл.', 'Бурятия': 'Бурятская АССР', 'Якутия': 'Якутская АССР', 'Автономная Республика Крым': 'Крымская обл.',
  'Луганская область': 'Ворошиловградская обл.', 'Адыгея': 'Адыгейская АО', 'Калмыкия': 'Калмыцкая АССР', 'Республика Карелия': 'Карельская АССР',
  'Тыва': 'Тувинская АССР', 'Карачаево-Черкесия': 'Карачаево-Черкесская АО', 'Кабардино-Балкария': 'Кабардино-Балкарская АССР',
  'Мордовия': 'Мордовская АССР', 'Татарстан': 'Татарская АССР', 'Чувашия': 'Чувашская АССР', 'Марий Эл': 'Марийская АССР', 'Удмуртия': 'Удмуртская АССР',
  'Башкортостан': 'Башкирская АССР', 'Республика Коми': 'Коми АССР', 'Хакасия': 'Хакасская АО', 'Республика Алтай': 'Горно-Алтайская АО',
  'Северная Осетия': 'Северо-Осетинская АССР', 'Чечня': 'Чечено-Ингушская АССР', 'Ингушетия': 'Чечено-Ингушская АССР', 'Дагестан': 'Дагестанская АССР',
};
const SOVIET_SKIP = new Set(['Москва', 'Севастополь', 'Санкт-Петербург']);
const sovietName = ru => (!ru || SOVIET_SKIP.has(ru)) ? null : (SOVIET[ru] || ru.replace(/ область$/, ' обл.'));
const RIVER_RU = { Volga: 'Волга', Ob: 'Обь', Irtysh: 'Иртыш', Yenisey: 'Енисей', Angara: 'Ангара', Lena: 'Лена', Amur: 'Амур', Shilka: 'Шилка', Selenga: 'Селенга', Zeya: 'Зея', Vitim: 'Витим', Olekma: 'Олёкма', Dnipro: 'Днепр', Dnieper: 'Днепр', Don: 'Дон', Neva: 'Нева', Msta: 'Мста', Volkhov: 'Волхов', Tobol: 'Тобол', Ishim: 'Ишим', Ussuri: 'Уссури', Songhua: 'Сунгари', Oka: 'Ока', Donets: 'Сев. Донец', Chulym: 'Чулым', Tom: 'Томь', Kuta: 'Кута' };
const LAKE_RU = { 'Lake Baikal': 'Байкал', Baikal: 'Байкал', 'Lake Ladoga': 'Ладожское оз.', Ladoga: 'Ладожское оз.', 'Lake Onega': 'Онежское оз.', Onega: 'Онежское оз.', 'Lake Ilmen': 'Ильмень', Ilmen: 'Ильмень', Khanka: 'Ханка', 'Lake Khanka': 'Ханка' };

// ---------- геометрия в градусах ----------
const rings = g => g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
const lines = g => g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
function bboxOf(g) {
  let w = 1e9, s = 1e9, e = -1e9, n = -1e9;
  const walk = c => { if (typeof c[0] === 'number') { w = Math.min(w, c[0]); e = Math.max(e, c[0]); s = Math.min(s, c[1]); n = Math.max(n, c[1]); } else c.forEach(walk); };
  walk(g.coordinates); return [w, s, e, n];
}
// Обрезка кольца прямоугольником (Сазерленд — Ходжман)
function clipRing(ring, bb) {
  const edges = [[p => p[0] >= bb.w, (a, b) => [bb.w, a[1] + (b[1] - a[1]) * (bb.w - a[0]) / (b[0] - a[0])]],
    [p => p[0] <= bb.e, (a, b) => [bb.e, a[1] + (b[1] - a[1]) * (bb.e - a[0]) / (b[0] - a[0])]],
    [p => p[1] >= bb.s, (a, b) => [a[0] + (b[0] - a[0]) * (bb.s - a[1]) / (b[1] - a[1]), bb.s]],
    [p => p[1] <= bb.n, (a, b) => [a[0] + (b[0] - a[0]) * (bb.n - a[1]) / (b[1] - a[1]), bb.n]]];
  let pts = ring.slice(0, -1);
  for (const [inside, cut] of edges) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length], b = pts[i];
      if (inside(b)) { if (!inside(a)) out.push(cut(a, b)); out.push(b); } else if (inside(a)) out.push(cut(a, b));
    }
    pts = out; if (!pts.length) break;
  }
  return pts;
}
function rdp(pts, eps, kx) {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const X = p => p[0] * kx, stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let md = 0, mi = -1;
    const x1 = X(pts[a]), y1 = pts[a][1], x2 = X(pts[b]), y2 = pts[b][1], dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy);
    for (let i = a + 1; i < b; i++) {
      const x = X(pts[i]), y = pts[i][1];
      const d = L ? Math.abs(dy * x - dx * y + x2 * y1 - y2 * x1) / L : Math.hypot(x - x1, y - y1);
      if (d > md) { md = d; mi = i; }
    }
    if (md > eps) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const simplifyRing = (pts, eps, kx) => { const m = Math.floor(pts.length / 2); return [...rdp(pts.slice(0, m + 1), eps, kx), ...rdp(pts.slice(m), eps, kx).slice(1, -1)]; };
function ringArea(r, kx) { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * kx * q[1] - q[0] * kx * p[1]; } return Math.abs(a / 2); }
const inside = (rs, x, y) => { let c = false; for (const r of rs) for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
function edgeDist(rs, x, y, kx) {
  let m = 1e9;
  for (const r of rs) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const ax = r[j][0] * kx, ay = r[j][1], bx = r[i][0] * kx, by = r[i][1], px = x * kx, dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    m = Math.min(m, Math.hypot(px - ax - t * dx, y - ay - t * dy));
  }
  return m;
}
// Точка подписи: внутри детали и как можно дальше от её краёв
function labelPoint(rs, kx) {
  const xs = rs.flat().map(p => p[0]), ys = rs.flat().map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  let best = null, bd = -1;
  for (let i = 1; i < 24; i++) for (let j = 1; j < 24; j++) {
    const x = x0 + (x1 - x0) * i / 24, y = y0 + (y1 - y0) * j / 24;
    if (!inside(rs, x, y)) continue;
    const d = edgeDist(rs, x, y, kx); if (d > bd) { bd = d; best = [x, y]; }
  }
  return best;
}
const r3 = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

// ---------- сборка ----------
const ne1 = load('ne_10m_admin_1_states_provinces.geojson');
const ne0 = load('ne_10m_admin_0_countries.geojson');
const lakesSrc = load('ne_10m_lakes.geojson');
const riversSrc = load('ne_10m_rivers_lake_centerlines.geojson');
const provinces = load('provinces_1897.geojson');
const districts = load('districts_1897.geojson');
fs.mkdirSync(OUT, { recursive: true });

for (const [chId, cfg] of Object.entries(CHAPTERS)) {
  const map = JSON.parse(fs.readFileSync(path.join(DATA, chId, 'map.json'), 'utf8'));
  const lons = map.nodes.map(n => n.lon), lats = map.nodes.map(n => n.lat);
  const spanX = Math.max(...lons) - Math.min(...lons), spanY = Math.max(...lats) - Math.min(...lats);
  const span = Math.max(spanX, spanY, 0.3);
  const pad = span * cfg.pad;
  const bb = { w: Math.min(...lons) - pad, e: Math.max(...lons) + pad, s: Math.min(...lats) - pad, n: Math.max(...lats) + pad };
  const kx = Math.cos((bb.s + bb.n) / 2 * Math.PI / 180);
  const eps = span / 900, dec = span < 1 ? 4 : 3;
  const touches = b => !(b[2] < bb.w || b[0] > bb.e || b[3] < bb.s || b[1] > bb.n);
  const shape = geom => {
    const out = [];
    for (const poly of rings(geom)) for (const ring of poly) {
      const c = clipRing(ring, bb); if (c.length < 3) continue;
      const s = simplifyRing(c, eps, kx); if (s.length < 3 || ringArea(s, kx) < eps * eps * 4) continue;
      out.push(s.map(p => [r3(p[0], dec), r3(p[1], dec)]));
    }
    return out;
  };

  // Детали: регионы того времени
  const regions = [];
  const addRegion = (geom, name, own) => {
    const b = bboxOf(geom); if (!touches(b)) return;
    const rs = shape(geom); if (!rs.length) return;
    regions.push({ rs, name, own, b, area: rs.reduce((a, r) => a + ringArea(r, kx), 0) });
  };
  if (cfg.src === 'provinces') for (const f of provinces) { const ru = f.properties.prov_RU; if (!/без .* округа/.test(ru)) addRegion(f.geometry, empireName(ru), true); }
  if (cfg.src === 'districts') for (const f of districts) addRegion(f.geometry, districtName(f.properties.Name_RU), true);
  if (cfg.src === 'modern') for (const f of ne1) if (cfg.countries.includes(f.properties.adm0_a3)) addRegion(f.geometry, sovietName(f.properties.name_ru), true);
  const skip = cfg.era === 'empire' ? EMPIRE_LANDS : cfg.countries;
  for (const f of ne0) { const a3 = f.properties.ADM0_A3 || f.properties.adm0_a3; if (!skip.includes(a3)) addRegion(f.geometry, null, false); }

  // Морилка: соседние детали — разного тона (жадная раскраска по касанию рамок)
  regions.sort((a, b) => b.area - a.area);
  const near = (p, q) => !(q.b[2] < p.b[0] - 0.02 || q.b[0] > p.b[2] + 0.02 || q.b[3] < p.b[1] - 0.02 || q.b[1] > p.b[3] + 0.02);
  for (const p of regions) {
    if (!p.own) { p.f = -1; continue; }
    const used = new Set(regions.filter(q => q !== p && q.f !== undefined && q.f >= 0 && near(p, q)).map(q => q.f));
    let h = 0; for (const ch of p.name || '') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    p.f = [0, 1, 2, 3, 4, 5].map(i => (h + i) % 6).find(i => !used.has(i)) ?? (h % 6);
  }
  const pieces = regions.map(p => {
    const lp = p.name && p.own ? labelPoint(p.rs, kx) : null;
    return { n: p.own ? p.name : null, f: p.f, ...(lp ? { lp: [r3(lp[0], dec), r3(lp[1], dec)] } : {}), r: p.rs };
  });

  const lakes = [];
  for (const f of lakesSrc) {
    if (!touches(bboxOf(f.geometry))) continue;
    const rs = shape(f.geometry); if (!rs.length) continue;
    const name = LAKE_RU[f.properties.name] || LAKE_RU[f.properties.name_en] || null;
    const lp = name ? labelPoint(rs, kx) : null;
    lakes.push({ ...(name ? { n: name } : {}), ...(lp ? { lp: [r3(lp[0], dec), r3(lp[1], dec)] } : {}), r: rs });
  }
  const rivers = [];
  for (const f of riversSrc) {
    if ((f.properties.scalerank ?? 9) > 7 || !touches(bboxOf(f.geometry))) continue;
    const name = RIVER_RU[f.properties.name] || RIVER_RU[f.properties.name_en] || null;
    for (const ln of lines(f.geometry)) {
      // Разрезаем линию на куски внутри окна
      let cur = [];
      const flush = () => { if (cur.length > 1) { const s = rdp(cur, eps, kx); rivers.push({ ...(name ? { n: name } : {}), w: Math.max(1, 8 - (f.properties.scalerank || 5)), l: s.map(p => [r3(p[0], dec), r3(p[1], dec)]) }); } cur = []; };
      for (const p of ln) { if (p[0] >= bb.w && p[0] <= bb.e && p[1] >= bb.s && p[1] <= bb.n) cur.push(p); else flush(); }
      flush();
    }
  }
  const out = { chapter: chId, era: cfg.era, bbox: [r3(bb.w, 3), r3(bb.s, 3), r3(bb.e, 3), r3(bb.n, 3)], attribution: ATTRIBUTION[cfg.era], pieces, lakes, rivers };
  const file = path.join(OUT, `${chId}.json`);
  fs.writeFileSync(file, JSON.stringify(out));
  console.log(chId, 'деталей', pieces.length, 'озёр', lakes.length, 'рек', rivers.length, (fs.statSync(file).size / 1024).toFixed(0) + ' КБ');
}
