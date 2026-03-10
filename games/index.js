const config = require('../config');
const hangman = require('./hangman');

// Гамруль подключается лениво (чтобы не грузить если не нужен)
let gamrule = null;
function getGamrule() {
  if (!gamrule) gamrule = require('./gamrule');
  return gamrule;
}

// Регулярка для одиночной русской буквы
const SINGLE_LETTER = /^[а-яёА-ЯЁ]$/;

/**
 * Обрабатывает сообщение как игровое.
 * Возвращает true если сообщение обработано (handler.js должен пропустить AI).
 */
async function handleGameMessage(bot, msg) {
  if (!config.GAMES_ENABLED) return false;

  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();
  const isPrivate = msg.chat.type === 'private';
  const userId = msg.from?.id;

  // --- Команды виселицы ---
  const lowerText = text.toLowerCase();
  if (lowerText === '/hangman' || lowerText === '/виселица' ||
      lowerText.startsWith('/hangman@') || lowerText.startsWith('/виселица@')) {
    await hangman.startGame(bot, msg);
    return true;
  }
  if (lowerText === '/hangman стоп' || lowerText === '/виселица стоп' ||
      lowerText.startsWith('/hangman_stop') || lowerText.startsWith('/виселица_стоп')) {
    await hangman.stopGame(bot, msg);
    return true;
  }

  // --- Команды гамруля ---
  if (lowerText === '/gamrule' || lowerText === '/гамруль' ||
      lowerText.startsWith('/gamrule@') || lowerText.startsWith('/гамруль@')) {
    await getGamrule().startLobby(bot, msg);
    return true;
  }
  if (lowerText === '/gamrule стоп' || lowerText === '/гамруль стоп' ||
      lowerText.startsWith('/gamrule_stop') || lowerText.startsWith('/гамруль_стоп')) {
    await getGamrule().stopGame(bot, msg);
    return true;
  }

  // --- Одиночная буква при активной виселице ---
  if (SINGLE_LETTER.test(text) && hangman.hasActiveGame(chatId)) {
    await hangman.guessLetter(bot, msg);
    return true;
  }

  // --- PM-ответ для гамруля (отправка концовки) ---
  if (isPrivate && userId && getGamrule().isAwaitingSubmission(userId)) {
    await getGamrule().handleSubmission(bot, msg);
    return true;
  }

  return false;
}

/**
 * Обрабатывает callback_query от inline-кнопок (гамруль).
 */
async function handleGameCallback(bot, query) {
  if (!config.GAMES_ENABLED) {
    await bot.answerCallbackQuery(query.id);
    return;
  }

  const data = query.data || '';

  if (data.startsWith('gamrule_')) {
    await getGamrule().handleCallback(bot, query);
    return;
  }

  // Неизвестный callback — просто закрываем спиннер
  await bot.answerCallbackQuery(query.id);
}

module.exports = { handleGameMessage, handleGameCallback };
