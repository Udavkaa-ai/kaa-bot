// Emoji-иконка на каждую персону, чтобы в сообщении сразу было видно кто отвечает.
const PERSONA_EMOJI = {
  kolyan: '🌾',
  artvednik: '📈',
  filosof: '🎓',
  masha: '💋',
  polkovnik: '🎖',
  vitya: '🧸',
  professor: '🩺',
  rapper: '🎤',
  detective: '🕵️',
  babushka: '👵',
};

// Эмодзи-маркер персоны в начале сообщения. Один символ, никакого имени —
// юзер по эмодзи узнаёт кто отвечает, а Telegram-имя бота одинаковое на всех.
function withPersonaTag(text, persona) {
  if (!persona || !text) return text;
  const emoji = PERSONA_EMOJI[persona.id];
  if (!emoji) return text;
  // Если ответ уже начинается с этого же эмодзи — не дублируем.
  if (text.startsWith(emoji)) return text;
  return `${emoji} ${text}`;
}

module.exports = { withPersonaTag, PERSONA_EMOJI };
