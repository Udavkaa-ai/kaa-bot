const claude = require('../providers/claude');
const usersRepo = require('../db/repo/users');
const { remember } = require('./semantic');

const profileQueue = new Map(); // chatId -> Promise chain

function enqueue(chatId, fn) {
  const prev = profileQueue.get(chatId) || Promise.resolve();
  const next = prev.then(fn).catch(err => {
    console.error('[PROFILE QUEUE]', err.message);
  });
  profileQueue.set(chatId, next);
}

// Обновление профиля юзера после ответа бота
async function reflectImmediate(chatId, userId, username, userText, botResponse) {
  const profile = await usersRepo.getProfile(chatId, userId);

  const system = `Ты анализируешь короткий обмен сообщениями и обновляешь досье на собеседника.
Возвращай только JSON.

Текущее досье на ${username}:
- realName: ${profile.real_name || 'неизвестно'}
- location: ${profile.location || 'неизвестно'}
- facts: ${profile.facts || 'пусто'}
- relationship (0-100): ${profile.relationship}
- attitude: ${profile.attitude}

Правила:
- relationship меняется МЕДЛЕННО: +1 за обычное общение, +2 за вежливость, +3 максимум за искреннюю похвалу. -5 за грубость к боту, -10 максимум за оскорбление. НЕ снижай за ругань с другими людьми.
- facts: накапливай (новые добавляй к старым, не теряй). Максимум 1500 символов суммарно.
- realName: только если юзер прямо сказал "меня зовут X" или "я X".
- location: только если упомянул город/страну.
- attitude: одно слово (дружелюбное, нейтральное, холодное, враждебное, тёплое).

Формат:
{"realName": "...", "location": "...", "facts": "...", "attitude": "...", "relationship": число, "newFact": "одна короткая фраза про новое если есть, иначе null"}`;

  const userPrompt = `${username}: "${userText}"\nБот ответил: "${botResponse}"\n\nОбнови досье.`;

  try {
    const update = await claude.askJson({ system, userText: userPrompt, opts: { temperature: 0.2, maxTokens: 600 } });
    if (!update) return;

    await usersRepo.upsertProfile(chatId, userId, update);

    if (update.newFact && update.newFact !== 'null' && update.newFact.length > 5) {
      await remember({
        chatId, userId,
        content: `${username}: ${update.newFact}`,
        kind: 'user_fact', importance: 0.7,
      });
    }
  } catch (err) {
    console.warn('[PROFILE] reflect failed:', err.message);
  }
}

function reflectAsync(chatId, userId, username, userText, botResponse) {
  enqueue(chatId, () => reflectImmediate(chatId, userId, username, userText, botResponse));
}

// Batch анализ — каждые N сообщений по всем участникам
async function batchAnalyze(chatId, recentMessages) {
  if (recentMessages.length < 5) return;

  const byUser = new Map();
  for (const m of recentMessages) {
    if (m.role !== 'user' || !m.user_id) continue;
    if (!byUser.has(m.user_id)) {
      byUser.set(m.user_id, { username: m.username || 'юзер', lines: [] });
    }
    byUser.get(m.user_id).lines.push(m.text);
  }

  if (byUser.size === 0) return;

  const currentProfiles = await usersRepo.getProfiles(chatId, [...byUser.keys()]);
  const knownInfo = [...byUser.entries()].map(([uid, u]) => {
    const p = currentProfiles[uid];
    if (!p) return `${u.username} (id ${uid}): нет данных`;
    return `${u.username} (id ${uid}): realName=${p.real_name || '?'}, location=${p.location || '?'}, relationship=${p.relationship}, facts="${p.facts || '?'}"`;
  }).join('\n');

  const chatLog = [...byUser.entries()].map(([uid, u]) =>
    `=== ${u.username} (id ${uid}) ===\n${u.lines.join('\n')}`
  ).join('\n\n');

  const system = `Ты — архивариус досье. Сохраняешь и обогащаешь данные о собеседниках. НЕ ТЕРЯЙ старые факты.

Текущие досье:
${knownInfo}

Правила:
- Старые факты сохраняй ДОБАВЛЯЯ новые. Если суммарно >1500 символов — сжимай по сути.
- relationship: меняй медленно. +1..+3 за позитив к боту, -5..-10 за негатив К БОТУ (не к другим).
- realName, location — только если явно упомянуто.

Верни JSON-объект где ключ = userId (строка), значение = {realName, location, facts, attitude, relationship}.`;

  try {
    const result = await claude.askJson({
      system,
      userText: `Новый лог:\n\n${chatLog}\n\nОбнови досье.`,
      opts: { temperature: 0.3, maxTokens: 1200 },
    });
    if (!result || typeof result !== 'object') return;

    for (const [uid, patch] of Object.entries(result)) {
      if (!patch || typeof patch !== 'object') continue;
      await usersRepo.upsertProfile(chatId, parseInt(uid, 10), patch);
    }
  } catch (err) {
    console.warn('[PROFILE] batch failed:', err.message);
  }
}

function batchAnalyzeAsync(chatId, recentMessages) {
  enqueue(chatId, () => batchAnalyze(chatId, recentMessages));
}

// Обновление профиля чата (тема, факты, стиль) — реже
async function updateChatTopic(chatId, recentMessages) {
  if (recentMessages.length < 10) return;

  const chatsRepo = require('../db/repo/chats');
  const current = await chatsRepo.getChat(chatId);

  const transcript = recentMessages
    .map(m => `${m.username || (m.role === 'assistant' ? 'бот' : 'юзер')}: ${m.text || ''}`)
    .filter(line => line.length > 5)
    .join('\n')
    .slice(0, 6000);

  const system = `Аналитик контекста чатов.

Текущий профиль чата:
- Тема: ${current?.chat_topic || 'не определена'}
- Факты: ${current?.chat_facts || 'нет'}
- Стиль: ${current?.chat_style || '?'}

Уточни, не меняй кардинально. Тема ≤200 символов, факты ≤500. Стиль: formal/informal/tech/mixed/family/work.
Верни JSON: {"topic": "...", "facts": "...", "style": "..."}`;

  try {
    const result = await claude.askJson({ system, userText: `Лог чата:\n${transcript}`, opts: { temperature: 0.3, maxTokens: 600 } });
    if (!result) return;
    await chatsRepo.updateChatTopic(
      chatId,
      (result.topic || current?.chat_topic || '').slice(0, 200),
      (result.facts || current?.chat_facts || '').slice(0, 500),
      result.style || current?.chat_style || null
    );
  } catch (err) {
    console.warn('[CHAT-PROFILE]', err.message);
  }
}

function updateChatTopicAsync(chatId, recentMessages) {
  enqueue(chatId, () => updateChatTopic(chatId, recentMessages));
}

module.exports = {
  reflectAsync,
  batchAnalyzeAsync,
  updateChatTopicAsync,
};
