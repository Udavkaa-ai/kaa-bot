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

// Карта кастомных эмодзи-иконок (настраивается владельцем через /personaemoji)
async function getPersonaIconMap() {
  try {
    const settingsRepo = require('../db/repo/settings');
    return await settingsRepo.getJson('persona_emoji_map');
  } catch (_) {
    return null;
  }
}

// Инлайн-клавиатура выбора персон. activeId — id текущей персоны кликера,
// её кнопка красится зелёным (style, Bot API 10.3) и помечается галкой.
// iconMap — {personaId: custom_emoji_id}: премиум-иконка перед текстом кнопки.
function buildPersonaKeyboard(activeId, iconMap = null) {
  const makeBtn = (p) => {
    const isActive = p.id === activeId;
    const customIcon = iconMap && iconMap[p.id];
    // Если есть кастомная иконка — юникод-эмодзи из текста убираем, чтобы не дублировалось
    const emoji = customIcon ? '' : (PERSONA_EMOJI[p.id] || '');
    const btn = {
      text: `${emoji} ${p.name}${isActive ? ' ✓' : ''}`.trim(),
      callback_data: `persona:${p.id}`,
    };
    // Неизвестные поля старая либа просто пробрасывает в JSON — безопасно.
    if (customIcon) btn.icon_custom_emoji_id = customIcon;
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

  const iconMap = await getPersonaIconMap();
  const buttons = buildPersonaKeyboard(activeId, iconMap);

  // Описания — в раскрывающейся цитате, чтобы кнопки остались короткими
  const descLines = PERSONAS
    .map(p => `${PERSONA_EMOJI[p.id] || '•'} <b>${p.name}</b> — ${p.description}`)
    .join('\n');
  const text =
    'Выбери с кем поговорить сегодня:\n' +
    `<blockquote expandable>${descLines}</blockquote>`;

  // В группах меню видно только тому, кто его вызвал (эфемерное сообщение,
  // Bot API 10.x) — не засоряем чат. Фолбэк на обычное сообщение.
  if (chatId < 0 && userId) {
    try {
      const rawApi = require('../utils/rawApi');
      await rawApi.call('sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        ephemeral_message_parameters: { receiver_user_id: userId },
        reply_markup: { inline_keyboard: buttons },
      });
      return;
    } catch (err) {
      console.warn('[PERSONA] ephemeral menu failed, fallback:', err.message);
    }
  }

  await bot.sendMessage(chatId, text, {
    parse_mode: 'HTML',
    reply_to_message_id: replyToMessageId,
    reply_markup: { inline_keyboard: buttons },
  });
}

module.exports = { resolvePersona, sendPersonaMenu, buildPersonaKeyboard, getPersonaIconMap };
