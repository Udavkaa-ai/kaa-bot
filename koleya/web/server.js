#!/usr/bin/env node
// Веб-версия «Пяти футов»: игра в обычном браузере, без Telegram.
// Отдельный сервис на Railway (koleya/web/railway.json), своя или общая с «Билли» база Postgres.
//   DATABASE_URL=postgres://... KOLEYA_WEB_SECRET=<длинная случайная строка> node koleya/web/server.js
// Вход — гостевой: сервер выдаёт подписанный токен игрока, браузер хранит его у себя.
// Вход через Telegram (Login Widget): KOLEYA_BOT_TOKEN — токен бота «Билли», KOLEYA_BOT_USERNAME — его имя
// без @; домен сайта должен быть привязан к боту в @BotFather (/setdomain). Игрок получает свой
// Telegram id — прогресс общий с мини-аппом, прогресс гостя переносится при входе.
'use strict';

const crypto = require('crypto');
const express = require('express');
const { Pool } = require('pg');
const { createKoleya, signWebToken, newWebPlayerId, signTelegramSession, verifyTelegramLogin, verifyWebToken } = require('../core');
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
  botToken: process.env.KOLEYA_BOT_TOKEN || null, // заодно принимает initData из мини-аппа
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

const BOT_TOKEN = process.env.KOLEYA_BOT_TOKEN || null;
const BOT_USERNAME = (process.env.KOLEYA_BOT_USERNAME || '').replace(/^@/, '') || null;
app.get('/koleya/web/config', (req, res) => res.json({ telegramLogin: BOT_TOKEN && BOT_USERNAME ? BOT_USERNAME : null }));

app.post('/koleya/web/telegram-login', express.json({ limit: '4kb' }), async (req, res) => {
  if (!BOT_TOKEN) return res.status(404).json({ error: 'Вход через Telegram не настроен' });
  const login = verifyTelegramLogin(req.body && req.body.auth, BOT_TOKEN, Math.floor(Date.now() / 1000));
  if (!login) return res.status(401).json({ error: 'Telegram не подтвердил вход. Попробуйте ещё раз.' });
  const { id, first_name: name } = login.user;
  try {
    const guest = verifyWebToken(String((req.body && req.body.guestToken) || ''), SECRET);
    const adopted = guest && !guest.telegram ? await core.adoptGuest(guest.user.id, id, name) : { moved: 0 };
    res.json({ token: signTelegramSession(id, SECRET, Math.floor(Date.now() / 1000)), name, moved: adopted.moved });
  } catch (err) {
    console.error('telegram-login', err);
    res.status(500).json({ error: 'Не удалось войти, попробуйте позже' });
  }
});

// Вход по имени — без сторонних сервисов: уникальное имя + короткий PIN (хранится как scrypt-хеш).
// Под именем закреплён гостевой id; на другом устройстве то же имя и PIN возвращают ту же игру.
const NAMES_MIGRATION = `
CREATE TABLE IF NOT EXISTS koleya_web_names (
  name_key TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  player_id BIGINT NOT NULL,
  pin_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);`;
const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} _.-]{1,23}$/u;
const PIN_RE = /^\d{4,8}$/;
const nameKey = n => n.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
const hashPin = (pin, salt = crypto.randomBytes(16).toString('hex')) => `${salt}:${crypto.scryptSync(pin, salt, 32).toString('hex')}`;
function pinOk(pin, stored) {
  const [salt, hex] = String(stored).split(':');
  const given = crypto.scryptSync(pin, salt, 32);
  const want = Buffer.from(hex || '', 'hex');
  return want.length === given.length && crypto.timingSafeEqual(want, given);
}
// Не больше 10 неудачных попыток PIN в час на имя и 60 попыток входа в час с адреса
const failsByName = new Map(), triesByIp = new Map();
const recentOf = (map, key, now) => (map.get(key) || []).filter(t => now - t < HOUR_MS);

app.post('/koleya/web/name-login', express.json({ limit: '2kb' }), async (req, res) => {
  const now = Date.now();
  const ip = req.ip || 'unknown';
  const tries = recentOf(triesByIp, ip, now);
  if (tries.length >= 60) return res.status(429).json({ error: 'Слишком много попыток. Попробуйте через час.' });
  triesByIp.set(ip, [...tries, now]);
  const name = String((req.body && req.body.name) || '').trim().replace(/\s+/g, ' ');
  const pin = String((req.body && req.body.pin) || '');
  if (!NAME_RE.test(name)) return res.status(400).json({ error: 'Имя — от 2 до 24 символов: буквы, цифры, пробел, точка, дефис.' });
  if (!PIN_RE.test(pin)) return res.status(400).json({ error: 'PIN — от 4 до 8 цифр.' });
  const key = nameKey(name);
  const fails = recentOf(failsByName, key, now);
  if (fails.length >= 10) return res.status(429).json({ error: 'Слишком много неверных PIN для этого имени. Попробуйте через час.' });
  try {
    const guest = verifyWebToken(String((req.body && req.body.guestToken) || ''), SECRET);
    const guestId = guest && !guest.telegram ? guest.user.id : null;
    const found = (await pool.query('SELECT display_name, player_id, pin_hash FROM koleya_web_names WHERE name_key = $1', [key])).rows[0];
    if (!found) {
      // Новое имя: закрепляем за ним текущую игру гостя (или новый id)
      const playerId = guestId || newWebPlayerId();
      const ins = await pool.query('INSERT INTO koleya_web_names (name_key, display_name, player_id, pin_hash) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [key, name, playerId, hashPin(pin)]);
      if (!ins.rowCount) return res.status(409).json({ error: 'Это имя только что заняли. Выберите другое.' });
      return res.json({ token: signWebToken(playerId, SECRET, Math.floor(now / 1000)), name, created: true, moved: 0 });
    }
    if (!pinOk(pin, found.pin_hash)) {
      failsByName.set(key, [...fails, now]);
      return res.status(401).json({ error: 'Имя занято, а PIN не подходит. Если это ваше имя — проверьте PIN, если нет — выберите другое.' });
    }
    const playerId = Number(found.player_id);
    const adopted = guestId && guestId !== playerId ? await core.adoptGuest(guestId, playerId, found.display_name) : { moved: 0 };
    res.json({ token: signWebToken(playerId, SECRET, Math.floor(now / 1000)), name: found.display_name, created: false, moved: adopted.moved });
  } catch (err) {
    console.error('name-login', err);
    res.status(500).json({ error: 'Не удалось войти, попробуйте позже' });
  }
});

app.get('/healthz', (req, res) => res.type('text/plain').send('ok'));
app.get('/', (req, res) => res.redirect(302, '/koleya/'));
mountHttp(app, core);

core.migrate()
  .then(() => pool.query(NAMES_MIGRATION))
  .then(() => app.listen(PORT, () => console.log(`«Пять футов» (веб): порт ${PORT}`)))
  .catch(err => { console.error('Не удалось подготовить базу', err); process.exit(1); });
