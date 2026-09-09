const claude = require('../providers/claude');
const quizRepo = require('../db/repo/quiz');
const chatsRepo = require('../db/repo/chats');
const { sendSafe, noticeUser } = require('../utils/telegram');

// Кулдаун на /quiz — не чаще раза в 30с в одном чате
const quizCooldown = new Map();
const COOLDOWN_MS = 30 * 1000;

const config = require('../config');

// Разнообразие обеспечиваем случайным "углом" вопроса, а не высокой температурой —
// при высокой температуре модель начинает выдумывать факты.
const ANGLES = [
  'дата или год события', 'конкретная личность и её достижение', 'рекорд или крайняя величина',
  'происхождение названия или термина', 'число, количество или размер', 'место или география',
  'кто автор / изобретатель / основатель', 'первый в истории (кто/что было первым)',
  'терминология: что означает слово', 'причина или следствие известного события',
];

// Без заданной темы модель раз за разом тянется к одним и тем же хрестоматийным фактам
// (Кюри, Эйнштейн, законы Кеплера). Поэтому тему для каждого вопроса выбираем сами —
// случайную и узкую, чтобы пул фактов был по-настоящему широким.
const TOPICS = [
  // история
  'Древний Египет', 'Древняя Греция', 'Римская империя', 'Византия', 'викинги', 'средневековая Европа',
  'Крестовые походы', 'Реконкиста', 'эпоха Великих географических открытий', 'Османская империя', 'империя инков и ацтеков',
  'Древний Китай', 'самураи и сёгунат в Японии', 'Монгольская империя', 'Русь и Московское царство', 'Российская империя XVIII века',
  'Наполеоновские войны', 'Гражданская война в США', 'Первая мировая война', 'Вторая мировая война', 'холодная война',
  'история пиратства', 'история Африки', 'история Индии', 'история Латинской Америки', 'история Австралии и Океании',
  'история денег и банков', 'история медицины', 'история письменности и книгопечатания', 'история мореплавания',
  // наука
  'астрономия: планеты Солнечной системы', 'звёзды и галактики', 'космические аппараты и миссии', 'физика: электричество и магнетизм',
  'оптика и свет', 'химические элементы и таблица Менделеева', 'органическая химия в быту', 'генетика', 'эволюция и палеонтология',
  'динозавры', 'анатомия человека', 'мозг и нервная система', 'вирусы и бактерии', 'вакцины и антибиотики',
  'геология и минералы', 'вулканы и землетрясения', 'океаны и течения', 'погода и климат', 'математика: числа и теоремы',
  'история математики', 'криптография', 'единицы измерения и метрология', 'нобелевские премии (кроме самых известных лауреатов)',
  // природа
  'птицы', 'насекомые', 'морские животные', 'хищники', 'приматы', 'домашние животные и их породы', 'деревья и леса',
  'цветы и растения', 'грибы', 'пустыни', 'полярные регионы', 'реки и озёра мира', 'горы и вершины', 'острова',
  // география и страны
  'столицы и города Европы', 'города Азии', 'страны Африки', 'страны Южной Америки', 'Канада и США: штаты, провинции',
  'Скандинавия', 'Балканы', 'Ближний Восток', 'Юго-Восточная Азия', 'Центральная Азия', 'Кавказ', 'Сибирь и Дальний Восток',
  'флаги и гербы', 'языки мира', 'национальные кухни', 'мировые религии и обряды', 'праздники разных народов',
  // культура
  'живопись эпохи Возрождения', 'импрессионисты', 'современное искусство XX века', 'архитектура и знаменитые здания',
  'скульптура', 'классическая музыка и композиторы', 'опера и балет', 'джаз', 'рок-музыка', 'поп-музыка 1980–1990-х',
  'хип-хоп', 'русская литература XIX века', 'русская литература XX века', 'зарубежная литература XX века', 'детективы и их авторы',
  'фантастика и фэнтези (книги)', 'поэзия', 'мифология: греческая и римская', 'скандинавская мифология', 'славянская мифология и фольклор',
  'сказки и их авторы', 'театр', 'цирк и иллюзионисты', 'мода и дизайн', 'фотография',
  // кино и медиа
  'советское кино', 'российское кино', 'Голливуд золотой эры', 'кино 1990-х', 'мультфильмы и анимация', 'аниме',
  'сериалы', 'кинопремии и фестивали', 'комиксы и супергерои', 'видеоигры', 'настольные игры', 'телевидение и шоу',
  // спорт
  'футбол', 'хоккей', 'баскетбол', 'теннис', 'Олимпийские игры', 'шахматы', 'бокс и единоборства', 'лёгкая атлетика',
  'автогонки', 'велоспорт', 'зимние виды спорта', 'плавание и водные виды спорта', 'спортивные рекорды',
  // техника и повседневность
  'автомобили и их марки', 'авиация', 'железные дороги', 'корабли', 'мосты и тоннели', 'изобретения XIX века',
  'изобретения XX века', 'компьютеры и интернет', 'мобильные телефоны и гаджеты', 'программирование и языки', 'робототехника',
  'энергетика', 'бытовая техника и её история', 'еда и напитки: происхождение блюд', 'кофе и чай', 'вино и пиво',
  'сладости и десерты', 'специи и пряности', 'одежда и обувь: история вещей', 'игрушки и игры детства', 'бренды и логотипы',
  'реклама', 'экономика и валюты', 'право и известные законы', 'города-рекордсмены', 'транспорт в городах', 'почта и марки',
];

// Заезженные «школьные» факты: их модель выдаёт первыми — запрещаем явно.
const CLICHES = 'Мария Кюри, Эйнштейн, Ньютон, Кеплер, Галилей, Менделеев, Дарвин, Гагарин, Колумб, Магеллан, Пушкин, Толстой, Леонардо да Винчи, Моцарт, Бетховен, Шекспир, Эверест, Нил, Байкал, Марианская впадина, Великая Китайская стена, Эйфелева башня, Титаник, Хиросима, первый полёт братьев Райт';

function pickTopic() {
  return TOPICS[Math.floor(Math.random() * TOPICS.length)];
}

// --- Похожесть вопросов: ловим перефразированные повторы ---
const STOP = new Set(['какой', 'какая', 'какое', 'какие', 'каком', 'какого', 'который', 'которая', 'сколько', 'когда', 'где', 'кто', 'что', 'чем',
  'году', 'года', 'год', 'веке', 'века', 'впервые', 'назван', 'названа', 'называется', 'называют', 'является', 'считается', 'самый', 'самая',
  'самое', 'первый', 'первая', 'первое', 'этот', 'этой', 'этом', 'этого', 'была', 'было', 'были', 'быть', 'стал', 'стала', 'стало',
  'город', 'страна', 'страны', 'стране', 'человек', 'автор', 'автором', 'открыл', 'открытие', 'изобрёл', 'изобрел', 'изобретатель',
  'известный', 'известен', 'известна', 'название', 'названием', 'один', 'одна', 'одно', 'больше', 'меньше', 'между', 'после', 'перед',
  'какую', 'каким', 'какому', 'именно', 'также', 'более', 'всего', 'мире', 'мира', 'истории', 'список', 'единственный']);
function stems(text) {
  return new Set(String(text).toLowerCase().replace(/ё/g, 'е').split(/[^a-zа-я0-9]+/)
    .filter(w => w.length >= 4 && !STOP.has(w))
    .map(w => w.slice(0, 5)));
}
// Имена собственные — слова с заглавной не в начале предложения (Кюри, Кеплер, Эйфелева)
// Страны, континенты и столицы не считаем «той же личностью» — они встречаются в куче разных вопросов.
const COMMON_PLACES = new Set(['росси', 'франц', 'герма', 'европ', 'амери', 'китай', 'китае', 'япони', 'англи', 'итали',
  'испан', 'индии', 'индия', 'африк', 'москв', 'париж', 'лондо', 'велик', 'ссср', 'сша', 'азии', 'азия', 'брита', 'нью', 'рим',
  'греци', 'египт', 'египе', 'турци', 'канад', 'австр', 'бразил', 'мекси', 'корее', 'корея', 'солнц', 'земли', 'земля', 'луны', 'луна']);
function properNouns(text) {
  const out = new Set();
  const words = String(text).replace(/ё/g, 'е').split(/\s+/);
  words.forEach((w, i) => {
    const clean = w.replace(/[^A-Za-zА-Яа-я-]/g, '');
    if (!clean || i === 0) return;
    if (!/^[А-ЯA-Z]/.test(clean) || clean.length < 4) return;
    const stem = clean.toLowerCase().slice(0, 5);
    if (!COMMON_PLACES.has(stem)) out.add(stem);
  });
  return out;
}
// Возвращает похожий вопрос из списка или null.
// Перефраз (общие ключевые слова) ловим по всему списку; ту же личность/объект
// (про Кюри уже спрашивали) — только по последним 40, иначе любая «Франция» станет повтором.
function findSimilar(question, previous) {
  const qs = stems(question), qn = properNouns(question);
  for (let i = 0; i < previous.length; i++) {
    const prev = previous[i];
    if (!prev) continue;
    const ps = stems(prev);
    let inter = 0;
    for (const s of qs) if (ps.has(s)) inter++;
    const union = qs.size + ps.size - inter;
    const jaccard = union ? inter / union : 0;
    if (jaccard >= 0.4) return prev;
    if (i < 40) {
      const pn = properNouns(prev);
      for (const n of qn) if (pn.has(n)) return prev;
    }
  }
  return null;
}

async function generateQuestion(topicHint, avoidQuestions = [], feedback = null) {
  const angle = ANGLES[Math.floor(Math.random() * ANGLES.length)];
  const topic = topicHint || pickTopic();
  const system = `Ты — составитель викторин с репутацией педанта. Создай ОДИН вопрос с 4 вариантами ответа.

ГЛАВНОЕ — ФАКТИЧЕСКАЯ ТОЧНОСТЬ:
- Используй только устоявшиеся, широко известные, легко проверяемые факты (энциклопедический уровень)
- Ровно один вариант верный, три остальных — ОДНОЗНАЧНО неверные, без "тоже отчасти правильно"
- Не используй слова "единственный", "самый", "первый" если не уверен на 100% — такие вопросы часто спорные
- Не смешивай факты (столица ≠ крупнейший город; страна на двух континентах ≠ на трёх)
- Если сомневаешься хоть немного — выбери другой факт
- Никаких вопросов про события после 2024 года

ФОРМА:
- question: ≤200 символов, конкретный
- options: ровно 4, каждый ≤80 символов, без префиксов (а), 1., -), одного типа (все города / все годы / все имена)
- correct_option: индекс верного, 0-3; ставь верный на случайную позицию
- explanation: 1-2 предложения с самим фактом, ≤180 символов
- Сложность средняя — для взрослых эрудитов
- На русском

РАЗНООБРАЗИЕ:
- Не бери хрестоматийные факты из школьной программы: ${CLICHES} — про это спрашивали тысячу раз
- Ищи менее заезженный, но точно проверяемый факт внутри темы

Угол этого вопроса: ${angle}.

Формат строго JSON:
{"question": "...", "options": ["...", "...", "...", "..."], "correct_option": 0, "explanation": "..."}`;

  let userText = topicHint
    ? `Тема: ${topicHint}. Придумай вопрос в эту тему.`
    : `Тема этого вопроса: ${topic}. Придумай интересный вопрос строго в эту тему.`;
  if (avoidQuestions.length > 0) {
    userText += `\n\nЭти вопросы УЖЕ были — не повторяй ни их, ни те же личности, объекты и факты:\n` +
      avoidQuestions.slice(0, 60).map(q => `- ${q}`).join('\n').slice(0, 5000);
  }
  if (feedback) {
    userText += `\n\nПредыдущая попытка отклонена проверкой: ${feedback}. Придумай ДРУГОЙ вопрос, без этой ошибки.`;
  }

  const result = await claude.askJson({
    system,
    userText,
    opts: { temperature: 0.7, maxTokens: 500, model: config.quizModels },
  });

  if (!result) return null;
  if (!result.question || typeof result.question !== 'string') return null;
  if (!Array.isArray(result.options) || result.options.length !== 4) return null;
  if (typeof result.correct_option !== 'number' || result.correct_option < 0 || result.correct_option > 3) return null;

  return {
    question: String(result.question).slice(0, 290),
    options: result.options.map(o => String(o).slice(0, 95)),
    correct_option: Math.floor(result.correct_option),
    explanation: String(result.explanation || '').slice(0, 195),
  };
}

// Фактчекинг: независимая проверка вопроса при температуре 0.
// Возвращает { ok, reason }.
async function verifyQuestion(quiz) {
  const system = `Ты — строгий фактчекер викторин. Тебе дают вопрос, 4 варианта и отмеченный верный ответ.
Проверь и ответь JSON: {"ok": true|false, "reason": "..."}.

ok=false, если ХОТЯ БЫ ОДНО верно:
- отмеченный ответ фактически неверен
- какой-то другой вариант тоже можно считать верным (двусмысленность)
- вопрос содержит ложную предпосылку (например, "столица страны на трёх континентах", если такой страны нет)
- формулировка спорная, зависит от трактовки или устаревших данных
- вопрос требует знаний о событиях после 2024 года

ok=true только если факт общеизвестен, однозначен и ровно один вариант верен.
reason: одна фраза, по-русски, ≤120 символов. Не будь снисходительным.`;

  const userText =
    `Вопрос: ${quiz.question}\n` +
    quiz.options.map((o, i) => `${i}) ${o}`).join('\n') +
    `\nОтмечен верным: ${quiz.correct_option}) ${quiz.options[quiz.correct_option]}\n` +
    `Объяснение генератора: ${quiz.explanation || '—'}`;

  const result = await claude.askJson({
    system,
    userText,
    opts: { temperature: 0, maxTokens: 200, model: config.quizVerifyModels },
  });
  if (!result || typeof result.ok !== 'boolean') {
    // Проверка не отработала — не блокируем, но помечаем
    return { ok: true, reason: 'verifier unavailable' };
  }
  return { ok: result.ok, reason: String(result.reason || '').slice(0, 200) };
}

// Генерация с проверкой: до 4 попыток, каждая следующая получает причину отказа.
// Сначала отсеиваем повторы (дёшево, без второй модели), потом фактчек.
async function generateVerifiedQuestion(topicHint, avoidQuestions = []) {
  let feedback = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    let quiz = null;
    try {
      quiz = await generateQuestion(topicHint, avoidQuestions, feedback);
    } catch (err) {
      console.warn(`[QUIZ] gen attempt ${attempt} failed:`, err.message);
      continue;
    }
    if (!quiz) continue;

    const dup = findSimilar(quiz.question, avoidQuestions);
    if (dup) {
      console.warn(`[QUIZ] повтор (попытка ${attempt}): "${quiz.question.slice(0, 80)}" ~ "${dup.slice(0, 80)}"`);
      feedback = `вопрос слишком похож на уже заданный («${dup.slice(0, 120)}»). Возьми другую личность, объект или факт`;
      continue;
    }

    let check;
    try {
      check = await verifyQuestion(quiz);
    } catch (err) {
      console.warn('[QUIZ] verify failed:', err.message);
      check = { ok: true, reason: 'verifier error' };
    }
    if (check.ok) {
      if (attempt > 1) console.log(`[QUIZ] принят с попытки ${attempt}`);
      return quiz;
    }
    console.warn(`[QUIZ] отклонён (попытка ${attempt}): "${quiz.question.slice(0, 80)}" — ${check.reason}`);
    feedback = check.reason;
  }
  return null;
}

// Активные серии вопросов: chatId -> { total, index, topic, asked, starterId, timer }
const activeSeries = new Map();
const SERIES_INTERVAL_MS = 30 * 1000;

// Генерация + отправка одного вопроса. label — префикс вида "2/5. " для серий.
async function postOneQuiz(bot, chatId, topic, { replyTo = null, label = '', avoid = [] } = {}) {
  await bot.sendChatAction(chatId, 'typing').catch(() => {});

  // Стоп-лист: вопросы текущей серии + последние 150 из истории чата (включая тренировки и арену)
  let recent = [];
  try { recent = await quizRepo.getRecentQuestions(chatId, 150); } catch (_) {}
  const avoidAll = [...new Set([...avoid, ...recent])];

  const quiz = await generateVerifiedQuestion(topic, avoidAll);
  if (!quiz) return null;

  try {
    const question = (label + quiz.question).slice(0, 300);
    const sent = await bot.sendPoll(chatId, question, quiz.options, {
      type: 'quiz',
      correct_option_id: quiz.correct_option,
      explanation: quiz.explanation || undefined,
      is_anonymous: false,
      ...(replyTo ? { reply_to_message_id: replyTo } : {}),
    });

    const pollId = sent.poll?.id || String(sent.message_id);
    await quizRepo.saveQuiz({
      pollId,
      chatId,
      messageId: sent.message_id,
      question: quiz.question,
      correctOption: quiz.correct_option,
      topic,
    });
    console.log(`[QUIZ] chat=${chatId} pollId=${pollId} correct=${quiz.correct_option}`);
    return quiz;
  } catch (err) {
    console.error('[QUIZ] sendPoll:', err.message);
    return null;
  }
}

async function runSeriesStep(bot, chatId) {
  const s = activeSeries.get(chatId);
  if (!s) return;
  s.index++;
  const label = `${s.index}/${s.total}. `;
  const quiz = await postOneQuiz(bot, chatId, s.topic, { label, avoid: s.asked });
  if (quiz) s.asked.push(quiz.question);

  if (s.index >= s.total) {
    activeSeries.delete(chatId);
    quizCooldown.set(chatId, Date.now());
    await sendSafe(bot, chatId, `Серия из ${s.total} вопросов закончена. Итоги: /leaderboard`);
    return;
  }
  s.timer = setTimeout(() => {
    runSeriesStep(bot, chatId).catch(err => console.error('[QUIZ SERIES]', err.message));
  }, SERIES_INTERVAL_MS);
}

async function handleQuizCommand(bot, msg, argsText) {
  const chatId = msg.chat.id;
  const raw = (argsText || '').trim();

  // /quiz app — открыть мини-приложение (тренировка и соревнования)
  if (/^(app|апп|арена|arena)$/i.test(raw)) {
    if (!config.botUsername) {
      try { config.botUsername = (await bot.getMe()).username; } catch (_) {}
    }
    if (!config.botUsername) {
      await sendSafe(bot, chatId, 'Не получилось узнать имя бота.', { reply_to_message_id: msg.message_id });
      return;
    }
    const url = `https://t.me/${config.botUsername}/${config.quizAppShortName}?startapp=${chatId}`;
    await bot.sendMessage(chatId,
      'Эрудит — викторина на время.\nТренировка в одиночку или соревнование на 2–5 человек. Результаты соревнований идут в /leaderboard.',
      {
        reply_to_message_id: msg.message_id,
        reply_markup: { inline_keyboard: [[{ text: 'Открыть', url, style: 'primary' }]] },
      });
    return;
  }

  // /quiz stop — остановить серию (только запустивший или владелец бота)
  if (/^(stop|стоп)$/i.test(raw)) {
    const s = activeSeries.get(chatId);
    if (!s) {
      await noticeUser(bot, msg, 'Активной серии нет.');
      return;
    }
    const config = require('../config');
    const canStop = msg.from?.id === s.starterId || msg.from?.id === config.adminId;
    if (!canStop) {
      await noticeUser(bot, msg, 'Остановить серию может тот, кто её запустил.');
      return;
    }
    if (s.timer) clearTimeout(s.timer);
    activeSeries.delete(chatId);
    quizCooldown.set(chatId, Date.now());
    await sendSafe(bot, chatId, `Серия остановлена на ${s.index}/${s.total}. Итоги: /leaderboard`,
      { reply_to_message_id: msg.message_id });
    return;
  }

  if (activeSeries.has(chatId)) {
    const s = activeSeries.get(chatId);
    await noticeUser(bot, msg, `Серия уже идёт (${s.index}/${s.total}). Остановить: /quiz stop`);
    return;
  }

  const last = quizCooldown.get(chatId);
  if (last && Date.now() - last < COOLDOWN_MS) {
    const left = Math.ceil((COOLDOWN_MS - (Date.now() - last)) / 1000);
    await noticeUser(bot, msg, `Подожди ${left} сек до следующего вопроса.`);
    return;
  }
  quizCooldown.set(chatId, Date.now());

  // Парсим количество (1-10): отдельное число в начале или конце аргументов.
  // "/quiz 5", "/quiz космос 5", "/quiz 5 космос"
  let count = 1;
  let topic = raw;
  const m = raw.match(/(?:^|\s)(10|[1-9])(?=\s|$)/);
  if (m) {
    count = parseInt(m[1], 10);
    topic = (raw.slice(0, m.index) + ' ' + raw.slice(m.index + m[0].length)).trim();
  }
  if (!topic) {
    const chat = await chatsRepo.getChat(chatId);
    topic = chat?.chat_topic || null;
  }

  if (count <= 1) {
    const ok = await postOneQuiz(bot, chatId, topic, { replyTo: msg.message_id });
    if (!ok) {
      quizCooldown.delete(chatId);
      await sendSafe(bot, chatId, 'Не получилось сочинить вопрос. Попробуй ещё раз.', { reply_to_message_id: msg.message_id });
    }
    return;
  }

  // Серия: первый вопрос сразу, дальше по одному каждые 30 секунд
  activeSeries.set(chatId, {
    total: count,
    index: 0,
    topic,
    asked: [],
    starterId: msg.from?.id || null,
    timer: null,
  });
  await sendSafe(bot, chatId,
    `Серия из ${count} вопросов${topic ? ` на тему «${topic}»` : ''} — по одному каждые 30 сек. Остановить: /quiz stop`,
    { reply_to_message_id: msg.message_id });
  await runSeriesStep(bot, chatId);
}

async function handlePollAnswer(bot, pollAnswer) {
  const pollId = pollAnswer.poll_id;
  const userId = pollAnswer.user?.id;
  // Без @ — иначе каждый показ топа тегает всех участников уведомлениями
  const username = pollAnswer.user?.username
    || pollAnswer.user?.first_name
    || `id${userId}`;
  const chosen = pollAnswer.option_ids?.[0];

  if (!pollId || !userId || chosen === undefined) return;

  const quiz = await quizRepo.getQuiz(pollId);
  if (!quiz) return;

  // Один ответ на юзера засчитывается
  const fresh = await quizRepo.recordAnswer(pollId, userId);
  if (!fresh) return;

  const isCorrect = chosen === quiz.correct_option;
  await quizRepo.bumpScore(quiz.chat_id, userId, username, isCorrect);
  console.log(`[QUIZ] pollId=${pollId} user=${username} ${isCorrect ? 'OK' : 'miss'}`);
}

async function handleLeaderboard(bot, msg, args = []) {
  const chatId = msg.chat.id;
  // /leaderboard 1 — архив первого сезона
  const season = String(args[0] || '') === '1' ? 1 : quizRepo.CURRENT_SEASON;
  const rows = await quizRepo.getLeaderboard(chatId, 10, season);
  if (rows.length === 0) {
    await sendSafe(bot, chatId,
      season === 1 ? 'В первом сезоне в этом чате никто не играл.' : 'Пока никто не отвечал в этом сезоне. Начни с /quiz',
      { reply_to_message_id: msg.message_id });
    return;
  }
  const medals = ['🥇', '🥈', '🥉'];
  const lines = [season === 1 ? '🏆 Топ викторины · 1 сезон (архив)' : `🏆 Топ викторины · ${season} сезон`];
  rows.forEach((r, i) => {
    const prefix = medals[i] || `${i + 1}.`;
    // Срезаем @ у старых записей, чтобы не тегать людей при каждом показе топа
    const name = (r.username || `id${r.user_id}`).replace(/^@/, '');
    lines.push(`${prefix} ${name} — ${r.correct}/${r.total} (${r.pct}%)`);
  });
  if (season !== 1) lines.push('', 'Архив 1 сезона: /leaderboard 1');
  await sendSafe(bot, chatId, lines.join('\n'), { reply_to_message_id: msg.message_id });
}

module.exports = { handleQuizCommand, handlePollAnswer, handleLeaderboard, generateVerifiedQuestion, findSimilar };
