const { getRandomWord } = require('./words');

// Активные игры: chatId -> Game
const activeGames = new Map();

// ASCII-арт виселицы по стадиям (0-8 ошибок)
const STAGES = [
  '  ┌──┐\n  │\n  │\n  │\n ═╧═══',         // 0 — пусто
  '  ┌──┐\n  │  😐\n  │\n  │\n ═╧═══',      // 1 — голова
  '  ┌──┐\n  │  😐\n  │  │\n  │\n ═╧═══',   // 2 — тело
  '  ┌──┐\n  │  😐\n  │ /│\n  │\n ═╧═══',   // 3 — левая рука
  '  ┌──┐\n  │  😐\n  │ /│\\\n  │\n ═╧═══', // 4 — правая рука
  '  ┌──┐\n  │  😬\n  │ /│\\\n  │ /\n ═╧═══', // 5 — левая нога
  '  ┌──┐\n  │  😟\n  │ /│\\\n  │ / \\\n ═╧═══', // 6 — правая нога
  '  ┌──┐\n  │  😰\n  │_/│\\\n  │ / \\\n ═╧═══', // 7 — левая ладонь
  '  ┌──┐\n  │  💀\n  │_/│\\_ \n  │ / \\\n ═╧═══', // 8 — смерть
];

const MAX_WRONG = 8;

// Фразы Каа
const PHRASES = {
  start: [
    'Шшш... Каа предлагает испытание. Отгадай слово, маугли...',
    'Каа загадал слово. Попробуй разгадать, если хватит ума...',
    'Испытание для ума. Угадай слово по буквам...',
  ],
  correct: ['Верно...', 'Так-так...', 'Наблюдательный...', 'Есть такая буква...'],
  wrong: ['Нет такой буквы...', 'Мимо...', 'Не угадал...', 'Каа качает головой...'],
  repeat: ['Ты уже называл эту букву, забывчивый маугли.', 'Эта буква уже была. Внимательнее...'],
  win: [
    'Хм, не так уж ты и глуп, маугли...',
    'Каа впечатлён. Ты разгадал слово.',
    'Верно. Может, ты и достоин джунглей...',
  ],
  lose: [
    'Слишком медленно, маугли.',
    'Каа разочарован. Ты не смог разгадать слово.',
    'Не хватило ума... Бывает.',
  ],
  stop: [
    'Каа свернулся обратно. Ну, в следующий раз...',
    'Игра окончена. Каа уползает...',
  ],
  alreadyActive: 'Игра уже идёт в этом чате. Угадывай буквы или напиши /виселица стоп',
  noActive: 'Нет активной игры. Напиши /виселица чтобы начать.',
};

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function hasActiveGame(chatId) {
  return activeGames.has(String(chatId));
}

function renderState(game) {
  const stage = STAGES[Math.min(game.wrong.length, MAX_WRONG)];

  // Слово с пробелами между буквами, нераскрытые — подчёркивание
  const wordDisplay = game.word
    .split('')
    .map(ch => (game.guessed.has(ch) ? ch : '_'))
    .join(' ');

  const wrongDisplay = game.wrong.length > 0
    ? `Ошибки (${game.wrong.length}/${MAX_WRONG}): ${game.wrong.join(' ')}`
    : `Ошибки: 0/${MAX_WRONG}`;

  const hintDisplay = `Подсказка: ${game.hint}`;

  return `<pre>${stage}</pre>\n\n${hintDisplay}\n<b>Слово:</b> <code>${wordDisplay}</code>\n${wrongDisplay}`;
}

function checkWin(game) {
  return game.word.split('').every(ch => game.guessed.has(ch));
}

async function startGame(bot, msg) {
  const chatId = String(msg.chat.id);

  if (activeGames.has(chatId)) {
    const game = activeGames.get(chatId);
    await bot.sendMessage(msg.chat.id, PHRASES.alreadyActive + '\n\n' + renderState(game), {
      parse_mode: 'HTML',
    });
    return;
  }

  const { word, hint } = getRandomWord();
  const game = {
    word: word.toUpperCase(),
    hint,
    guessed: new Set(),
    wrong: [],
    startedBy: msg.from?.id,
    startedAt: Date.now(),
  };
  activeGames.set(chatId, game);

  const text = `🐍 ${pick(PHRASES.start)}\n\n${renderState(game)}`;
  await bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML' });
  console.log(`[HANGMAN] Игра начата в ${chatId}, слово: ${word}`);
}

async function stopGame(bot, msg) {
  const chatId = String(msg.chat.id);
  const game = activeGames.get(chatId);

  if (!game) {
    await bot.sendMessage(msg.chat.id, PHRASES.noActive);
    return;
  }

  activeGames.delete(chatId);
  await bot.sendMessage(msg.chat.id, `🐍 ${pick(PHRASES.stop)}\n\nСлово было: <b>${game.word}</b>`, {
    parse_mode: 'HTML',
  });
  console.log(`[HANGMAN] Игра остановлена в ${chatId}, слово было: ${game.word}`);
}

async function guessLetter(bot, msg) {
  const chatId = String(msg.chat.id);
  const game = activeGames.get(chatId);
  if (!game) return;

  const letter = (msg.text || '').trim().toUpperCase();
  if (!letter || letter.length !== 1) return;

  // Уже называли
  if (game.guessed.has(letter)) {
    await bot.sendMessage(msg.chat.id, pick(PHRASES.repeat), {
      reply_to_message_id: msg.message_id,
    });
    return;
  }

  game.guessed.add(letter);

  const isCorrect = game.word.includes(letter);
  if (!isCorrect) {
    game.wrong.push(letter);
  }

  // Проверяем победу / проигрыш
  if (checkWin(game)) {
    activeGames.delete(chatId);
    const wordDisplay = game.word.split('').join(' ');
    const text = `🎉 ${pick(PHRASES.win)}\n\n<b>Слово:</b> <code>${wordDisplay}</code>\n\nОшибок: ${game.wrong.length}/${MAX_WRONG}`;
    await bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML' });
    console.log(`[HANGMAN] Победа в ${chatId}, слово: ${game.word}, ошибок: ${game.wrong.length}`);
    return;
  }

  if (game.wrong.length >= MAX_WRONG) {
    activeGames.delete(chatId);
    const text = `${STAGES[MAX_WRONG]}\n\n💀 ${pick(PHRASES.lose)}\n\nСлово было: <b>${game.word}</b>`;
    await bot.sendMessage(msg.chat.id, `<pre>${STAGES[MAX_WRONG]}</pre>\n\n💀 ${pick(PHRASES.lose)}\n\nСлово было: <b>${game.word}</b>`, {
      parse_mode: 'HTML',
    });
    console.log(`[HANGMAN] Проигрыш в ${chatId}, слово: ${game.word}`);
    return;
  }

  // Обычный ход
  const comment = isCorrect ? pick(PHRASES.correct) : pick(PHRASES.wrong);
  await bot.sendMessage(msg.chat.id, `${comment}\n\n${renderState(game)}`, {
    parse_mode: 'HTML',
    reply_to_message_id: msg.message_id,
  });
}

module.exports = { hasActiveGame, startGame, stopGame, guessLetter };
