const express = require('express');
const path = require('path');
const config = require('../config');
const eyeballRepo = require('../db/repo/eyeball');
const quizRepo = require('../db/repo/quiz');
const arena = require('./quizArena');
const { generateVerifiedQuestion } = require('../handlers/quiz');
const { verifyInitData } = require('./auth');

let botRef = null;
function setBot(bot) {
  botRef = bot;
  // Эрудит: приглашения на турнир и итоги бот постит в чат
  arena.setBot(bot);
}

function authMiddleware(req, res, next) {
  const initData = (req.body && req.body.initData) || req.query.initData;
  const data = verifyInitData(initData);
  if (!data || !data.user) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  req.tgUser = data.user;
  const sp = data.start_param;
  let chatId = sp ? parseInt(sp, 10) : null;
  if (!Number.isFinite(chatId)) chatId = null;
  // Если мини-апп открыт без startapp (через меню-кнопку, прямой t.me/bot/app) —
  // считаем что это приватный чат с юзером (chat_id = user.id).
  if (chatId === null) chatId = data.user.id;
  req.tgChatId = chatId;
  next();
}

function clampInt(v, min, max) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function clampFloat(v, min, max) {
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function userDisplay(user, asMention) {
  if (asMention && user.username) return '@' + user.username;
  return user.first_name || user.username || ('id' + user.id);
}

function start() {
  const app = express();
  app.use(express.json({ limit: '32kb' }));
  app.disable('x-powered-by');

  const staticOpts = {
    extensions: ['html'],
    index: 'index.html',
    setHeaders(res, filePath) {
      // JS/CSS/HTML — не кешируем, чтобы Telegram-браузер сразу подхватывал апдейты.
      // Статичные ассеты (картинки, шрифты) — можно кешировать долго.
      if (/\.(html|js|css)$/i.test(filePath)) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=604800');
      }
    },
  };
  const pub = path.join(__dirname, '..', '..', 'public');
  app.use('/eyeball', express.static(path.join(pub, 'eyeball'), staticOpts));
  app.use('/quiz', express.static(path.join(pub, 'quiz'), staticOpts));

  app.get('/', (req, res) => res.redirect(302, '/eyeball/'));
  app.get('/eyeball', (req, res) => res.redirect(302, '/eyeball/'));
  app.get('/quiz', (req, res) => res.redirect(302, '/quiz/'));

  app.get('/healthz', (req, res) => res.type('text/plain').send('ok'));

  app.post('/api/eyeball/finish', authMiddleware, async (req, res) => {
    try {
      if (!req.tgChatId) return res.status(400).json({ error: 'no_chat' });
      const streak = clampInt(req.body.streak, 0, 99999);
      const bestAccuracy = clampFloat(req.body.bestAccuracy, 0, 100);
      const addRounds = clampInt(req.body.addRounds, 0, 1000);
      const u = req.tgUser;
      await eyeballRepo.upsertScore(req.tgChatId, u.id, userDisplay(u, false), {
        streak, bestAccuracy, addRounds,
      });
      // Точность отдельного раунда — для скользящей средней последних 100
      if (req.body.roundAccuracy !== undefined && req.body.roundAccuracy !== null) {
        const roundAcc = clampFloat(req.body.roundAccuracy, 0, 100);
        await eyeballRepo.addRound(req.tgChatId, u.id, roundAcc);
      }
      res.json({ ok: true });
    } catch (err) {
      console.error('[EYEBALL FINISH]', err.message);
      res.status(500).json({ error: 'server' });
    }
  });

  app.get('/api/eyeball/leaderboard', authMiddleware, async (req, res) => {
    try {
      if (!req.tgChatId) return res.status(400).json({ error: 'no_chat' });
      // ?season=1|2 → архивы, иначе → текущий сезон (3)
      const seasonParam = parseInt(req.query.season, 10);
      const season = (seasonParam === 1 || seasonParam === 2) ? seasonParam : eyeballRepo.CURRENT_SEASON;
      const metric = req.query.metric === 'avg' ? 'avg' : 'streak';
      const [top, me, agg] = await Promise.all([
        eyeballRepo.topByStreak(req.tgChatId, 10, season, metric),
        eyeballRepo.getUserStats(req.tgChatId, req.tgUser.id, season),
        eyeballRepo.getChatAggregates(req.tgChatId, season),
      ]);
      res.json({
        season,
        metric,
        top: top.map(r => ({
          user_id: String(r.user_id),
          username: r.username || ('id' + r.user_id),
          best_streak: r.best_streak,
          best_accuracy: Number(r.best_accuracy),
          avg_last_100: Number(r.avg_last_100 || 0),
          rounds: r.rounds,
        })),
        me: me ? {
          best_streak: me.best_streak,
          best_accuracy: Number(me.best_accuracy),
          avg_last_100: Number(me.avg_last_100 || 0),
          rounds: me.rounds,
          rank: Number(me.rank),
        } : null,
        aggregates: {
          avg_acc: Number(agg.avg_acc),
          max_acc: Number(agg.max_acc),
          max_streak: Number(agg.max_streak),
          total_rounds: Number(agg.total_rounds),
          players: Number(agg.players),
        },
      });
    } catch (err) {
      console.error('[EYEBALL LB]', err.message);
      res.status(500).json({ error: 'server' });
    }
  });

  app.post('/api/eyeball/share', authMiddleware, async (req, res) => {
    try {
      if (!req.tgChatId) return res.status(400).json({ error: 'no_chat' });
      if (!botRef) return res.status(503).json({ error: 'bot_not_ready' });
      const u = req.tgUser;
      // Берём АКТУАЛЬНУЮ статистику игрока из БД (текущий сезон), а не то что прислал клиент
      const stats = await eyeballRepo.getUserStats(req.tgChatId, u.id, eyeballRepo.CURRENT_SEASON);
      if (!stats || !stats.rounds) {
        return res.status(400).json({ error: 'no_stats' });
      }
      // Без @-упоминания — чтобы шаринг не тегал автора уведомлением у всех
      const name = userDisplay(u, false);
      const streak = stats.best_streak || 0;
      const bestAcc = Number(stats.best_accuracy || 0);
      const avg = Number(stats.avg_last_100 || 0);
      const rounds = stats.rounds || 0;
      const rank = Number(stats.rank || 0);
      const lines = [
        `Сечение · ${name}`,
        `🏆 место в чате: #${rank}`,
        `🔥 лучшая серия: ${streak}`,
      ];
      if (avg > 0) lines.push(`📈 средняя (за 100): ${avg.toFixed(1)}%`);
      lines.push(`🎯 лучшая точность: ${bestAcc.toFixed(1)}%`);
      lines.push(`🎲 раундов сыграно: ${rounds}`);
      const text = lines.join('\n');
      const sendOpts = { disable_notification: true };
      // В личке добавляем эффект 🎉 (message_effect_id работает только в private)
      if (req.tgChatId > 0) sendOpts.message_effect_id = '5046509860389126442';
      await botRef.sendMessage(req.tgChatId, text, sendOpts);
      res.json({ ok: true });
    } catch (err) {
      console.error('[EYEBALL SHARE]', err.message);
      res.status(500).json({ error: 'send_failed' });
    }
  });

  // ===== Эрудит (викторина): тренировка + соревнования =====

  // Тренировка: вопрос по запросу, с ответом и объяснением (соло — списывать не у кого)
  const soloBusy = new Set();
  app.post('/api/quiz/solo/question', authMiddleware, async (req, res) => {
    const key = `${req.tgChatId}:${req.tgUser.id}`;
    if (soloBusy.has(key)) return res.status(429).json({ error: 'Подожди, вопрос уже готовится' });
    soloBusy.add(key);
    try {
      const topic = String(req.body.topic || '').slice(0, 60).trim() || null;
      const avoidClient = Array.isArray(req.body.avoid) ? req.body.avoid.map(String).slice(0, 40) : [];
      let recent = [];
      try { recent = await quizRepo.getRecentQuestions(req.tgChatId, 30); } catch (_) {}
      const q = await generateVerifiedQuestion(topic, [...new Set([...avoidClient, ...recent])]);
      if (!q) return res.status(503).json({ error: 'Не получилось подготовить вопрос' });
      res.json({ question: q });
    } catch (err) {
      console.error('[QUIZ SOLO]', err.message);
      res.status(500).json({ error: 'server' });
    } finally {
      soloBusy.delete(key);
    }
  });

  // Чатовый топ викторины — те же данные, что у /leaderboard в чате
  app.get('/api/quiz/leaderboard', authMiddleware, async (req, res) => {
    try {
      // ?season=1 → архив, иначе текущий сезон
      const season = parseInt(req.query.season, 10) === 1 ? 1 : quizRepo.CURRENT_SEASON;
      const [top, me, agg] = await Promise.all([
        quizRepo.getLeaderboard(req.tgChatId, 10, season),
        quizRepo.getUserStanding(req.tgChatId, req.tgUser.id, season),
        quizRepo.getAggregates(req.tgChatId, season),
      ]);
      res.json({
        season,
        top: top.map(r => ({
          user_id: String(r.user_id),
          name: String(r.username || ('id' + r.user_id)).replace(/^@/, ''),
          correct: r.correct, total: r.total, pct: Number(r.pct),
        })),
        me: me ? { correct: me.correct, total: me.total, pct: Number(me.pct), rank: Number(me.rank) } : null,
        aggregates: {
          players: Number(agg.players), max_correct: Number(agg.max_correct),
          avg_pct: Number(agg.avg_pct), max_pct: Number(agg.max_pct),
        },
      });
    } catch (err) {
      console.error('[QUIZ LB]', err.message);
      res.status(500).json({ error: 'server' });
    }
  });

  const arenaUser = (req) => ({ id: req.tgUser.id, name: userDisplay(req.tgUser, false) });
  const arenaReply = (res, chatId, userId) => res.json(arena.getState(chatId, userId) || { exists: false });
  const arenaFail = (res, err) => res.status(400).json({ error: err.message });

  app.get('/api/quiz/arena/state', authMiddleware, (req, res) => {
    arenaReply(res, req.tgChatId, req.tgUser.id);
  });
  app.post('/api/quiz/arena/create', authMiddleware, (req, res) => {
    try {
      const topic = String(req.body.topic || '').slice(0, 60).trim();
      const count = parseInt(req.body.count, 10) || 10;
      arena.createRoom(req.tgChatId, arenaUser(req), topic, count);
      arenaReply(res, req.tgChatId, req.tgUser.id);
    } catch (err) { arenaFail(res, err); }
  });
  app.post('/api/quiz/arena/join', authMiddleware, (req, res) => {
    try { arena.join(req.tgChatId, arenaUser(req)); arenaReply(res, req.tgChatId, req.tgUser.id); }
    catch (err) { arenaFail(res, err); }
  });
  app.post('/api/quiz/arena/leave', authMiddleware, (req, res) => {
    try { arena.leave(req.tgChatId, req.tgUser.id); arenaReply(res, req.tgChatId, req.tgUser.id); }
    catch (err) { arenaFail(res, err); }
  });
  app.post('/api/quiz/arena/start', authMiddleware, (req, res) => {
    try { arena.start(req.tgChatId, req.tgUser.id); arenaReply(res, req.tgChatId, req.tgUser.id); }
    catch (err) { arenaFail(res, err); }
  });
  app.post('/api/quiz/arena/answer', authMiddleware, (req, res) => {
    try {
      const qIndex = parseInt(req.body.qIndex, 10);
      const option = parseInt(req.body.option, 10);
      if (!(option >= 0 && option <= 3)) throw new Error('bad option');
      arena.answer(req.tgChatId, req.tgUser.id, qIndex, option);
      arenaReply(res, req.tgChatId, req.tgUser.id);
    } catch (err) { arenaFail(res, err); }
  });

  app.use((req, res) => res.status(404).json({ error: 'not_found' }));

  app.listen(config.webappPort, () => {
    console.log(`[WEB] Express on :${config.webappPort} (mini-app at /eyeball)`);
  });
}

module.exports = { start, setBot };
