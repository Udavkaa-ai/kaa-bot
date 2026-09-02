// Комнаты соревнований "Эрудит": одна активная комната на чат, 2–5 игроков.
// Состояние в памяти процесса; результаты уходят в quiz_scores и постятся ботом в чат.
const quizRepo = require('../db/repo/quiz');
const { generateVerifiedQuestion } = require('../handlers/quiz');

const Q_MS = 15000;        // время на вопрос
const REVIEW_MS = 5000;    // разбор после вопроса
const MAX_PLAYERS = 5;
const MIN_PLAYERS = 2;
const ROOM_TTL_MS = 30 * 60 * 1000;
const FINISHED_TTL_MS = 3 * 60 * 1000;

const rooms = new Map(); // chatId -> room
let poster = null;       // async (chatId, text) => void

function setPoster(fn) { poster = fn; }

function now() { return Date.now(); }

function getRoom(chatId) {
  const r = rooms.get(chatId);
  if (!r) return null;
  tick(r);
  return r;
}

function createRoom(chatId, host, topic, count) {
  const existing = rooms.get(chatId);
  if (existing) {
    tick(existing);
    if (existing.phase !== 'finished') throw new Error('В этом чате уже есть комната');
    rooms.delete(chatId);
  }
  const room = {
    id: `${chatId}:${now()}`,
    chatId,
    hostId: host.id,
    topic: topic || null,
    plannedCount: Math.min(15, Math.max(3, count || 5)),
    questions: [],
    genDone: false,
    genError: null,
    cancelled: false,
    phase: 'lobby',
    qIndex: -1,
    phaseStartedAt: now(),
    phaseEndsAt: null,
    players: new Map(),
    reviewed: new Set(),
    posted: false,
    createdAt: now(),
    lastActivity: now(),
  };
  room.players.set(host.id, { id: host.id, name: host.name, score: 0, answers: {} });
  rooms.set(chatId, room);
  generateAll(room).catch(err => { room.genError = err.message; room.genDone = true; });
  return room;
}

async function generateAll(room) {
  let recent = [];
  try { recent = await quizRepo.getRecentQuestions(room.chatId, 40); } catch (_) {}
  for (let i = 0; i < room.plannedCount; i++) {
    if (room.cancelled) return;
    const avoid = [...recent, ...room.questions.map(q => q.question)];
    let q = null;
    try { q = await generateVerifiedQuestion(room.topic, avoid); } catch (err) {
      console.warn('[ARENA] gen failed:', err.message);
    }
    if (!q) continue;
    room.questions.push(q);
    quizRepo.saveQuiz({
      pollId: `arena:${room.id}:${i}`,
      chatId: room.chatId,
      messageId: null,
      question: q.question,
      correctOption: q.correct_option,
      topic: room.topic,
    }).catch(() => {});
  }
  room.genDone = true;
  if (room.questions.length === 0) room.genError = 'Не удалось подготовить вопросы';
}

function join(chatId, user) {
  const room = getRoom(chatId);
  if (!room) throw new Error('Комнаты нет');
  if (room.phase !== 'lobby') throw new Error('Игра уже началась');
  if (room.players.has(user.id)) return room;
  if (room.players.size >= MAX_PLAYERS) throw new Error('Комната полная (5 игроков)');
  room.players.set(user.id, { id: user.id, name: user.name, score: 0, answers: {} });
  room.lastActivity = now();
  return room;
}

function leave(chatId, userId) {
  const room = getRoom(chatId);
  if (!room) return null;
  if (room.phase !== 'lobby') throw new Error('Во время игры выйти нельзя');
  room.players.delete(userId);
  if (room.players.size === 0) {
    room.cancelled = true;
    rooms.delete(chatId);
    return null;
  }
  if (room.hostId === userId) room.hostId = room.players.keys().next().value;
  room.lastActivity = now();
  return room;
}

function start(chatId, userId) {
  const room = getRoom(chatId);
  if (!room) throw new Error('Комнаты нет');
  if (room.phase !== 'lobby') throw new Error('Уже идёт');
  if (room.hostId !== userId) throw new Error('Стартовать может только хост');
  if (room.players.size < MIN_PLAYERS) throw new Error(`Нужно минимум ${MIN_PLAYERS} игрока`);
  if (!room.genDone) throw new Error('Вопросы ещё готовятся');
  if (room.questions.length === 0) throw new Error(room.genError || 'Нет вопросов');
  room.qIndex = 0;
  room.phase = 'question';
  room.phaseStartedAt = now();
  room.phaseEndsAt = room.phaseStartedAt + Q_MS;
  room.lastActivity = now();
  return room;
}

function answer(chatId, userId, qIndex, option) {
  const room = getRoom(chatId);
  if (!room) throw new Error('Комнаты нет');
  const p = room.players.get(userId);
  if (!p) throw new Error('Ты не в комнате');
  if (room.phase !== 'question' || room.qIndex !== qIndex) throw new Error('Этот вопрос уже закрыт');
  if (p.answers[qIndex] !== undefined) throw new Error('Уже ответил');
  const t = now();
  const q = room.questions[qIndex];
  const correct = option === q.correct_option;
  const remaining = Math.max(0, room.phaseEndsAt - t);
  const points = correct ? 100 + Math.round(100 * remaining / Q_MS) : 0;
  p.answers[qIndex] = { option, correct, points, at: t };
  p.score += points;
  room.lastActivity = t;
  tick(room);
  return { correct: undefined, points: undefined }; // не раскрываем до разбора
}

// Ленивый тик: состояние продвигается при любом запросе. Крутим до устойчивого
// состояния, чтобы после долгой паузы (все свернули приложение) игра догнала
// расписание за один вызов, а не по фазе на каждый poll.
function tick(room) {
  for (let guard = 0; guard < 100; guard++) {
    const t = now();
    if (room.phase === 'question') {
      const all = [...room.players.values()].every(p => p.answers[room.qIndex] !== undefined);
      if (t >= room.phaseEndsAt || all) { enterReview(room, t); continue; }
    } else if (room.phase === 'review') {
      if (t >= room.phaseEndsAt) { nextQuestion(room, t); continue; }
    }
    break;
  }
}

function enterReview(room, t) {
  room.phase = 'review';
  room.phaseStartedAt = t;
  room.phaseEndsAt = t + REVIEW_MS;
  if (!room.reviewed.has(room.qIndex)) {
    room.reviewed.add(room.qIndex);
    // Ответы соревнования идут в общий чатовый /leaderboard
    for (const p of room.players.values()) {
      const a = p.answers[room.qIndex];
      if (!a) continue;
      quizRepo.bumpScore(room.chatId, p.id, p.name, a.correct).catch(() => {});
    }
  }
}

function nextQuestion(room, t) {
  room.qIndex++;
  if (room.qIndex >= room.questions.length) {
    finish(room, t);
    return;
  }
  room.phase = 'question';
  room.phaseStartedAt = t;
  room.phaseEndsAt = t + Q_MS;
}

function sortedPlayers(room) {
  return [...room.players.values()]
    .map(p => ({
      id: p.id, name: p.name, score: p.score,
      correct: Object.values(p.answers).filter(a => a.correct).length,
    }))
    .sort((a, b) => b.score - a.score || b.correct - a.correct);
}

function finish(room, t) {
  room.phase = 'finished';
  room.finishedAt = t;
  room.phaseEndsAt = null;
  if (!room.posted && poster) {
    room.posted = true;
    const medals = ['🥇', '🥈', '🥉'];
    const list = sortedPlayers(room).map((p, i) =>
      `${medals[i] || `${i + 1}.`} ${p.name} — ${p.score} очков (${p.correct}/${room.questions.length})`);
    const text =
      `🏆 Эрудит — соревнование${room.topic ? ` «${room.topic}»` : ''}, ${room.questions.length} вопросов\n\n` +
      list.join('\n') + `\n\nОбщий топ: /leaderboard`;
    poster(room.chatId, text).catch(err => console.error('[ARENA POST]', err.message));
  }
}

function getState(chatId, userId) {
  const room = getRoom(chatId);
  if (!room) return null;
  const reveal = room.phase === 'review' || room.phase === 'finished';
  const q = room.qIndex >= 0 ? room.questions[room.qIndex] : null;
  const me = room.players.get(userId);
  const myAnswer = me && q ? me.answers[room.qIndex] : null;
  return {
    exists: true,
    id: room.id,
    phase: room.phase,
    topic: room.topic,
    plannedCount: room.plannedCount,
    count: room.questions.length,
    hostId: room.hostId,
    isHost: room.hostId === userId,
    joined: !!me,
    players: [...room.players.values()].map(p => {
      const a = p.answers[room.qIndex];
      return {
        id: p.id, name: p.name, score: p.score,
        answered: a !== undefined,
        last: reveal && a ? { option: a.option, correct: a.correct, points: a.points } : null,
      };
    }),
    genReady: room.questions.length,
    genTotal: room.plannedCount,
    genDone: room.genDone,
    genError: room.genError,
    qIndex: room.qIndex,
    question: q ? {
      text: q.question,
      options: q.options,
      ...(reveal ? { correct_option: q.correct_option, explanation: q.explanation } : {}),
    } : null,
    myAnswer: myAnswer ? myAnswer.option : null,
    myLast: reveal && myAnswer ? { correct: myAnswer.correct, points: myAnswer.points } : null,
    serverNow: now(),
    phaseEndsAt: room.phaseEndsAt,
    results: room.phase === 'finished' ? sortedPlayers(room) : null,
    maxPlayers: MAX_PLAYERS,
    minPlayers: MIN_PLAYERS,
    qMs: Q_MS,
  };
}

// Уборка брошенных/завершённых комнат
setInterval(() => {
  const t = now();
  for (const [chatId, room] of rooms) {
    if (room.phase === 'finished' && t - room.finishedAt > FINISHED_TTL_MS) {
      rooms.delete(chatId);
    } else if (t - room.lastActivity > ROOM_TTL_MS) {
      room.cancelled = true;
      rooms.delete(chatId);
    }
  }
}, 60 * 1000).unref();

module.exports = { setPoster, createRoom, join, leave, start, answer, getState, Q_MS };
