#!/usr/bin/env node
// Веб-версия «Пяти футов»: игра в обычном браузере, без Telegram.
// Отдельный сервис на Railway (koleya/web/railway.json), своя или общая с «Билли» база Postgres.
//   DATABASE_URL=postgres://... KOLEYA_WEB_SECRET=<длинная случайная строка> node koleya/web/server.js
// Вход — гостевой: сервер выдаёт подписанный токен игрока, браузер хранит его у себя.
// Если задан KOLEYA_BOT_TOKEN, тот же сервер принимает и запросы из Telegram (initData).
'use strict';

const express = require('express');
const { Pool } = require('pg');
const { createKoleya, signWebToken, newWebPlayerId } = require('../core');
const { mountHttp } = require('../http');

const PORT = parseInt(process.env.PORT, 10) || 8080;
const DB = process.env.DATABASE_URL;
const SECRET = process.env.KOLEYA_WEB_SECRET;
if (!DB) { console.error('Задайте DATABASE_URL'); process.exit(1); }
if (!SECRET || SECRET.length < 32) { console.error('Задайте KOLEYA_WEB_SECRET — случайную строку не короче 32 символов'); process.exit(1); }

// Выдача гостевых токенов: не больше SESSION_LIMIT новых игроков в час с одного адреса
const SESSION_LIMIT = parseInt(process.env.KOLEYA_WEB_SESSIONS_PER_HOUR, 10) || 20;
const HOUR_MS = 3600 * 1000;

const pool = new Pool({
  connectionString: DB,
  ssl: /sslmode=require/.test(DB) ? { rejectUnauthorized: false } : undefined,
});
const core = createKoleya({
  botToken: process.env.KOLEYA_BOT_TOKEN || null,
  webSecret: SECRET,
  db: pool,
  log: (m, meta) => console.error(m, meta),
});

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

const issued = new Map();
app.post('/koleya/web/session', (req, res) => {
  const now = Date.now();
  const ip = req.ip || 'unknown';
  const recent = (issued.get(ip) || []).filter(t => now - t < HOUR_MS);
  if (recent.length >= SESSION_LIMIT) return res.status(429).json({ error: 'Слишком много новых игр с этого адреса. Попробуйте через час.' });
  recent.push(now);
  issued.set(ip, recent);
  if (issued.size > 10000) for (const [k, v] of issued) if (!v.some(t => now - t < HOUR_MS)) issued.delete(k);
  res.json({ token: signWebToken(newWebPlayerId(), SECRET, Math.floor(now / 1000)) });
});

app.get('/healthz', (req, res) => res.type('text/plain').send('ok'));
app.get('/', (req, res) => res.redirect(302, '/koleya/'));
mountHttp(app, core);

core.migrate()
  .then(() => app.listen(PORT, () => console.log(`«Пять футов» (веб): порт ${PORT}`)))
  .catch(err => { console.error('Не удалось подготовить базу', err); process.exit(1); });
