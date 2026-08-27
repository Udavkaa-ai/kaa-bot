const usersRepo = require('../db/repo/users');
const { getPersonaById, getRandomPersona } = require('../ai/personas');
const { buildPersonaKeyboard, getPersonaIconMap } = require('./persona');
const { moscowToday } = require('../utils/time');
const rawApi = require('../utils/rawApi');
const giveaway = require('./giveaway');

async function handleCallback(bot, query) {
  const data = query.data || '';

  if (data.startsWith('gw:')) {
    return giveaway.handleJoinCallback(bot, query);
  }

  if (!data.startsWith('persona:')) return false;

  const userId = query.from.id;
  const chatId = query.message.chat.id;
  let personaId = data.replace('persona:', '');

  let persona = null;
  if (personaId === 'random') {
    persona = getRandomPersona();
    personaId = persona.id;
  } else {
    persona = getPersonaById(personaId);
  }

  if (!persona) {
    await bot.answerCallbackQuery(query.id, { text: 'Такой личности нет' });
    return true;
  }

  await usersRepo.setUserPersona(userId, chatId, personaId, moscowToday());

  // Перекрашиваем клавиатуру: выбранная персона теперь зелёная с галкой.
  // Меню остаётся живым — другие участники чата тоже могут выбрать себе персону.
  const iconMap = await getPersonaIconMap();
  const kb = { inline_keyboard: buildPersonaKeyboard(personaId, iconMap) };
  try {
    await bot.editMessageReplyMarkup(kb, { chat_id: chatId, message_id: query.message.message_id });
  } catch (_) {
    // Меню могло быть эфемерным (в группах) — редактируем спец-методом Bot API 10.x
    try {
      await rawApi.call('editEphemeralMessageReplyMarkup', {
        chat_id: chatId,
        receiver_user_id: userId,
        ephemeral_message_id: query.message.message_id,
        reply_markup: kb,
      });
    } catch (_) {}
  }

  await bot.answerCallbackQuery(query.id, { text: `Сегодня с тобой — ${persona.name}` });
  await bot.sendMessage(chatId, `${persona.name} здесь.`);
  return true;
}

module.exports = { handleCallback };
