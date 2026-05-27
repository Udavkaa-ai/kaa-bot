const claude = require('../providers/claude');
const messagesRepo = require('../db/repo/messages');
const { safeEmbed } = require('./embed');
const { moscowYesterday } = require('../utils/time');

async function createDailySummary(chatId) {
  // Берём все сообщения за вчера (МСК)
  const messages = await messagesRepo.getRecentSince(chatId, 26); // запас по таймзоне
  if (messages.length < 5) return null;

  const yesterday = moscowYesterday();
  // Фильтруем именно вчерашние
  const filtered = messages.filter(m => {
    const d = new Date(m.ts).toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });
    return d === yesterday;
  });
  if (filtered.length < 5) return null;

  const transcript = filtered
    .map(m => `[${m.role === 'user' ? (m.username || 'юзер') : 'бот'}] ${m.text || ''}`)
    .filter(line => line.length > 5)
    .join('\n')
    .slice(0, 12000);

  const system = `Ты — архивариус. Тебе дан лог чата за день. Сделай краткую сводку:
1. О чём говорили (основные темы — 2-4 пункта)
2. Кто что новое о себе сообщил (важные факты о людях)
3. События, договорённости, обещания
4. Заметный конфликт, юмор или эмоциональный момент

Формат: 4-7 предложений, без воды. Сводка читается для контекста бота на следующий день.`;

  try {
    const result = await claude.callWithFallback(
      [
        { role: 'system', content: system },
        { role: 'user', content: `Лог чата за ${yesterday}:\n\n${transcript}` },
      ],
      { temperature: 0.4, maxTokens: 500 }
    );
    if (!result?.text) return null;

    const summary = result.text.trim();
    const emb = await safeEmbed(summary);
    await messagesRepo.addDailySummary(chatId, yesterday, summary, emb);
    return summary;
  } catch (err) {
    console.error(`[ARCHIVE] Чат ${chatId}:`, err.message);
    return null;
  }
}

async function archiveAllChats() {
  const chatIds = await messagesRepo.getChatsWithRecentActivity(2);
  let archived = 0;
  for (const chatId of chatIds) {
    try {
      const result = await createDailySummary(chatId);
      if (result) {
        archived++;
        console.log(`[ARCHIVE] Чат ${chatId}: сводка создана`);
      }
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      console.error(`[ARCHIVE] Чат ${chatId}:`, err.message);
    }
  }
  console.log(`[ARCHIVE] Заархивировано чатов: ${archived}/${chatIds.length}`);
}

module.exports = { createDailySummary, archiveAllChats };
