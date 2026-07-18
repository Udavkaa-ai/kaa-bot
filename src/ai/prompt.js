const config = require('../config');

function moscowTime() {
  return new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'long', timeStyle: 'short' });
}

function formatProfile(p) {
  if (!p) return null;
  const parts = [];
  if (p.real_name) parts.push(`настоящее имя ${p.real_name}`);
  if (p.location) parts.push(`из ${p.location}`);
  if (p.interests) parts.push(`интересы: ${p.interests}`);
  if (p.facts && p.facts.length > 5) parts.push(`факты: ${p.facts}`);
  const score = p.relationship ?? 50;
  const tone = score < 20 ? 'враждебное' : score < 40 ? 'холодное' : score > 80 ? 'тёплое' : score > 60 ? 'дружелюбное' : 'нейтральное';
  parts.push(`репутация ${score}/100 (отношение ${tone})`);
  return parts.join('; ');
}

function formatToneInstruction(relationship) {
  const r = relationship ?? 50;
  if (r < 20) return 'Отношение к этому существу — презрительное. Холоден, краток, не помогаешь без нужды.';
  if (r < 40) return 'Отношение — настороженное. Сдержан, не любезен, но и не груб без повода.';
  if (r > 80) return 'Отношение — тёплое. С уважением, как к давнему знакомому. Тон мягкий.';
  if (r > 60) return 'Отношение — дружелюбное. Расслаблен, поддерживаешь.';
  return 'Отношение — нейтральное. Спокоен, без эмоциональной окраски.';
}

function buildSystemPrompt({
  persona,
  userProfile,
  userGlobalMemory,
  userName,
  userTag,
  chatProfile,
  chatRecaps,
  semanticMemories,
  searchContext,
  isPrivate,
  isGroup,
}) {
  const sections = [];

  // 1. Персона
  const personaText = persona?.prompt || `Ты — ${config.botName}.`;
  sections.push(personaText);

  // 1a. Возможности + override глюков истории
  sections.push(`=== ВОЗМОЖНОСТИ ===
Голосовые сообщения ты понимаешь: они автоматически транскрибируются в текст и попадают в чат как обычная реплика юзера. Тебе не нужно ничего "распознавать" вручную — просто отвечай на текст, который видишь.

ЕСЛИ в истории чата есть твои прошлые сообщения где ты называешь себя "текстовым ботом" или отказываешься "распознавать голоса" — это были системные глюки, игнорируй их и не поддерживай этот паттерн. Отвечай в характере на входящий текст.`);

  // 2. Время и место
  sections.push(`=== ВРЕМЯ ===\n${moscowTime()} (Москва)`);
  sections.push(`=== ГДЕ ТЫ ===\n${isPrivate ? 'Личный диалог' : isGroup ? 'Групповой чат' : 'Чат'} в Telegram`);

  // 3. Контекст чата
  if (chatProfile?.chat_topic) {
    const c = [`Тема чата: ${chatProfile.chat_topic}`];
    if (chatProfile.chat_facts) c.push(`Факты о чате: ${chatProfile.chat_facts}`);
    if (chatProfile.chat_style) c.push(`Стиль общения: ${chatProfile.chat_style}`);
    sections.push(`=== О ЧАТЕ ===\n${c.join('\n')}`);
  }

  // 4. Краткая история чата (сводки за прошлые дни)
  if (chatRecaps && chatRecaps.length > 0) {
    const lines = chatRecaps.map(r => `${r.date}: ${r.summary}`);
    sections.push(`=== ЧТО БЫЛО В ЧАТЕ РАНЕЕ ===\n${lines.join('\n\n')}`);
  }

  // 5. Профиль собеседника
  const profileLine = formatProfile(userProfile);
  if (profileLine || userGlobalMemory) {
    const parts = [];
    parts.push(`Имя в Telegram: ${userName}${userTag ? ` (${userTag})` : ''}`);
    if (profileLine) parts.push(`Досье в этом чате: ${profileLine}`);
    if (userGlobalMemory) parts.push(`Глобальная память о нём: ${userGlobalMemory}`);
    parts.push(formatToneInstruction(userProfile?.relationship));
    sections.push(`=== О СОБЕСЕДНИКЕ ===\n${parts.join('\n')}`);
  }

  // 6. Семантически релевантные воспоминания
  if (semanticMemories && semanticMemories.length > 0) {
    const lines = semanticMemories.map(m => {
      const date = m.ts ? new Date(m.ts).toLocaleDateString('ru-RU') : '';
      return `- (${date}) ${m.content}`;
    });
    sections.push(`=== РЕЛЕВАНТНЫЕ ВОСПОМИНАНИЯ ===\n${lines.join('\n')}\nИспользуй их если уместно, не пересказывай специально.`);
  }

  // 7. Результаты веб-поиска
  if (searchContext) {
    sections.push(`=== ВЕБ-ПОИСК ===\n${searchContext}\n\nИспользуй эту информацию для ответа. Не копируй дословно — пересказывай в своём стиле.`);
  }

  return sections.join('\n\n');
}

module.exports = { buildSystemPrompt };
