'use strict';
// Тесты ядра API на настоящем Postgres. Нужна переменная KOLEYA_TEST_DATABASE_URL,
// иначе тесты пропускаются (в CI и у «Билли» базы для тестов может не быть).
const test = require('node:test');
const assert = require('node:assert/strict');
const { createKoleya, verifyInitData, signInitData, signWebToken, verifyWebToken, newWebPlayerId } = require('../core');

const TOKEN = '123456:TEST-token';
const DB_URL = process.env.KOLEYA_TEST_DATABASE_URL;

function initData(userId, { authDate = Math.floor(Date.now() / 1000), token = TOKEN } = {}) {
  return signInitData({ auth_date: String(authDate), user: JSON.stringify({ id: userId, first_name: 'Тест' }), query_id: 'q1' }, token);
}

test('initData: верная подпись проходит, подделка и старая дата — нет', () => {
  const now = Math.floor(Date.now() / 1000);
  const ok = verifyInitData(initData(1), TOKEN, now);
  assert.equal(ok.user.id, 1);
  assert.equal(verifyInitData(initData(1, { token: '999:other' }), TOKEN, now), null, 'подписано чужим токеном');
  const tampered = initData(1).replace('%22id%22%3A1', '%22id%22%3A2');
  assert.equal(verifyInitData(tampered, TOKEN, now), null, 'подменён user');
  assert.equal(verifyInitData(initData(1, { authDate: now - 2 * 86400 }), TOKEN, now), null, 'просрочено');
  assert.equal(verifyInitData('', TOKEN, now), null);
  assert.equal(verifyInitData('hash=zz', TOKEN, now), null);
});

test('веб-версия: гостевой токен проверяется подписью и диапазоном id', async () => {
  const SECRET = 'x'.repeat(40);
  const id = newWebPlayerId();
  const token = signWebToken(id, SECRET, 1700000000);
  assert.equal(verifyWebToken(token, SECRET).user.id, id);
  assert.equal(verifyWebToken(token, 'y'.repeat(40)), null, 'чужой секрет');
  assert.equal(verifyWebToken(signWebToken(777, SECRET, 1), SECRET), null, 'id из диапазона Telegram');
  assert.equal(verifyWebToken(token.slice(0, -1) + (token.endsWith('0') ? '1' : '0'), SECRET), null, 'подделка');
  const db = { query: async () => ({ rows: [] }) };
  const withWeb = createKoleya({ botToken: TOKEN, webSecret: SECRET, db });
  assert.notEqual((await withWeb.handleApi({ method: 'GET', path: '/nope', webToken: token })).status, 401, 'токен принят');
  assert.equal((await withWeb.handleApi({ method: 'GET', path: '/game', webToken: 'garbage' })).status, 401);
  const noWeb = createKoleya({ botToken: TOKEN, db });
  assert.equal((await noWeb.handleApi({ method: 'GET', path: '/game', webToken: token })).status, 401, 'без секрета веб-вход выключен');
});

test('API: без подписи — 401', async () => {
  const k = createKoleya({ botToken: TOKEN, db: { query: async () => ({ rows: [] }) } });
  const r = await k.handleApi({ method: 'GET', path: '/game', initData: 'user=%7B%7D&hash=00' });
  assert.equal(r.status, 401);
});

test('API: полный путь пролога через HTTP-контракт', { skip: !DB_URL && 'нет KOLEYA_TEST_DATABASE_URL' }, async () => {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: DB_URL });
  await pool.query('DROP TABLE IF EXISTS koleya_players, koleya_games, koleya_museum, koleya_quiz_results');
  const notes = [];
  const k = createKoleya({
    botToken: TOKEN, db: pool, randomSeed: () => 42,
    notify: async (id, text) => { notes.push({ id, text }); },
  });
  await k.migrate();
  await k.migrate(); // идемпотентно
  const call = (method, path, body, user = 777) => k.handleApi({ method, path, body, query: body, initData: initData(user) });

  let r = await call('GET', '/game');
  assert.equal(r.status, 200);
  assert.equal(r.body.game, null);

  r = await call('GET', '/content', { chapter: 'chapter1' });
  assert.equal(r.status, 200);
  assert.ok(r.body.map.segments.length > 10);
  assert.equal(r.body.quiz, undefined, 'ответы викторины клиенту не отдаются');

  r = await call('POST', '/game/start', { chapter: 'chapter1' });
  assert.equal(r.status, 409, 'без пролога глава I закрыта');
  assert.match(r.body.error, /пролог/);

  r = await call('POST', '/game/start', { chapter: 'prologue' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.state.pendingEvents, ['P01']);
  assert.equal(r.body.state.rngState, undefined, 'генератор не утекает клиенту');

  r = await call('POST', '/game/action', { action: { type: 'END_SEASON' } });
  assert.equal(r.status, 409, 'сначала депеша');

  // Играем ботом через API до конца пролога
  const content = require('../content');
  const { chooseFor } = require('../scripts/bots');
  const ch = content.chapter('prologue');
  let state = r.body.state;
  ({ body: { state } } = await call('GET', '/game').then(x => ({ body: x.body.game })));
  for (let guard = 0; guard < 80 && !state.finished; guard++) {
    let a;
    if (state.pendingEvents.length) {
      const ev = ch.eventsById[state.pendingEvents[0]];
      a = { type: 'CHOOSE', eventId: ev.id, choiceId: chooseFor('historical', ev, Math.random) };
    } else if (state.unlocked.rollingStock && !state.rollingStock.carriages) {
      await call('POST', '/game/action', { action: { type: 'BUY', itemId: 'english_early', qty: 1 } });
      a = { type: 'BUY', itemId: 'carriage', qty: 1 };
    } else if (state.unlocked.construction && state.crewsTotal < 12) {
      a = { type: 'HIRE_CREWS', amount: 12 - state.crewsTotal };
    } else if (state.unlocked.construction && !state.segments.spb_tsarskoye.opened && state.segments.spb_tsarskoye.crews < 10) {
      a = { type: 'ASSIGN_CREWS', segmentId: 'spb_tsarskoye', crews: 10 };
    } else if (state.unlocked.construction && !state.segments.tsarskoye_pavlovsk.opened && state.segments.tsarskoye_pavlovsk.crews < 2) {
      a = { type: 'ASSIGN_CREWS', segmentId: 'tsarskoye_pavlovsk', crews: 2 };
    } else a = { type: 'END_SEASON' };
    r = await call('POST', '/game/action', { action: a });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    state = r.body.state;
  }
  assert.equal(state.outcome, 'won');
  assert.ok(state.firstRun.minutes > 0);
  assert.equal(notes.length, 1);
  assert.match(notes[0].text, /глава пройдена/);

  // Викторина пролога: вопросов нет — корректный отказ
  r = await call('POST', '/quiz/start');
  assert.equal(r.status, 409);

  // Чужой игрок не видит эту игру
  r = await call('GET', '/game', null, 888);
  assert.equal(r.body.game, null);

  // После пролога глава I открыта
  r = await call('GET', '/game');
  assert.ok(r.body.unlocked.includes('chapter1'));

  // Прогресс для /koleya
  assert.match(await k.progressText(777), /глава пройдена/);
  await pool.end();
});

test('API: викторина главы 1 открывает факты в «Музее»', { skip: !DB_URL && 'нет KOLEYA_TEST_DATABASE_URL' }, async () => {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: DB_URL });
  const k = createKoleya({ botToken: TOKEN, db: pool, randomSeed: () => 3 });
  await k.migrate();
  const call = (method, path, body) => k.handleApi({ method, path, body, query: body, initData: initData(555) });
  const content = require('../content');
  const { playGame } = require('../scripts/bots');
  const ch = content.chapter('chapter1');
  // Готовую победную партию кладём в базу напрямую — прохождение через API проверено выше
  const won = playGame(ch, 3, 'historical');
  assert.equal(won.outcome, 'won');
  await pool.query(`INSERT INTO koleya_players (tg_id, completed) VALUES (555, '{"prologue":{}}') ON CONFLICT (tg_id) DO UPDATE SET completed = '{"prologue":{}}'`);
  await call('POST', '/game/start', { chapter: 'chapter1' });
  await pool.query('UPDATE koleya_games SET state = $1 WHERE tg_id = 555 AND chapter = $2', [JSON.stringify(won), 'chapter1']);

  let r = await call('POST', '/quiz/start');
  assert.equal(r.status, 200);
  assert.equal(r.body.questions.length, 5);
  assert.ok(r.body.questions.every(q => q.correct === null), 'ответы не раскрыты до ответа');
  const again = await call('POST', '/quiz/start');
  assert.deepEqual(again.body.questions.map(q => q.id), r.body.questions.map(q => q.id), 'набор стабилен');

  const quiz = ch.quiz;
  let lastBody;
  for (const q of r.body.questions) {
    const right = quiz.find(x => x.id === q.id).answer;
    const res = await call('POST', '/quiz/answer', { questionId: q.id, option: right });
    assert.equal(res.status, 200);
    assert.equal(res.body.last.correct, true);
    lastBody = res.body;
  }
  assert.equal(lastBody.done, true);
  assert.equal(lastBody.score, 5);
  r = await call('POST', '/quiz/answer', { questionId: lastBody.questions[0].id, option: 0 });
  assert.equal(r.status, 409, 'повторный ответ нельзя');
  r = await call('GET', '/museum');
  assert.equal(r.body.facts.length, 5);
  assert.ok(r.body.facts.every(f => f.status === 'verified'));
  await pool.end();
});
