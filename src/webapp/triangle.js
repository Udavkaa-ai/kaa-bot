// «Треугольник решений»: человек описывает решение, модель задаёт до трёх уточнений
// и оценивает сдвиг по осям «ресурсы — время — качество». Страница — public/triangle/,
// API — /triangle/api/triangle/{ask,estimate}. Промпты собираются здесь, на сервере,
// поэтому эндпоинт нельзя использовать как бесплатный доступ к модели.
const express = require('express');
const path = require('path');
const config = require('../config');
const claude = require('../providers/claude');
const { verifyInitData } = require('./auth');

const BASE = '/triangle';
const APP_SHORT_NAME = process.env.TRIANGLE_APP || 'ocenka';
const PER_HOUR = parseInt(process.env.TRIANGLE_PER_HOUR, 10) || 40;
// Необязательно: своя модель (или список через запятую) первой в цепочке
const PREFERRED = (process.env.TRIANGLE_MODEL || '').split(',').map(s => s.trim()).filter(Boolean);

/* ---------- лимит запросов на пользователя (в памяти, на один инстанс) ---------- */
function makeLimiter(perHour) {
  const hits = new Map();
  return (key) => {
    const now = Date.now(), from = now - 3600_000;
    const list = (hits.get(key) || []).filter(t => t > from);
    if (list.length >= perHour) { hits.set(key, list); return false; }
    list.push(now); hits.set(key, list);
    if (hits.size > 10_000) for (const [k, v] of hits) if (!v.some(t => t > from)) hits.delete(k);
    return true;
  };
}

/* ---------- разбор JSON из ответа модели ---------- */
function parseJsonLoose(text) {
  if (!text) return null;
  const tryParse = (s) => { try { return JSON.parse(s); } catch { return undefined; } };
  let v = tryParse(text.trim());
  if (v !== undefined) return v;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) { v = tryParse(fence[1].trim()); if (v !== undefined) return v; }
  const i = text.indexOf('{'), j = text.lastIndexOf('}');
  if (i >= 0 && j > i) { v = tryParse(text.slice(i, j + 1)); if (v !== undefined) return v; }
  return null;
}

/* ---------- промпты ---------- */
const clip = (s, n) => String(s ?? '').slice(0, n);

function askPrompt(text) {
  return `Пользователь описал решение из жизни или работы. Чтобы оценить его по осям «ресурсы — время — качество» и предложить альтернативы, какие детали важнее всего уточнить?
Задай от 0 до 3 коротких вопросов — только те, ответ на которые реально изменит оценку (расстояние, бюджет, срочность, как человек поступает обычно, что для него важнее и т. п.). Не спрашивай очевидное из текста. Для каждого вопроса дай 2–4 варианта ответа по 1–4 слова. Если всё ясно — верни пустой список.
Пиши по-русски. Ответь только JSON: {"questions":[{"q":"вопрос до 80 символов","options":["вариант","вариант"]}]}

Решение пользователя: ${clip(text, 2000)}`;
}

function estimatePrompt(text, qa, rate) {
  const extra = qa.length ? '\n\nУточнения пользователя:\n' + qa.map(x => `- ${x.q} — ${x.a}`).join('\n') : '';
  return `Ты — аналитик «железного треугольника» (ресурсы — время — качество). Пользователь описывает решение из жизни или работы. Оцени, как это решение меняет три оси ПО СРАВНЕНИЮ с тем, как человек обычно поступил бы в такой ситуации (сам определи разумный базовый вариант).

Оси (целые числа от -100 до 100, 0 — без изменений, ±100 — предельное изменение):
- resources: расход денег, сил, материалов. Плюс — тратится БОЛЬШЕ, минус — экономия.
- time: затраты времени. Плюс — уходит БОЛЬШЕ времени, минус — быстрее.
- quality: качество, комфорт, надёжность результата. Плюс — лучше, минус — хуже.
Будь реалистичен: редкое решение улучшает все три оси сразу. Пиши по-русски, коротко, без канцелярита и воды.

Час времени пользователя стоит ${rate} ₽ (Москва, цены ${new Date().getFullYear()} года). Выбери ОДИН период, удобный для этого решения («за поездку», «за раз», «в месяц», «за проект»), и оцени в абсолютных числах ЗА ЭТОТ ПЕРИОД:
- money: разница в деньгах, ₽ (плюс — доплата, минус — экономия);
- minutes: разница во времени, минуты (плюс — уходит больше, минус — экономия);
- quality_rub: сколько человек готов был бы доплатить (плюс) за изменение качества и комфорта, или во сколько ему обойдётся ухудшение (минус: риск переделки, усталость, неудобство), ₽.
Правила согласованности: все три числа — за один и тот же период; знак resources согласован с money (доплата — resources > 0); если в verdict есть цифры, они ровно такие же, как в полях. Итоговый баланс не считай — его посчитает приложение.

Ответь только JSON такого вида:
{"title":"суть решения, до 5 слов","baseline":"с чем сравниваешь, до 8 слов","period":"за поездку","resources":0,"time":0,"quality":0,"money":0,"minutes":0,"quality_rub":0,
"notes":{"resources":"до 90 символов","time":"до 90 символов","quality":"до 90 символов"},
"verdict":"1–2 предложения: что на что меняется и когда это оправдано",
"alternatives":[{"title":"до 6 слов","note":"до 70 символов","verdict":"1–2 предложения про ЭТОТ вариант","notes":{"resources":"до 90","time":"до 90","quality":"до 90"},"resources":0,"time":0,"quality":0,"money":0,"minutes":0,"quality_rub":0}]}
В alternatives дай 2 варианта с иным балансом осей — относительно того же базового варианта и за тот же период.

Решение пользователя: ${clip(text, 2000)}${extra}`;
}

const SYSTEM = 'Ты помогаешь людям взвешивать бытовые и рабочие решения. Отвечаешь строго одним JSON-объектом без пояснений и без markdown.';

/* ---------- роутер ---------- */
function createRouter() {
  const limit = makeLimiter(PER_HOUR);
  const router = express.Router();

  // кто спрашивает: подпись Telegram из заголовка, как шлёт страница
  router.use((req, res, next) => {
    const data = verifyInitData(req.get('X-Telegram-Init-Data'));
    if (!data || !data.user) return res.status(401).json({ error: 'bad_auth' });
    req.tgUser = data.user;
    if (!limit(String(data.user.id))) return res.status(429).json({ error: 'rate_limited' });
    next();
  });

  // Модель — общая цепочка бота: Claude напрямую, при сбое — OpenRouter
  const run = async (res, prompt, maxTokens) => {
    try {
      const r = await claude.callWithFallback(
        [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }],
        { maxTokens, temperature: 0.4, ...(PREFERRED.length ? { model: PREFERRED } : {}) },
      );
      const json = parseJsonLoose(r?.text);
      if (!json || typeof json !== 'object') return res.status(502).json({ error: 'invalid_json' });
      res.json(json);
    } catch (err) {
      console.error('[TRIANGLE]', err.message);
      res.status(502).json({ error: 'upstream' });
    }
  };

  router.post('/ask', (req, res) => {
    const text = clip(req.body?.text, 2000).trim();
    if (!text) return res.status(400).json({ error: 'bad_request' });
    run(res, askPrompt(text), 1500);
  });

  router.post('/estimate', (req, res) => {
    const text = clip(req.body?.text, 2000).trim();
    if (!text) return res.status(400).json({ error: 'bad_request' });
    const qa = (Array.isArray(req.body?.qa) ? req.body.qa : [])
      .slice(0, 3)
      .map(x => ({ q: clip(x?.q, 160), a: clip(x?.a, 200) }))
      .filter(x => x.q && x.a);
    let rate = Number(req.body?.rate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100_000) rate = 1500;
    run(res, estimatePrompt(text, qa, Math.round(rate)), 4000);
  });

  return router;
}

// Страница и API под одним префиксом: /triangle/ и /triangle/api/triangle/*
function mount(app, staticOpts) {
  const pub = path.join(__dirname, '..', '..', 'public', 'triangle');
  app.use(BASE + '/api/triangle', createRouter());
  app.use(BASE, express.static(pub, staticOpts));
  // /triangle без слэша: относительный путь API на странице иначе уйдёт мимо
  app.get(BASE, (req, res) => {
    const qs = req.originalUrl.indexOf('?');
    res.redirect(302, BASE + '/' + (qs >= 0 ? req.originalUrl.slice(qs) : ''));
  });
}

/* ---------- кнопка в боте ---------- */
function publicUrl() {
  const raw = process.env.TRIANGLE_PUBLIC_URL || process.env.PUBLIC_URL
    || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '');
  return raw ? raw.replace(/\/+$/, '') : null;
}

// startapp в Direct Link: base64url, не длиннее 512 символов
function encodeStart(text) {
  let t = String(text);
  let enc = Buffer.from(t, 'utf8').toString('base64url');
  while (enc.length > 512 && t.length) {
    t = t.slice(0, Math.floor(t.length * 0.9));
    enc = Buffer.from(t, 'utf8').toString('base64url');
  }
  return enc;
}

// В личке — web_app (открывается сразу, регистрация в BotFather не нужна),
// в группах Telegram web_app-кнопки не пускает — там Direct Link t.me/<бот>/<app>.
function openButton(isPrivate, text) {
  const label = '△ Открыть оценку';
  const base = publicUrl();
  if (isPrivate && base) {
    const q = text ? `?q=${encodeURIComponent(clip(text, 400))}` : '';
    return { text: label, web_app: { url: `${base}${BASE}/${q}` } };
  }
  if (!config.botUsername) return null;
  const start = text ? `?startapp=${encodeStart(text)}` : '';
  return { text: label, url: `https://t.me/${config.botUsername}/${APP_SHORT_NAME}${start}` };
}

// /оценка [текст] — или ответом на сообщение: его текст подставится в поле
async function handleCommand(bot, msg, args) {
  if (!config.botUsername) {
    try { config.botUsername = (await bot.getMe()).username; } catch (_) {}
  }
  const own = args.join(' ').trim();
  const replied = msg.reply_to_message?.text || msg.reply_to_message?.caption || '';
  const text = own || replied.trim();
  const btn = openButton(msg.chat.type === 'private', text);
  const intro = text
    ? 'Посчитаю, чем вы платите за это решение: деньгами, временем или качеством.'
    : 'Опишите решение — посчитаю, чем вы за него платите: деньгами, временем или качеством.\nМожно сразу: /оценка Хочу домой на такси';
  await bot.sendMessage(msg.chat.id, btn ? intro : 'Не получилось собрать ссылку на приложение.', {
    reply_to_message_id: msg.message_id,
    ...(btn ? { reply_markup: { inline_keyboard: [[btn]] } } : {}),
  });
  return true;
}

module.exports = { mount, handleCommand, openButton, parseJsonLoose, encodeStart };
