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

// Первая строка каждого ответа — имя персоны (и её эмодзи если есть).
// Смысл — юзер видит кто именно ответил, потому что Telegram-имя бота
// одно на все персоны.
function withPersonaTag(text, persona) {
  if (!persona || !persona.name || !text) return text;
  const emoji = PERSONA_EMOJI[persona.id] || '';
  const tag = emoji ? `${emoji} ${persona.name}` : persona.name;
  // Если Claude сам начал ответ с имени персоны (например "Маша: ..."), не дублируем.
  const firstLine = text.split('\n', 1)[0].trim().toLowerCase();
  const nameLower = persona.name.toLowerCase();
  if (firstLine.startsWith(nameLower + ':') || firstLine === nameLower) {
    return text;
  }
  return `${tag}\n${text}`;
}

module.exports = { withPersonaTag, PERSONA_EMOJI };
