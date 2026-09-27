// Загрузка и валидация контента Koleya (koleya/data/*.json).
// Схемы проверяются вручную (без zod, чтобы не тянуть зависимость в «Билли»),
// плюс перекрёстные ссылки: fact_refs, afterEvent, сегменты, особенности, советники.
'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
// Порядок глав кампании. Глава без каталога в data/ просто пропускается.
const CHAPTERS = ['prologue', 'chapter1', 'chapter2'];
// Рельеф берётся из balance.terrain, этот список — только базовый минимум
const TERRAINS = ['plain', 'forest', 'swamp', 'hills'];

// Глубокое слияние: у главы в balance.<глава>.overrides могут быть свои terrain, crews, train и т.п.
function deepMerge(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return over === undefined ? base : over;
  const out = Array.isArray(base) ? [...base] : { ...(base || {}) };
  for (const [k, v] of Object.entries(over)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object' ? deepMerge(base[k], v) : v;
  }
  return out;
}
const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
const EVENT_TYPES = ['historical', 'decision', 'random'];
const FACT_STATUSES = ['verified', 'to_verify', 'legend'];
const TRIGGER_KEYS = new Set([
  'atTurn', 'afterEvent', 'segmentProgress', 'variant', 'season', 'chance', 'terrainActive',
  'moraleLte', 'favorLte', 'atYear', 'openedSegmentsGte', 'segment', 'overallProgressGte',
  'allSegmentsOpened', 'firstRunReady', 'segmentUnopened',
]);
const EFFECT_KEYS = new Set([
  'treasury', 'favor', 'morale', 'set', 'flag', 'unlock', 'segmentFeature', 'addLengthKm',
  'segmentWork', 'incidentRisk', 'skipSeason', 'runFirstTrain', 'modifier', 'crews',
]);
const MODIFIER_KEYS = new Set(['costMult', 'workMult', 'speedMult', 'incidentMult']);
const SET_KEYS = new Set(['routeVariant', 'gauge', 'tracks', 'pay']);
const UNLOCKS = new Set(['construction', 'rollingStock', 'quiz']);

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, rel), 'utf8'));
}

let cache = null;

// Весь контент разом: общий (факты, баланс) + по главам.
function loadAll({ fresh = false } = {}) {
  if (cache && !fresh) return cache;
  const facts = readJson('facts.json');
  const factsById = Object.fromEntries(facts.map(f => [f.id, f]));
  const balance = readJson('balance.json');
  const forbidden = readJson('forbidden_terms.json');
  const chapters = {};
  for (const id of CHAPTERS) {
    const dir = id;
    if (!fs.existsSync(path.join(DATA_DIR, dir, 'map.json'))) continue;
    // Глава-черновик ("draft": true в map.json) скрыта от игроков, пока её не доделали
    if (JSON.parse(fs.readFileSync(path.join(DATA_DIR, dir, 'map.json'), 'utf8')).draft && process.env.KOLEYA_DRAFTS !== '1') continue;
    const read = (name) => {
      const p = path.join(DATA_DIR, dir, name);
      return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
    };
    const map = read('map.json');
    const events = read('events.json') || [];
    const advisors = (read('advisors.json') || { advisors: [] }).advisors;
    const quiz = read('quiz.json') || [];
    chapters[id] = {
      id, map, events, advisors, quiz,
      eventsById: Object.fromEntries(events.map(e => [e.id, e])),
      segmentsById: Object.fromEntries((map?.segments || []).map(s => [s.id, s])),
      nodesById: Object.fromEntries((map?.nodes || []).map(n => [n.id, n])),
    };
  }
  cache = { facts, factsById, balance, forbidden, chapters };
  return cache;
}

function chapter(id) {
  const all = loadAll();
  const ch = all.chapters[id];
  if (!ch) throw new Error(`Нет главы ${id}`);
  // Баланс главы = общий баланс + её overrides (свой масштаб цен, выработки, поездов)
  const overrides = all.balance[id] && all.balance[id].overrides;
  return { ...ch, facts: all.factsById, balance: overrides ? deepMerge(all.balance, overrides) : all.balance };
}

// Список глав, которые реально есть в data/
function chapterIds() { return CHAPTERS.filter(id => loadAll().chapters[id]); }

// ---------- валидация ----------

function validate(all = loadAll({ fresh: true })) {
  const errors = [];
  const err = (where, msg) => errors.push(`${where}: ${msg}`);
  const isNum = v => typeof v === 'number' && Number.isFinite(v);
  const isStr = v => typeof v === 'string' && v.length > 0;

  // Факты
  const seen = new Set();
  for (const f of all.facts) {
    const w = `facts/${f.id || '?'}`;
    if (!isStr(f.id)) err(w, 'нет id');
    if (seen.has(f.id)) err(w, 'дубликат id');
    seen.add(f.id);
    if (!isStr(f.title)) err(w, 'нет title');
    if (!isStr(f.text)) err(w, 'нет text');
    if (!FACT_STATUSES.includes(f.status)) err(w, `неизвестный статус ${f.status}`);
    if (!Array.isArray(f.sources)) err(w, 'sources должен быть массивом');
    if (f.status === 'verified' && !(f.sources || []).length) err(w, 'verified без источников');
    for (const s of f.sources || []) {
      if (!isStr(s.title) || !isStr(s.url)) err(w, 'источник без title/url');
    }
  }
  const factOk = (w, ref) => { if (!all.factsById[ref]) err(w, `ссылка на несуществующий факт ${ref}`); };

  // Баланс — минимальный набор полей, на которые опирается движок
  const b = all.balance;
  const terrains = Object.keys(b.terrain || {});
  for (const t of TERRAINS) if (!terrains.includes(t)) err('balance', `нет базового рельефа ${t}`);
  for (const t of terrains) {
    if (!b.terrain?.[t] || !isNum(b.terrain[t].costPerKm) || !isNum(b.terrain[t].workPerKm)) err('balance', `terrain.${t}`);
    for (const s of SEASONS) if (!isNum(b.seasonMultiplier?.[t]?.[s])) err('balance', `seasonMultiplier.${t}.${s}`);
  }
  for (const k of ['workPerCrewPerSeason', 'hireCostPerCrew', 'maxHirePerSeason', 'maxCrewsPerKm', 'unpaidMoralePenalty']) {
    if (!isNum(b.crews?.[k])) err('balance', `crews.${k}`);
  }
  for (const lvl of ['low', 'normal', 'high']) if (!isNum(b.crews?.pay?.[lvl]?.costPerCrew)) err('balance', `crews.pay.${lvl}`);
  for (const ch of Object.keys(all.chapters)) {
    const cb = b[ch];
    if (!cb) { err('balance', `нет раздела ${ch}`); continue; }
    for (const k of ['startTreasury', 'startFavor', 'startMorale', 'startCrews', 'maxTurns']) {
      if (!isNum(cb[k])) err('balance', `${ch}.${k}`);
    }
  }

  // Главы
  for (const [chId, ch] of Object.entries(all.chapters)) {
    const map = ch.map;
    if (!map) { err(chId, 'нет map.json'); continue; }
    const nodeIds = new Set(map.nodes.map(n => n.id));
    for (const n of map.nodes) {
      if (!isNum(n.lat) || !isNum(n.lon)) err(`${chId}/map/${n.id}`, 'нет координат');
    }
    for (const s of map.segments) {
      const w = `${chId}/map/${s.id}`;
      if (!nodeIds.has(s.from) || !nodeIds.has(s.to)) err(w, 'from/to не найдены среди узлов');
      if (!isNum(s.length_km) || s.length_km <= 0) err(w, 'length_km');
      const shares = Object.entries(s.terrain || {});
      if (!shares.length) err(w, 'нет рельефа');
      let sum = 0;
      for (const [t, v] of shares) { if (!terrains.includes(t)) err(w, `рельеф ${t}`); sum += v; }
      if (Math.abs(sum - 1) > 0.001) err(w, `доли рельефа в сумме ${sum}`);
      for (const f of s.features || []) if (!map.features?.[f]) err(w, `особенность ${f} не описана`);
      for (const r of s.fact_refs || []) factOk(w, r);
    }
    for (const [fid, f] of Object.entries(map.features || {})) {
      const w = `${chId}/features/${fid}`;
      if (!Array.isArray(f.options) || !f.options.includes(f.default)) err(w, 'default не из options');
      if (f.kind === 'bridge') for (const o of f.options) if (!b.bridges?.[o]) err(w, `нет balance.bridges.${o}`);
      if (f.kind === 'grade') for (const o of f.options) if (!b.grade?.[o]) err(w, `нет balance.grade.${o}`);
      if (f.kind === 'crossing') for (const o of f.options) if (!b.crossing?.[o]) err(w, `нет balance.crossing.${o}`);
      if (!['bridge', 'grade', 'crossing'].includes(f.kind)) err(w, `неизвестный вид особенности ${f.kind}`);
      if (f.event && !ch.eventsById[f.event]) err(w, `событие ${f.event} не найдено`);
    }
    const fr = map.historical?.firstRun;
    // minutes может быть null: тогда сравнения с историческим рейсом нет и шкалы «скорость» тоже
    if (!fr || !nodeIds.has(fr.from) || !nodeIds.has(fr.to) || !(fr.minutes === null || isNum(fr.minutes))) err(`${chId}/map`, 'historical.firstRun {from,to,minutes}');
    else if (fr.fact_ref) factOk(`${chId}/map/historical.firstRun`, fr.fact_ref);
    for (const [id, d] of Object.entries(map.directorates || {})) if (!isStr(d)) err(`${chId}/map/directorates/${id}`, 'нужно название');

    // События
    const evIds = new Set();
    for (const e of ch.events) {
      const w = `${chId}/events/${e.id}`;
      if (evIds.has(e.id)) err(w, 'дубликат id');
      evIds.add(e.id);
      if (!EVENT_TYPES.includes(e.type)) err(w, `тип ${e.type}`);
      if (!isStr(e.title) || !isStr(e.text)) err(w, 'нет title/text');
      for (const k of Object.keys(e.trigger || {})) if (!TRIGGER_KEYS.has(k)) err(w, `неизвестный триггер ${k}`);
      if (e.trigger?.afterEvent && !ch.eventsById[e.trigger.afterEvent]) err(w, `afterEvent ${e.trigger.afterEvent} не найден`);
      const segRef = e.trigger?.segmentProgress?.segment || e.trigger?.segment || e.trigger?.segmentUnopened;
      if (segRef && !ch.segmentsById[segRef]) err(w, `сегмент ${segRef} не найден`);
      if (!Array.isArray(e.choices) || !e.choices.length) err(w, 'нет вариантов');
      for (const c of e.choices || []) {
        const wc = `${w}/${c.id}`;
        if (!isStr(c.id) || !isStr(c.label)) err(wc, 'нет id/label');
        for (const [k, v] of Object.entries(c.effects || {})) {
          if (!EFFECT_KEYS.has(k)) { err(wc, `неизвестный эффект ${k}`); continue; }
          if (k === 'set') for (const sk of Object.keys(v)) if (!SET_KEYS.has(sk)) err(wc, `set.${sk}`);
          if (k === 'unlock' && !UNLOCKS.has(v)) err(wc, `unlock ${v}`);
          if (k === 'segmentFeature') {
            const seg = ch.segmentsById[v.segment];
            if (!seg) err(wc, `сегмент ${v.segment}`);
            else if (!(seg.features || []).includes(v.feature)) err(wc, `у сегмента нет ${v.feature}`);
            else if (!map.features[v.feature].options.includes(v.value)) err(wc, `значение ${v.value}`);
          }
          if (k === 'addLengthKm' && !ch.segmentsById[v.segment]) err(wc, `сегмент ${v.segment}`);
          if (k === 'modifier') for (const mk of Object.keys(v)) if (!MODIFIER_KEYS.has(mk) || !isNum(v[mk])) err(wc, `modifier.${mk}`);
          if (k === 'crews' && !Number.isInteger(v)) err(wc, 'crews — целое число артелей');
        }
      }
      if (e.history && e.history.choiceId !== null && !(e.choices || []).some(c => c.id === e.history.choiceId)) {
        err(w, `history.choiceId ${e.history.choiceId} не из вариантов`);
      }
      for (const r of e.fact_refs || []) factOk(w, r);
    }

    // Советники
    for (const a of ch.advisors) {
      const w = `${chId}/advisors/${a.id}`;
      for (const r of a.fact_refs || []) factOk(w, r);
      for (const key of Object.keys(a.lines || {})) {
        const [evId, choiceId] = key.split('.');
        if (/^[EP]\d/.test(evId)) {
          const ev = ch.eventsById[evId];
          if (!ev) err(w, `реплика к несуществующему событию ${key}`);
          else if (choiceId && !ev.choices.some(c => c.id === choiceId)) err(w, `реплика к несуществующему варианту ${key}`);
        }
      }
    }

    // Викторина: только verified-факты
    for (const q of ch.quiz) {
      const w = `${chId}/quiz/${q.id}`;
      const f = all.factsById[q.fact_ref];
      if (!f) err(w, `факт ${q.fact_ref} не найден`);
      else if (f.status !== 'verified') err(w, `вопрос по факту со статусом ${f.status}`);
      if (!Array.isArray(q.options) || q.options.length < 2) err(w, 'варианты');
      if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= (q.options || []).length) err(w, 'answer');
    }
  }

  // Запрещённые слова — целыми словами, без учёта регистра, по всему data/
  const terms = all.forbidden.terms || [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) { walk(p); continue; }
      if (name === 'forbidden_terms.json') continue;
      const text = fs.readFileSync(p, 'utf8');
      for (const t of terms) {
        const re = new RegExp(`(^|[^\\p{L}\\p{N}])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'iu');
        if (re.test(text)) err(path.relative(DATA_DIR, p), `запрещённое слово «${t}»`);
      }
    }
  };
  walk(DATA_DIR);

  return errors;
}

module.exports = { loadAll, chapter, chapterIds, validate, deepMerge, CHAPTERS, SEASONS, TERRAINS, DATA_DIR };
