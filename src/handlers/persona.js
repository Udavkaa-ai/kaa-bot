const usersRepo = require('../db/repo/users');
const { PERSONAS, getRandomPersona, getPersonaById, findPersonaInText } = require('../ai/personas');
const { moscowToday } = require('../utils/time');

async function resolvePersona(userId, chatId, msgText) {
  // 1. Пользователь позвал персону по имени
  const named = findPersonaInText(msgText);
  const today = moscowToday();

  if (named) {
    await usersRepo.setUserPersona(userId, chatId, named.id, today);
    return { persona: named, justAssigned: true, byName: true };
  }

  // 2. Существующее назначение
  const row = await usersRepo.getUserPersona(userId, chatId);
  if (row) {
    const dateStr = row.date_assigned instanceof Date
      ? row.date_assigned.toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' })
      : String(row.date_assigned);
    if (dateStr === today) {
      const p = getPersonaById(row.persona_id);
      if (p) return { persona: p, justAssigned: false };
    }
  }

  // 3. Новый день или первое обращение — случайная
  const random = getRandomPersona();
  await usersRepo.setUserPersona(userId, chatId, random.id, today);
  return { persona: random, justAssigned: true };
}

async function sendPersonaMenu(bot, chatId, replyToMessageId) {
  const buttons = [];
  for (let i = 0; i < PERSONAS.length; i += 2) {
    const row = [
      { text: `${PERSONAS[i].name} — ${PERSONAS[i].description}`, callback_data: `persona:${PERSONAS[i].id}` },
    ];
    if (PERSONAS[i + 1]) {
      row.push({ text: `${PERSONAS[i + 1].name} — ${PERSONAS[i + 1].description}`, callback_data: `persona:${PERSONAS[i + 1].id}` });
    }
    buttons.push(row);
  }
  buttons.push([{ text: '🎲 Случайный', callback_data: 'persona:random' }]);
  await bot.sendMessage(chatId, 'Выбери с кем поговорить сегодня:', {
    reply_to_message_id: replyToMessageId,
    reply_markup: { inline_keyboard: buttons },
  });
}

module.exports = { resolvePersona, sendPersonaMenu };
