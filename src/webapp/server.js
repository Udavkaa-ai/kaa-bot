const express = require('express');
const path = require('path');
const config = require('../config');
const eyeballRepo = require('../db/repo/eyeball');
const { verifyInitData } = require('./auth');

let botRef = null;
function setBot(bot) { botRef = bot; }

function authMiddleware(req, res, next) {
  const initData = (req.body && req.body.initData) || req.query.initData;
  const data = verifyInitData(initData);
  if (!data || !data.user) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  req.tgUser = data.user;
  const sp = data.start_param;
  req.tgChatId = sp ? parseInt(sp, 10) : null;
  if (!Number.isFinite(req.tgChatId)) req.tgChatId = null;
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

  app.use('/eyeball', express.static(path.join(__dirname, '..', '..', 'public', 'eyeball'), {
    maxAge: '5m',
    extensions: ['html'],
  }));

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
      res.json({ ok: true });
    } catch (err) {
      console.error('[EYEBALL FINISH]', err.message);
      res.status(500).json({ error: 'server' });
    }
  });

  app.get('/api/eyeball/leaderboard', authMiddleware, async (req, res) => {
    try {
      if (!req.tgChatId) return res.status(400).json({ error: 'no_chat' });
      const top = await eyeballRepo.topByStreak(req.tgChatId, 10);
      res.json({
        top: top.map(r => ({
          user_id: String(r.user_id),
          username: r.username || ('id' + r.user_id),
          best_streak: r.best_streak,
          best_accuracy: Number(r.best_accuracy),
          rounds: r.rounds,
        })),
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
      const streak = clampInt(req.body.streak, 0, 99999);
      const accuracy = clampFloat(req.body.bestAccuracy, 0, 100);
      const rounds = clampInt(req.body.rounds, 0, 99999);
      const name = userDisplay(u, true);
      const text =
        `👁 ${name} — eyeball\n` +
        `🔥 streak ${streak}\n` +
        `🎯 best ${accuracy.toFixed(1)}%\n` +
        `🎲 rounds ${rounds}`;
      await botRef.sendMessage(req.tgChatId, text, { disable_notification: true });
      res.json({ ok: true });
    } catch (err) {
      console.error('[EYEBALL SHARE]', err.message);
      res.status(500).json({ error: 'send_failed' });
    }
  });

  app.use((req, res) => res.status(404).json({ error: 'not_found' }));

  app.listen(config.webappPort, () => {
    console.log(`[WEB] Express on :${config.webappPort} (mini-app at /eyeball)`);
  });
}

module.exports = { start, setBot };
