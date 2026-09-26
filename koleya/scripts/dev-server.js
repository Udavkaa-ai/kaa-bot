#!/usr/bin/env node
// Локальный стенд Koleya без «Билли»: ядро + мини-апп на Express и отдельная база.
//   KOLEYA_DEV_DATABASE_URL=postgres://... node koleya/scripts/dev-server.js
// Открыть в браузере: http://localhost:8787/koleya/#dev — стенд сам подпишет initData
// тестовым токеном (только на этом стенде!). Для настоящего Telegram задайте
// KOLEYA_DEV_BOT_TOKEN токеном тестового бота и HTTPS-туннель (cloudflared/ngrok).
'use strict';

const express = require('express');
const { Pool } = require('pg');
const { createKoleya, signInitData } = require('../core');
const { mountHttp } = require('../http');

const PORT = parseInt(process.env.PORT, 10) || 8787;
const TOKEN = process.env.KOLEYA_DEV_BOT_TOKEN || '000000:dev-only-token';
const DB = process.env.KOLEYA_DEV_DATABASE_URL;
if (!DB) { console.error('Задайте KOLEYA_DEV_DATABASE_URL'); process.exit(1); }

const pool = new Pool({ connectionString: DB });
const core = createKoleya({
  botToken: TOKEN,
  db: pool,
  notify: async (tgId, text) => console.log(`[notify → ${tgId}] ${text}`),
  log: (m, meta) => console.error(m, meta),
});

const app = express();
// Подпись initData для браузера без Telegram — только когда токен тестовый
app.get('/koleya/dev-init', (req, res) => {
  if (process.env.KOLEYA_DEV_BOT_TOKEN) return res.status(403).end();
  const id = parseInt(req.query.user, 10) || 1;
  res.type('text/plain').send(signInitData({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id, first_name: 'Инженер' }),
  }, TOKEN));
});
mountHttp(app, core);

core.migrate().then(() => app.listen(PORT, () => console.log(`Koleya dev: http://localhost:${PORT}/koleya/`)));
