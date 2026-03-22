const poems = require('./poems');

// Активные игры: chatId (string) -> Game
const activeGames = new Map();

// Связь userId -> chatId (какой группе принадлежит игрок)
const playerGameMap = new Map();

const WIN_SCORE = 15;
const MAX_ROUNDS = 7;
const COLLECT_TIMEOUT_MS = 3 * 60 * 1000;   // 3 минуты на отправку
const VOTE_TIMEOUT_MS = 2 * 60 * 1000;       // 2 минуты на голосование
const LOBBY_TIMEOUT_MS = 10 * 60 * 1000;     // 10 минут на сбор
const BETWEEN_ROUNDS_MS = 5 * 1000;          // 5 секунд между раундами

// === ФРАЗЫ КАА ===
const PHRASES = {
  lobbyStart: [
    '🐍 Каа объявляет Гамруль!\n\nКаа прочтёт начало стихотворения, а вы — сочините концовку. Потом все голосуют за лучший вариант.\n\n+3 очка за угадывание настоящей концовки\n+1 очко за каждый голос за вашу концовку\n\nПервый до 15 очков или больше всех за 7 раундов — побеждает.',
  ],
  roundStart: [
    '📜 Раунд {round}/{max}. Кто написал: <b>{author}</b>\n\n<i>{opening}</i>\n\n✍️ Отправьте мне в личные сообщения свой вариант продолжения!',
  ],
  votingStart: [
    '🗳 Время голосовать! Какая концовка настоящая?\n\n',
  ],
  noPlayers: 'Гамруль — групповая игра. Нужно минимум 2 игрока.',
  privateOnly: 'Гамруль можно запустить только в групповом чате.',
  alreadyActive: 'Игра уже идёт в этом чате.',
  alreadyJoined: 'Ты уже в игре!',
  alreadyInOther: 'Ты уже играешь в другом чате. Закончи ту игру сначала.',
  joined: 'Ты в игре!',
  notEnough: 'Нужно минимум 2 игрока. Пока присоединились: {count}',
  hostOnly: 'Только организатор может начать игру.',
  submitted: '✅ Принято! Ждём остальных...',
  alreadySubmitted: 'Ты уже отправил свою концовку для этого раунда.',
  notCollecting: 'Сейчас не время для отправки концовок.',
  cantVoteSelf: 'Нельзя голосовать за свой вариант!',
  alreadyVoted: 'Ты уже проголосовал!',
  notInGame: 'Ты не участвуешь в этой игре.',
  noGame: 'Нет активной игры. Напиши /гамруль чтобы начать.',
  stopped: '🐍 Каа свернул игру. Что ж, в следующий раз...',
  startPM: '⚠️ {name}, мне нужно отправить тебе ЛС, но ты не начал диалог со мной. Нажми на моё имя и отправь /start.',
};

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function formatPlayerList(game) {
  const list = [];
  for (const [, player] of game.players) {
    list.push(player.name);
  }
  return list.join(', ');
}

function formatScoreboard(game) {
  const sorted = [...game.players.values()].sort((a, b) => b.score - a.score);
  return sorted.map((p, i) => `${i + 1}. ${p.name}: ${p.score} очк.`).join('\n');
}

// === ЛОББИ ===

async function startLobby(bot, msg) {
  const chatId = String(msg.chat.id);
  const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup';

  if (!isGroup) {
    await bot.sendMessage(msg.chat.id, PHRASES.privateOnly);
    return;
  }

  if (activeGames.has(chatId)) {
    await bot.sendMessage(msg.chat.id, PHRASES.alreadyActive);
    return;
  }

  const userId = msg.from?.id;
  const userName = msg.from?.first_name || 'Игрок';

  // Проверяем что игрок не в другой игре
  if (playerGameMap.has(userId)) {
    await bot.sendMessage(msg.chat.id, PHRASES.alreadyInOther);
    return;
  }

  const game = {
    chatId: msg.chat.id,
    chatTitle: msg.chat.title || 'Чат',
    phase: 'lobby',
    hostUserId: userId,
    players: new Map(),
    round: 0,
    usedPoemIndices: [],
    currentPoem: null,
    endings: [],
    lobbyMessageId: null,
    collectTimeoutId: null,
    voteTimeoutId: null,
    lobbyTimeoutId: null,
  };

  // Добавляем хоста
  game.players.set(userId, {
    name: userName,
    score: 0,
    lastSubmission: null,
    lastVote: null,
  });
  playerGameMap.set(userId, chatId);

  activeGames.set(chatId, game);

  const text = `${pick(PHRASES.lobbyStart)}\n\nИгроки: ${userName}\n\nЖдём ещё игроков...`;

  const sent = await bot.sendMessage(msg.chat.id, text, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🎮 Присоединиться', callback_data: `gamrule_join_${chatId}` }],
        [{ text: '▶️ Начать игру', callback_data: `gamrule_start_${chatId}` }],
      ],
    },
  });

  game.lobbyMessageId = sent.message_id;

  // Таймаут лобби
  game.lobbyTimeoutId = setTimeout(() => {
    if (game.phase === 'lobby') {
      cleanupGame(chatId);
      bot.sendMessage(msg.chat.id, '🐍 Никто не пришёл... Каа засыпает.').catch(() => {});
    }
  }, LOBBY_TIMEOUT_MS);

  console.log(`[GAMRULE] Лобби создано в ${chatId} хостом ${userName}`);
}

// === CALLBACK HANDLER ===

async function handleCallback(bot, query) {
  const data = query.data || '';
  const userId = query.from?.id;

  if (data.startsWith('gamrule_join_')) {
    await handleJoin(bot, query);
  } else if (data.startsWith('gamrule_start_')) {
    await handleStart(bot, query);
  } else if (data.startsWith('gamrule_vote_')) {
    await handleVote(bot, query);
  } else {
    await bot.answerCallbackQuery(query.id);
  }
}

async function handleJoin(bot, query) {
  const data = query.data;
  const chatId = data.replace('gamrule_join_', '');
  const userId = query.from?.id;
  const userName = query.from?.first_name || 'Игрок';
  const game = activeGames.get(chatId);

  if (!game || game.phase === 'lobby' && !game) {
    await bot.answerCallbackQuery(query.id, { text: 'Игра не найдена.', show_alert: true });
    return;
  }

  // Уже в этой игре
  if (game.players.has(userId)) {
    await bot.answerCallbackQuery(query.id, { text: PHRASES.alreadyJoined, show_alert: true });
    return;
  }

  // В другой игре
  if (playerGameMap.has(userId)) {
    await bot.answerCallbackQuery(query.id, { text: PHRASES.alreadyInOther, show_alert: true });
    return;
  }

  // Поздний вход — даём очки = минимум среди игроков
  let startScore = 0;
  if (game.round > 0) {
    startScore = Math.min(...[...game.players.values()].map(p => p.score));
  }

  game.players.set(userId, {
    name: userName,
    score: startScore,
    lastSubmission: null,
    lastVote: null,
  });
  playerGameMap.set(userId, chatId);

  await bot.answerCallbackQuery(query.id, { text: PHRASES.joined });

  // Обновляем сообщение лобби (если ещё в лобби)
  if (game.phase === 'lobby' && game.lobbyMessageId) {
    const text = `${pick(PHRASES.lobbyStart)}\n\nИгроки (${game.players.size}): ${formatPlayerList(game)}\n\nЖдём ещё игроков...`;
    try {
      await bot.editMessageText(text, {
        chat_id: game.chatId,
        message_id: game.lobbyMessageId,
        reply_markup: {
          inline_keyboard: [
            [{ text: '🎮 Присоединиться', callback_data: `gamrule_join_${chatId}` }],
            [{ text: `▶️ Начать игру (${game.players.size} чел.)`, callback_data: `gamrule_start_${chatId}` }],
          ],
        },
      });
    } catch (_) {}
  }

  console.log(`[GAMRULE] ${userName} присоединился к игре в ${chatId} (всего: ${game.players.size})`);
}

async function handleStart(bot, query) {
  const data = query.data;
  const chatId = data.replace('gamrule_start_', '');
  const userId = query.from?.id;
  const game = activeGames.get(chatId);

  if (!game || game.phase !== 'lobby') {
    await bot.answerCallbackQuery(query.id, { text: 'Игра не найдена или уже начата.', show_alert: true });
    return;
  }

  if (userId !== game.hostUserId) {
    await bot.answerCallbackQuery(query.id, { text: PHRASES.hostOnly, show_alert: true });
    return;
  }

  if (game.players.size < 2) {
    await bot.answerCallbackQuery(query.id, {
      text: PHRASES.notEnough.replace('{count}', game.players.size),
      show_alert: true,
    });
    return;
  }

  await bot.answerCallbackQuery(query.id, { text: 'Игра начинается!' });

  // Отменяем таймаут лобби
  if (game.lobbyTimeoutId) {
    clearTimeout(game.lobbyTimeoutId);
    game.lobbyTimeoutId = null;
  }

  console.log(`[GAMRULE] Игра начата в ${chatId} с ${game.players.size} игроками`);
  await startRound(bot, chatId);
}

// === РАУНДЫ ===

async function startRound(bot, chatId) {
  const game = activeGames.get(chatId);
  if (!game) return;

  game.round++;
  game.phase = 'collecting';

  // Выбираем стих (не повторяя)
  const available = poems
    .map((p, i) => i)
    .filter(i => !game.usedPoemIndices.includes(i));

  if (available.length === 0) {
    // Все стихи использованы — начинаем заново
    game.usedPoemIndices = [];
    available.push(...poems.map((_, i) => i));
  }

  const poemIndex = pick(available);
  game.usedPoemIndices.push(poemIndex);
  game.currentPoem = poems[poemIndex];

  // Сбрасываем состояние раунда
  for (const [, player] of game.players) {
    player.lastSubmission = null;
    player.lastVote = null;
  }
  game.endings = [];

  // Отправляем стих в группу
  const roundText = pick(PHRASES.roundStart)
    .replace('{round}', game.round)
    .replace('{max}', MAX_ROUNDS)
    .replace('{author}', game.currentPoem.author)
    .replace('{opening}', game.currentPoem.opening);

  await bot.sendMessage(game.chatId, roundText, { parse_mode: 'HTML' });

  // Отправляем PM каждому игроку
  for (const [userId, player] of game.players) {
    try {
      await bot.sendMessage(userId,
        `📜 <b>Гамруль</b> — раунд ${game.round} в чате «${game.chatTitle}»\n\n` +
        `Автор: <b>${game.currentPoem.author}</b>\n\n` +
        `<i>${game.currentPoem.opening}</i>\n\n` +
        `✍️ Напиши свой вариант продолжения (одним сообщением):`,
        { parse_mode: 'HTML' }
      );
    } catch (err) {
      // Бот не может написать в ЛС — уведомляем в группе
      console.error(`[GAMRULE] Не удалось написать ${player.name} (${userId}): ${err.message}`);
      await bot.sendMessage(game.chatId,
        PHRASES.startPM.replace('{name}', player.name)
      ).catch(() => {});
    }
  }

  // Таймаут на сбор ответов
  game.collectTimeoutId = setTimeout(() => {
    endCollection(bot, chatId);
  }, COLLECT_TIMEOUT_MS);

  console.log(`[GAMRULE] Раунд ${game.round} начат в ${chatId}, стих: ${game.currentPoem.author} — ${game.currentPoem.title}`);
}

// === СБОР КОНЦОВОК ===

function isAwaitingSubmission(userId) {
  const chatId = playerGameMap.get(userId);
  if (!chatId) return false;
  const game = activeGames.get(chatId);
  if (!game || game.phase !== 'collecting') return false;
  const player = game.players.get(userId);
  return player && !player.lastSubmission;
}

async function handleSubmission(bot, msg) {
  const userId = msg.from?.id;
  const chatId = playerGameMap.get(userId);
  if (!chatId) return;

  const game = activeGames.get(chatId);
  if (!game || game.phase !== 'collecting') {
    await bot.sendMessage(msg.chat.id, PHRASES.notCollecting);
    return;
  }

  const player = game.players.get(userId);
  if (!player) return;

  if (player.lastSubmission) {
    await bot.sendMessage(msg.chat.id, PHRASES.alreadySubmitted);
    return;
  }

  player.lastSubmission = msg.text.trim();

  await bot.sendMessage(msg.chat.id, PHRASES.submitted);

  // Проверяем, все ли отправили
  const allSubmitted = [...game.players.values()].every(p => p.lastSubmission);
  if (allSubmitted) {
    if (game.collectTimeoutId) {
      clearTimeout(game.collectTimeoutId);
      game.collectTimeoutId = null;
    }
    await startVoting(bot, chatId);
  } else {
    const submitted = [...game.players.values()].filter(p => p.lastSubmission).length;
    await bot.sendMessage(game.chatId,
      `📝 Получено ${submitted}/${game.players.size} концовок...`
    ).catch(() => {});
  }
}

async function endCollection(bot, chatId) {
  const game = activeGames.get(chatId);
  if (!game || game.phase !== 'collecting') return;

  game.collectTimeoutId = null;

  // Проверяем, хоть кто-то прислал
  const hasSubmissions = [...game.players.values()].some(p => p.lastSubmission);
  if (!hasSubmissions) {
    await bot.sendMessage(game.chatId,
      '🐍 Никто не прислал концовку... Каа разочарован. Пропускаем раунд.'
    ).catch(() => {});

    // Показываем правильный ответ
    await bot.sendMessage(game.chatId,
      `Настоящая концовка была:\n\n<i>${game.currentPoem.realEnding}</i>\n\n— <b>${game.currentPoem.author}</b>, «${game.currentPoem.title}»`,
      { parse_mode: 'HTML' }
    ).catch(() => {});

    await checkEndOrNextRound(bot, chatId);
    return;
  }

  await startVoting(bot, chatId);
}

// === ГОЛОСОВАНИЕ ===

async function startVoting(bot, chatId) {
  const game = activeGames.get(chatId);
  if (!game) return;

  game.phase = 'voting';

  // Собираем концовки: реальная + фейковые от игроков
  const endings = [];

  // Добавляем настоящую
  endings.push({
    text: game.currentPoem.realEnding,
    userId: null,
    isReal: true,
  });

  // Добавляем фейковые от игроков
  for (const [userId, player] of game.players) {
    if (player.lastSubmission) {
      endings.push({
        text: player.lastSubmission,
        userId,
        isReal: false,
      });
    }
  }

  // Перемешиваем
  game.endings = shuffle(endings);

  // Формируем текст с вариантами
  let votingText = pick(PHRASES.votingStart);
  game.endings.forEach((e, i) => {
    votingText += `<b>${i + 1}.</b> <i>${e.text}</i>\n\n`;
  });

  // Формируем кнопки
  const buttons = game.endings.map((_, i) => ({
    text: `${i + 1}`,
    callback_data: `gamrule_vote_${chatId}_${i}`,
  }));

  // Раскладываем кнопки в ряды по 3-4
  const keyboard = [];
  for (let i = 0; i < buttons.length; i += 4) {
    keyboard.push(buttons.slice(i, i + 4));
  }

  await bot.sendMessage(game.chatId, votingText, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: keyboard },
  });

  // Таймаут голосования
  game.voteTimeoutId = setTimeout(() => {
    endVoting(bot, chatId);
  }, VOTE_TIMEOUT_MS);

  console.log(`[GAMRULE] Голосование начато в ${chatId}, ${game.endings.length} вариантов`);
}

async function handleVote(bot, query) {
  const data = query.data; // gamrule_vote_CHATID_INDEX
  const parts = data.split('_');
  const voteIndex = parseInt(parts[parts.length - 1], 10);
  const chatId = parts.slice(2, -1).join('_'); // chatId может быть отрицательным
  const userId = query.from?.id;

  const game = activeGames.get(chatId);
  if (!game || game.phase !== 'voting') {
    await bot.answerCallbackQuery(query.id, { text: 'Голосование завершено.', show_alert: true });
    return;
  }

  const player = game.players.get(userId);
  if (!player) {
    await bot.answerCallbackQuery(query.id, { text: PHRASES.notInGame, show_alert: true });
    return;
  }

  if (player.lastVote !== null) {
    await bot.answerCallbackQuery(query.id, { text: PHRASES.alreadyVoted, show_alert: true });
    return;
  }

  // Нельзя голосовать за свой вариант
  const ending = game.endings[voteIndex];
  if (ending && ending.userId === userId) {
    await bot.answerCallbackQuery(query.id, { text: PHRASES.cantVoteSelf, show_alert: true });
    return;
  }

  player.lastVote = voteIndex;
  await bot.answerCallbackQuery(query.id, { text: `Голос принят: вариант ${voteIndex + 1}` });

  // Проверяем, все ли проголосовали (только те, кто может голосовать)
  const eligibleVoters = [...game.players.values()];
  const allVoted = eligibleVoters.every(p => p.lastVote !== null);
  if (allVoted) {
    if (game.voteTimeoutId) {
      clearTimeout(game.voteTimeoutId);
      game.voteTimeoutId = null;
    }
    await showResults(bot, chatId);
  }
}

async function endVoting(bot, chatId) {
  const game = activeGames.get(chatId);
  if (!game || game.phase !== 'voting') return;

  game.voteTimeoutId = null;
  await showResults(bot, chatId);
}

// === РЕЗУЛЬТАТЫ ===

async function showResults(bot, chatId) {
  const game = activeGames.get(chatId);
  if (!game) return;

  game.phase = 'results';

  // Находим индекс правильного ответа
  const realIndex = game.endings.findIndex(e => e.isReal);

  // Считаем очки
  const roundScores = new Map(); // userId -> очки за раунд
  for (const [userId] of game.players) {
    roundScores.set(userId, 0);
  }

  for (const [userId, player] of game.players) {
    if (player.lastVote === null) continue;

    const votedEnding = game.endings[player.lastVote];
    if (!votedEnding) continue;

    // +3 за угадывание настоящей концовки
    if (votedEnding.isReal) {
      roundScores.set(userId, (roundScores.get(userId) || 0) + 3);
    }

    // +1 автору концовки, за которую проголосовали (если это не настоящая)
    if (!votedEnding.isReal && votedEnding.userId) {
      roundScores.set(votedEnding.userId, (roundScores.get(votedEnding.userId) || 0) + 1);
    }
  }

  // Применяем очки
  for (const [userId, pts] of roundScores) {
    const player = game.players.get(userId);
    if (player) player.score += pts;
  }

  // Формируем результат
  let resultText = `📊 <b>Результаты раунда ${game.round}</b>\n\n`;
  resultText += `✅ Правильный ответ — вариант <b>${realIndex + 1}</b>:\n<i>${game.currentPoem.realEnding}</i>\n— <b>${game.currentPoem.author}</b>, «${game.currentPoem.title}»\n\n`;

  // Кто за что голосовал
  resultText += '🗳 Голоса:\n';
  for (const [userId, player] of game.players) {
    if (player.lastVote !== null) {
      const pts = roundScores.get(userId) || 0;
      const mark = player.lastVote === realIndex ? '✅' : '❌';
      resultText += `${mark} ${player.name} → вариант ${player.lastVote + 1} (${pts > 0 ? '+' + pts : '0'} очк.)\n`;
    } else {
      resultText += `⬜ ${player.name} — не голосовал\n`;
    }
  }

  resultText += `\n🏆 <b>Счёт:</b>\n${formatScoreboard(game)}`;

  await bot.sendMessage(game.chatId, resultText, { parse_mode: 'HTML' });

  console.log(`[GAMRULE] Результаты раунда ${game.round} в ${chatId}`);

  await checkEndOrNextRound(bot, chatId);
}

async function checkEndOrNextRound(bot, chatId) {
  const game = activeGames.get(chatId);
  if (!game) return;

  // Проверяем победителя (15+ очков)
  let winner = null;
  for (const [, player] of game.players) {
    if (player.score >= WIN_SCORE) {
      if (!winner || player.score > winner.score) {
        winner = player;
      }
    }
  }

  // Проверяем конец по раундам
  const isLastRound = game.round >= MAX_ROUNDS;

  if (winner) {
    await bot.sendMessage(game.chatId,
      `🎉🐍 <b>${winner.name}</b> набирает ${winner.score} очков и побеждает!\n\nКаа впечатлён вашим поэтическим мастерством...`,
      { parse_mode: 'HTML' }
    );
    cleanupGame(chatId);
    console.log(`[GAMRULE] Победитель в ${chatId}: ${winner.name} (${winner.score} очков)`);
    return;
  }

  if (isLastRound) {
    const sorted = [...game.players.values()].sort((a, b) => b.score - a.score);
    const topPlayer = sorted[0];
    await bot.sendMessage(game.chatId,
      `🏁 7 раундов позади!\n\n🏆 Победитель: <b>${topPlayer.name}</b> с ${topPlayer.score} очками!\n\n` +
      `Итоговый счёт:\n${formatScoreboard(game)}\n\n🐍 Каа доволен представлением...`,
      { parse_mode: 'HTML' }
    );
    cleanupGame(chatId);
    console.log(`[GAMRULE] Игра окончена в ${chatId} после ${MAX_ROUNDS} раундов, победитель: ${topPlayer.name}`);
    return;
  }

  // Следующий раунд через паузу
  setTimeout(() => {
    startRound(bot, chatId).catch(err => {
      console.error(`[GAMRULE] Ошибка начала раунда в ${chatId}:`, err.message);
    });
  }, BETWEEN_ROUNDS_MS);
}

// === СТОП ===

async function stopGame(bot, msg) {
  const chatId = String(msg.chat.id);
  const game = activeGames.get(chatId);

  if (!game) {
    await bot.sendMessage(msg.chat.id, PHRASES.noGame);
    return;
  }

  cleanupGame(chatId);
  await bot.sendMessage(msg.chat.id, PHRASES.stopped);
  console.log(`[GAMRULE] Игра остановлена в ${chatId}`);
}

// === CLEANUP ===

function cleanupGame(chatId) {
  const game = activeGames.get(chatId);
  if (!game) return;

  if (game.collectTimeoutId) clearTimeout(game.collectTimeoutId);
  if (game.voteTimeoutId) clearTimeout(game.voteTimeoutId);
  if (game.lobbyTimeoutId) clearTimeout(game.lobbyTimeoutId);

  // Убираем всех игроков из карты
  for (const userId of game.players.keys()) {
    playerGameMap.delete(userId);
  }

  activeGames.delete(chatId);
}

module.exports = {
  startLobby,
  stopGame,
  handleCallback,
  isAwaitingSubmission,
  handleSubmission,
};
