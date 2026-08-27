const usersRepo = require('../db/repo/users');
const { PERSONAS, getRandomPersona, getPersonaById, findPersonaInText } = require('../ai/personas');
const { PERSONA_EMOJI } = require('../utils/personaTag');
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

// Инлайн-клавиатура выбора персон. activeId — id текущей персоны кликера,
// её кнопка красится зелёным (style, Bot API 10.3) и помечается галкой.
function buildPersonaKeyboard(activeId) {
  const makeBtn = (p) => {
    const emoji = PERSONA_EMOJI[p.id] || '';
    const isActive = p.id === activeId;
    const btn = {
      text: `${emoji} ${p.name}${isActive ? ' ✓' : ''}`.trim(),
      callback_data: `persona:${p.id}`,
    };
    // Неизвестные поля старая либа просто пробрасывает в JSON — безопасно.
    if (isActive) btn.style = 'success';
    return btn;
  };
  const buttons = [];
  for (let i = 0; i < PERSONAS.length; i += 2) {
    const row = [makeBtn(PERSONAS[i])];
    if (PERSONAS[i + 1]) row.push(makeBtn(PERSONAS[i + 1]));
    buttons.push(row);
  }
  buttons.push([{ text: '🎲 Случайный', callback_data: 'persona:random', style: 'primary' }]);
  return buttons;
}

async function sendPersonaMenu(bot, chatId, replyToMessageId, userId) {
  // Кто сейчас активен у этого юзера (подсветим зелёной кнопкой, Bot API 10.3 style)
  let activeId = null;
  if (userId) {
    try {
      const row = await usersRepo.getUserPersona(userId, chatId);
      if (row) {
        const dateStr = row.date_assigned instanceof Date
          ? row.date_assigned.toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' })
          : String(row.date_assigned);
        if (dateStr === moscowToday()) activeId = row.persona_id;
      }
    } catch (_) {}
  }

  const buttons = buildPersonaKeyboard(activeId);

  // Описания — в раскрывающейся цитате, чтобы кнопки остались короткими
  const descLines = PERSONAS
    .map(p => `${PERSONA_EMOJI[p.id] || '•'} <b>${p.name}</b> — ${p.description}`)
    .join('\n');
  const text =
    'Выбери с кем поговорить сегодня:\n' +
    `<blockquote expandable>${descLines}</blockquote>`;

  await bot.sendMessage(chatId, text, {
    parse_mode: 'HTML',
    reply_to_message_id: replyToMessageId,
    reply_markup: { inline_keyboard: buttons },
  });
}

module.exports = { resolvePersona, sendPersonaMenu, buildPersonaKeyboard };
