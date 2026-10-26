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
  return `Пользователь описал решение из жизни или работы. Потом ты оценишь его по трём осям — ресурсы (деньги и силы), время, качество — по сравнению с тем, как он поступил бы обычно, и переведёшь всё в рубли. Сейчас нужно понять, каких данных для этого не хватает.

Задай РОВНО 3 уточняющих вопроса — те, ответы на которые сильнее всего сдвинут оценку. Перед тем как выбрать, мысленно перебери:
- базовый вариант: как человек делает это обычно, с чем сравнивать (если неясно из текста — это первый кандидат на вопрос);
- масштаб: расстояние, сумма, объём, сколько людей, сколько раз;
- частота: разово, раз в неделю, каждый день — от этого зависит период расчёта;
- ограничения: бюджет, срок, здоровье, обязательства перед другими;
- приоритет: что для человека важнее сейчас — сэкономить, успеть или сделать хорошо;
- риски: что может пойти не так и во что это обойдётся.
Не спрашивай то, что уже есть в тексте, и не задавай двух вопросов об одном. Каждый вопрос — конкретный, с цифрами или понятными градациями в вариантах.

Для каждого вопроса:
- q — сам вопрос, до 90 символов;
- why — зачем спрашиваешь: что изменится в оценке, до 90 символов;
- options — 3–4 варианта ответа по 1–5 слов, покрывающих типичный разброс (например «до 15 минут», «полчаса», «час и больше»).

Пиши по-русски, просто, без канцелярита. Ответь только JSON:
{"questions":[{"q":"...","why":"...","options":["...","...","..."]}]}

Решение пользователя: ${clip(text, 2000)}`;
}

function estimatePrompt(text, qa, rate, refine) {
  const extra = qa.length ? '\n\nУточнения пользователя:\n' + qa.map(x => `- ${x.q} — ${x.a}`).join('\n') : '';
  const again = refine ? `

Это ПЕРЕСЧЁТ. Твоя прошлая оценка:
${refine.prev}
После неё пользователь добавил: «${refine.note}»
Пересчитай с учётом этого. Базовый вариант и период оставь прежними, если уточнение их не меняет. Числа меняй только там, где уточнение на них влияет, и в verdict коротко скажи, что изменилось и почему.` : '';
  return `Ты — аналитик «железного треугольника» (ресурсы — время — качество). Пользователь описывает решение из жизни или работы. Оцени, как это решение меняет три оси ПО СРАВНЕНИЮ с тем, как человек обычно поступил бы в такой ситуации.

Как считать — по шагам:
1. Базовый вариант. Определи, с чем сравниваешь: как человек поступает обычно (из текста и уточнений, иначе — самый типичный вариант для такой ситуации). Назови его конкретно.
2. Период. Выбери ОДИН период, удобный для решения: «за поездку», «за раз», «в неделю», «в месяц», «за проект». Если решение повторяется — бери период, в котором оно повторяется (например, ежедневное такси — «в месяц», 22 рабочих дня). Все числа — за этот период.
3. Деньги (money, ₽). Посчитай разницу по реальным ценам (Москва, ${new Date().getFullYear()} год): прямые траты плюс сопутствующие — доставка, проезд, расходники, комиссия. Плюс — доплата, минус — экономия.
4. Время (minutes). Сложи всё время, а не только основное действие: дорогу, ожидание, подготовку, уборку, согласования, поиск, вероятные переделки. Плюс — уходит больше, минус — экономия.
5. Качество (quality_rub, ₽). Сколько человек готов был бы доплатить за прирост качества, комфорта, надёжности (плюс), или во сколько ему обойдётся ухудшение (минус). Риски считай как вероятность × цену последствий: переделка, штраф, испорченная вещь, недовольный клиент, усталость. Не дублируй здесь деньги и время, уже учтённые выше.
6. Оси (целые от -100 до 100) — относительный масштаб изменения к базовому варианту: ±10–20 — заметно, ±40–60 — сильно, ±80–100 — радикально (в разы).
   - resources: деньги, силы, материалы. Плюс — тратится БОЛЬШЕ, минус — экономия. Знак согласован с money.
   - time: плюс — дольше, минус — быстрее. Знак согласован с minutes.
   - quality: плюс — лучше, минус — хуже. Знак согласован с quality_rub.
   Будь реалистичен: решение, которое улучшает все три оси сразу, встречается редко — обычно за что-то платишь.
7. Используй уточнения пользователя явно: если он назвал расстояние, бюджет или частоту — считай от них.
8. Альтернативы. Дай 2 варианта, которые решают ту же задачу ДРУГОЙ стратегией и с иным балансом осей: например, один дешевле, другой быстрее или надёжнее; можно гибрид. Не повторяй решение пользователя и базовый вариант. Числа альтернатив — относительно того же базового варианта и за тот же период.
9. Итоговый баланс не считай — его посчитает приложение. Если в тексте есть цифры, они ровно такие же, как в полях.

Как писать: по-русски, живо и конкретно, без канцелярита и воды. Объясняй через цифры и бытовые детали, а не общими словами.

Ответь только JSON такого вида:
{"title":"суть решения, до 6 слов","baseline":"с чем сравниваешь, до 10 слов","period":"за поездку","resources":0,"time":0,"quality":0,"money":0,"minutes":0,"quality_rub":0,
"notes":{"resources":"откуда разница в деньгах и силах, с цифрами, до 150 символов","time":"из чего складывается разница во времени, до 150 символов","quality":"что лучше или хуже и какие риски, до 150 символов"},
"verdict":"3–4 предложения: что на что меняется, в каких случаях это оправдано, а в каких нет",
"assumptions":["2–3 допущения, на которых держится расчёт, по 100 символов"],
"tip":"один практичный совет, как получить больше от этого решения или снизить его цену, до 160 символов",
"alternatives":[{"title":"до 6 слов","note":"суть варианта, до 90 символов","verdict":"2–3 предложения про ЭТОТ вариант: чем лучше и чем хуже вашего","notes":{"resources":"до 150","time":"до 150","quality":"до 150"},"resources":0,"time":0,"quality":0,"money":0,"minutes":0,"quality_rub":0}]}

Час времени пользователя стоит ${rate} ₽.

Решение пользователя: ${clip(text, 2000)}${extra}${again}`;
}

// Прошлая оценка для пересчёта — компактно, из того, что прислала страница
function describePrev(p) {
  if (!p || typeof p !== 'object') return '';
  const n = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0);
  const lines = [
    `Решение: ${clip(p.title, 80)}; базовый вариант: ${clip(p.baseline, 100)}; период: ${clip(p.period, 30)}`,
    `Оси: resources ${n(p.resources)}, time ${n(p.time)}, quality ${n(p.quality)}`,
    `Деньги ${n(p.money)} ₽, время ${n(p.minutes)} мин, качество ${n(p.quality_rub)} ₽`,
    `Вывод: ${clip(p.verdict, 500)}`,
  ];
  return lines.join('\n');
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
    run(res, askPrompt(text), 2000);
  });

  router.post('/estimate', (req, res) => {
    const text = clip(req.body?.text, 2000).trim();
    if (!text) return res.status(400).json({ error: 'bad_request' });
    const qa = (Array.isArray(req.body?.qa) ? req.body.qa : [])
      .slice(0, 3)
      .map(x => ({ q: clip(x?.q, 200), a: clip(x?.a, 300) }))
      .filter(x => x.q && x.a);
    let rate = Number(req.body?.rate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100_000) rate = 1500;
    // Пересчёт после результата: прошлая оценка + что пользователь добавил
    const note = clip(req.body?.refine?.note, 500).trim();
    const prev = describePrev(req.body?.refine?.prev);
    const refine = note && prev ? { note, prev } : null;
    run(res, estimatePrompt(text, qa, Math.round(rate), refine), 5000);
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
