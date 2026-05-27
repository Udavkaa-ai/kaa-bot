const usersRepo = require('../db/repo/users');
const { getPersonaById, getRandomPersona } = require('../ai/personas');
const { moscowToday } = require('../utils/time');

async function handleCallback(bot, query) {
  const data = query.data || '';
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

  try {
    await bot.editMessageReplyMarkup(
      { inline_keyboard: [] },
      { chat_id: chatId, message_id: query.message.message_id }
    );
  } catch (_) {}

  await bot.answerCallbackQuery(query.id, { text: `Сегодня с тобой — ${persona.name}` });
  await bot.sendMessage(chatId, `${persona.name} здесь.`);
  return true;
}

module.exports = { handleCallback };
