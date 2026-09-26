// Ядро Koleya: API игры, хранилище, проверка initData.
// Не знает ни про библиотеку бота, ни про HTTP-фреймворк: получает запрос
// { method, path, query, body, initData } и возвращает { status, body }.
//
// Хранилище — Postgres «Билли» (отдельные таблицы koleya_*, свои миграции).
// Файл SQLite из архитектуры не подходит: на Railway диск контейнера
// стирается при каждом деплое, а база «Билли» живёт отдельно и переживает деплои.
'use strict';

const crypto = require('crypto');
const path = require('path');
const content = require('../content');
const E = require('../engine');

const INIT_DATA_MAX_AGE_SEC = 24 * 60 * 60;
const QUIZ_SIZE = 5;
const CHAPTER_ORDER = ['prologue', 'chapter1'];

const MIGRATION = `
CREATE TABLE IF NOT EXISTS koleya_players (
  tg_id BIGINT PRIMARY KEY,
  name TEXT,
  active_chapter TEXT,
  completed JSONB NOT NULL DEFAULT '{}'::jsonb,
  campaign JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS koleya_games (
  tg_id BIGINT NOT NULL,
  chapter TEXT NOT NULL,
  state JSONB NOT NULL,
  quiz JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (tg_id, chapter)
);
CREATE TABLE IF NOT EXISTS koleya_museum (
  tg_id BIGINT NOT NULL,
  fact_id TEXT NOT NULL,
  opened_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (tg_id, fact_id)
);
CREATE TABLE IF NOT EXISTS koleya_quiz_results (
  id BIGSERIAL PRIMARY KEY,
  tg_id BIGINT NOT NULL,
  chapter TEXT NOT NULL,
  score INTEGER NOT NULL,
  total INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
`;

// ---------- initData (HMAC-SHA256 от токена бота + проверка auth_date) ----------

function verifyInitData(initData, botToken, nowSec) {
  if (!initData || typeof initData !== 'string' || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return null;
  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computed = crypto.createHmac('sha256', secret).update(dataCheckString).digest();
  const given = Buffer.from(hash, 'hex');
  if (given.length !== computed.length || !crypto.timingSafeEqual(given, computed)) return null;
  const authDate = parseInt(params.get('auth_date'), 10);
  if (!authDate || nowSec - authDate > INIT_DATA_MAX_AGE_SEC || authDate - nowSec > 300) return null;
  let user = null;
  try { user = JSON.parse(params.get('user') || 'null'); } catch (_) { return null; }
  if (!user || !Number.isInteger(user.id)) return null;
  return { user, startParam: params.get('start_param') || null, authDate };
}

// Подпись initData для тестов и локального стенда
function signInitData(fields, botToken) {
  const params = new URLSearchParams(fields);
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  params.set('hash', crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex'));
  return params.toString();
}

// ---------- ядро ----------

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function createKoleya(deps) {
  const { botToken, db, notify = async () => {}, log = () => {}, now = () => Date.now(), randomSeed } = deps;
  if (!db || typeof db.query !== 'function') throw new Error('koleya: нужен db.query');
  const seedGen = randomSeed || (() => crypto.randomBytes(4).readUInt32LE(0));
  const locks = new Map(); // tgId → Promise: действия одного игрока выполняются по очереди

  async function withLock(tgId, fn) {
    const prev = locks.get(tgId) || Promise.resolve();
    let release;
    const cur = new Promise(r => { release = r; });
    locks.set(tgId, prev.then(() => cur));
    await prev;
    try { return await fn(); } finally {
      release();
      if (locks.get(tgId) === cur || locks.size > 1000) locks.delete(tgId);
    }
  }

  async function migrate() { await db.query(MIGRATION); }

  // ---- хранилище ----
  async function getPlayer(tgId) {
    const r = await db.query('SELECT * FROM koleya_players WHERE tg_id = $1', [tgId]);
    return r.rows[0] || null;
  }
  async function upsertPlayer(tgId, name, patch = {}) {
    await db.query(
      `INSERT INTO koleya_players (tg_id, name, active_chapter, completed, campaign)
       VALUES ($1, $2, $3, COALESCE($4::jsonb, '{}'::jsonb), COALESCE($5::jsonb, '{}'::jsonb))
       ON CONFLICT (tg_id) DO UPDATE SET
         name = COALESCE(EXCLUDED.name, koleya_players.name),
         active_chapter = COALESCE($3, koleya_players.active_chapter),
         completed = CASE WHEN $4::jsonb IS NULL THEN koleya_players.completed ELSE koleya_players.completed || $4::jsonb END,
         campaign = CASE WHEN $5::jsonb IS NULL THEN koleya_players.campaign ELSE koleya_players.campaign || $5::jsonb END,
         updated_at = now()`,
      [tgId, name || null, patch.activeChapter || null,
        patch.completed ? JSON.stringify(patch.completed) : null,
        patch.campaign ? JSON.stringify(patch.campaign) : null]
    );
  }
  async function getGame(tgId, chapter) {
    const r = await db.query('SELECT state, quiz FROM koleya_games WHERE tg_id = $1 AND chapter = $2', [tgId, chapter]);
    return r.rows[0] || null;
  }
  async function saveGame(tgId, chapter, state, quiz) {
    await db.query(
      `INSERT INTO koleya_games (tg_id, chapter, state, quiz) VALUES ($1, $2, $3, $4)
       ON CONFLICT (tg_id, chapter) DO UPDATE SET state = EXCLUDED.state, quiz = EXCLUDED.quiz, updated_at = now()`,
      [tgId, chapter, JSON.stringify(state), quiz ? JSON.stringify(quiz) : null]
    );
  }
  async function museumFacts(tgId) {
    const r = await db.query('SELECT fact_id, opened_at FROM koleya_museum WHERE tg_id = $1 ORDER BY opened_at', [tgId]);
    return r.rows;
  }

  // ---- представление для клиента ----
  function publicState(state) {
    const { rngState, seed, ...rest } = state; // генератор клиенту не нужен
    return rest;
  }
  function gamePayload(chapter, state, extra = {}) {
    const ch = content.chapter(chapter);
    return { chapter, state: publicState(state), view: E.view(state, ch), ...extra };
  }

  // Клиентский контент главы — всё, кроме ответов викторины
  function clientContent(chapter) {
    const ch = content.chapter(chapter);
    const all = content.loadAll();
    const factIds = new Set();
    for (const e of ch.events) for (const r of e.fact_refs || []) factIds.add(r);
    for (const a of ch.advisors) for (const r of a.fact_refs || []) factIds.add(r);
    for (const s of ch.map.segments) for (const r of s.fact_refs || []) factIds.add(r);
    if (ch.map.historical.firstRun?.fact_ref) factIds.add(ch.map.historical.firstRun.fact_ref);
    // Версии рядом с фактами, на которые они ссылаются (T07 — рядом с F008)
    for (const f of all.facts) if (f.status === 'to_verify' && /F\d+/.test(f.note || '')) factIds.add(f.id);
    return {
      chapter,
      map: ch.map,
      events: ch.events,
      advisors: ch.advisors,
      facts: all.facts.filter(f => factIds.has(f.id)),
      balance: ch.balance,
      order: CHAPTER_ORDER,
    };
  }

  // ---- викторина главы ----
  function pickQuiz(chapter, state, seed) {
    const ch = content.chapter(chapter);
    const all = content.loadAll();
    const seen = new Set(E.seenFactIds(state, ch));
    const pool = ch.quiz.filter(q => seen.has(q.fact_ref) && all.factsById[q.fact_ref]?.status === 'verified');
    // Детерминированно перемешиваем от сида игры, чтобы повторный запрос давал тот же набор
    let s = (seed ^ 0x5bd1e995) >>> 0;
    const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    const shuffled = pool.map(q => ({ q, k: rnd() })).sort((a, b) => a.k - b.k).map(x => x.q);
    return shuffled.slice(0, QUIZ_SIZE).map(q => q.id);
  }
  function quizView(chapter, quiz) {
    const ch = content.chapter(chapter);
    return {
      questions: quiz.ids.map(id => {
        const q = ch.quiz.find(x => x.id === id);
        const a = quiz.answers[id];
        return {
          id, question: q.question, options: q.options,
          answered: a !== undefined ? a : null,
          correct: a !== undefined ? q.answer : null,
          factId: a !== undefined ? q.fact_ref : null,
        };
      }),
      score: Object.entries(quiz.answers).filter(([id, a]) => ch.quiz.find(x => x.id === id).answer === a).length,
      done: Object.keys(quiz.answers).length >= quiz.ids.length,
    };
  }

  // ---- маршруты ----
  async function route(req, user) {
    const tgId = user.id;
    const name = user.first_name || user.username || null;
    const p = req.path.replace(/\/+$/, '') || '/';
    const body = req.body || {};

    if (req.method === 'GET' && p === '/content') {
      const chapter = String(req.query?.chapter || '');
      if (!CHAPTER_ORDER.includes(chapter)) throw new ApiError(400, 'Нет такой главы');
      return clientContent(chapter);
    }

    if (req.method === 'GET' && p === '/game') {
      const player = await getPlayer(tgId);
      const chapter = player?.active_chapter || null;
      const row = chapter ? await getGame(tgId, chapter) : null;
      const saves = {};
      for (const c of CHAPTER_ORDER) {
        const g = c === chapter ? row : await getGame(tgId, c);
        if (g) saves[c] = { finished: g.state.finished, outcome: g.state.outcome, year: g.state.year, season: g.state.season };
      }
      return {
        player: player ? { activeChapter: player.active_chapter, completed: player.completed, campaign: player.campaign } : null,
        saves,
        game: row ? gamePayload(chapter, row.state, { quiz: row.quiz ? quizView(chapter, row.quiz) : null }) : null,
      };
    }

    if (req.method === 'POST' && p === '/game/start') {
      const chapter = String(body.chapter || '');
      if (!CHAPTER_ORDER.includes(chapter)) throw new ApiError(400, 'Нет такой главы');
      return withLock(tgId, async () => {
        const ch = content.chapter(chapter);
        const { state, log: lg } = E.createGame(chapter, ch, seedGen());
        await saveGame(tgId, chapter, state, null);
        await upsertPlayer(tgId, name, { activeChapter: chapter });
        return gamePayload(chapter, state, { log: lg, quiz: null });
      });
    }

    if (req.method === 'POST' && p === '/game/resume') {
      const chapter = String(body.chapter || '');
      if (!CHAPTER_ORDER.includes(chapter)) throw new ApiError(400, 'Нет такой главы');
      const row = await getGame(tgId, chapter);
      if (!row) throw new ApiError(404, 'Сохранения этой главы нет');
      await upsertPlayer(tgId, name, { activeChapter: chapter });
      return gamePayload(chapter, row.state, { quiz: row.quiz ? quizView(chapter, row.quiz) : null });
    }

    if (req.method === 'POST' && p === '/game/action') {
      const action = body.action;
      if (!action || typeof action !== 'object' || typeof action.type !== 'string') throw new ApiError(400, 'Нет действия');
      return withLock(tgId, async () => {
        const player = await getPlayer(tgId);
        const chapter = player?.active_chapter;
        const row = chapter ? await getGame(tgId, chapter) : null;
        if (!row) throw new ApiError(404, 'Игра не начата');
        const ch = content.chapter(chapter);
        let res;
        try {
          res = E.applyAction(row.state, sanitizeAction(action), ch);
        } catch (err) {
          if (err instanceof E.GameError) throw new ApiError(409, err.message);
          throw err;
        }
        await saveGame(tgId, chapter, res.state, row.quiz);
        if (!row.state.finished && res.state.finished) await onFinished(tgId, name, chapter, res.state);
        return gamePayload(chapter, res.state, { log: res.log, quiz: row.quiz ? quizView(chapter, row.quiz) : null });
      });
    }

    if (req.method === 'POST' && p === '/quiz/start') {
      return withLock(tgId, async () => {
        const player = await getPlayer(tgId);
        const chapter = player?.active_chapter;
        const row = chapter ? await getGame(tgId, chapter) : null;
        if (!row || !row.state.finished || row.state.outcome !== 'won') throw new ApiError(409, 'Викторина — после завершения главы');
        let quiz = row.quiz;
        if (!quiz) {
          const ids = pickQuiz(chapter, row.state, row.state.seed);
          if (!ids.length) throw new ApiError(409, 'Для этой главы вопросов нет');
          quiz = { ids, answers: {} };
          await saveGame(tgId, chapter, row.state, quiz);
        }
        return quizView(chapter, quiz);
      });
    }

    if (req.method === 'POST' && p === '/quiz/answer') {
      return withLock(tgId, async () => {
        const player = await getPlayer(tgId);
        const chapter = player?.active_chapter;
        const row = chapter ? await getGame(tgId, chapter) : null;
        if (!row?.quiz) throw new ApiError(409, 'Викторина не начата');
        const quiz = row.quiz;
        const qid = String(body.questionId || '');
        const option = Number(body.option);
        if (!quiz.ids.includes(qid)) throw new ApiError(400, 'Нет такого вопроса');
        if (quiz.answers[qid] !== undefined) throw new ApiError(409, 'Уже отвечено');
        const q = content.chapter(chapter).quiz.find(x => x.id === qid);
        if (!Number.isInteger(option) || option < 0 || option >= q.options.length) throw new ApiError(400, 'Нет такого варианта');
        quiz.answers[qid] = option;
        const correct = option === q.answer;
        await saveGame(tgId, chapter, row.state, quiz);
        if (correct) {
          await db.query('INSERT INTO koleya_museum (tg_id, fact_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [tgId, q.fact_ref]);
        }
        const v = quizView(chapter, quiz);
        if (v.done) {
          await db.query('INSERT INTO koleya_quiz_results (tg_id, chapter, score, total) VALUES ($1, $2, $3, $4)', [tgId, chapter, v.score, quiz.ids.length]);
        }
        return { ...v, last: { questionId: qid, correct, answer: q.answer, factId: q.fact_ref } };
      });
    }

    if (req.method === 'GET' && p === '/museum') {
      const opened = await museumFacts(tgId);
      const all = content.loadAll();
      return {
        facts: opened.map(r => all.factsById[r.fact_id]).filter(Boolean),
        total: all.facts.filter(f => f.status === 'verified').length,
      };
    }

    throw new ApiError(404, 'Нет такого адреса');
  }

  // Только известные поля действия и правильные типы — дальше engine проверит смысл
  function sanitizeAction(a) {
    const out = { type: String(a.type) };
    for (const k of ['eventId', 'choiceId', 'segmentId', 'level', 'itemId', 'feature', 'value']) {
      if (a[k] !== undefined) out[k] = String(a[k]).slice(0, 64);
    }
    for (const k of ['crews', 'amount', 'qty']) {
      if (a[k] !== undefined) out[k] = Number(a[k]);
    }
    return out;
  }

  async function onFinished(tgId, name, chapter, state) {
    const ch = content.chapter(chapter);
    if (state.outcome === 'won') {
      await upsertPlayer(tgId, name, {
        completed: { [chapter]: { stars: state.score?.total ?? null, max: state.score?.max ?? null } },
        campaign: chapter === 'chapter1' ? { gauge: state.gauge, tracks: state.tracks, route: state.routeVariant } : undefined,
      });
      const stars = state.score ? ` · звёзд ${state.score.total} из ${state.score.max}` : '';
      await notify(tgId, `🚂 «Пять футов»: ${ch.map.title} — глава пройдена${stars}. В игре ждёт викторина.`, { button: 'open_game' }).catch(() => {});
    } else {
      const why = state.outcome === 'removed' ? 'благоволение исчерпано, вас отстранили' : 'сроки вышли';
      await notify(tgId, `📜 «Пять футов»: ${ch.map.title} — ${why}. Главу можно начать заново.`, { button: 'open_game' }).catch(() => {});
    }
  }

  async function handleApi(req) {
    try {
      const auth = verifyInitData(req.initData, botToken, Math.floor(now() / 1000));
      if (!auth) return { status: 401, body: { error: 'Не удалось проверить Telegram-подпись. Откройте игру из бота заново.' } };
      const body = await route(req, auth.user);
      return { status: 200, body };
    } catch (err) {
      if (err instanceof ApiError) return { status: err.status, body: { error: err.message } };
      log('koleya api error', { message: err.message, stack: err.stack });
      return { status: 500, body: { error: 'Ошибка сервера' } };
    }
  }

  // Короткий прогресс для текста команды /koleya
  async function progressText(tgId) {
    try {
      const player = await getPlayer(tgId);
      if (!player?.active_chapter) return null;
      const row = await getGame(tgId, player.active_chapter);
      if (!row) return null;
      const s = row.state;
      const ch = content.chapter(player.active_chapter);
      const seasonRu = { spring: 'весна', summer: 'лето', autumn: 'осень', winter: 'зима' }[s.season];
      if (s.finished) {
        return s.outcome === 'won'
          ? `${ch.map.title}: глава пройдена${s.score ? `, звёзд ${s.score.total} из ${s.score.max}` : ''}.`
          : `${ch.map.title}: глава проиграна, можно начать заново.`;
      }
      const v = E.view(s, ch);
      return `${ch.map.title}: ${seasonRu} ${s.year}, построено ${Math.round(v.overallProgress)}%.`;
    } catch (_) {
      return null;
    }
  }

  return {
    migrate,
    handleApi,
    progressText,
    staticDir: path.join(__dirname, '..', 'miniapp'),
  };
}

module.exports = { createKoleya, verifyInitData, signInitData, MIGRATION };
