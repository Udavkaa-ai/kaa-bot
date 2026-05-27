const { safeEmbed } = require('./embed');
const messagesRepo = require('../db/repo/messages');
const config = require('../config');

async function recall({ chatId, userId, queryText, k }) {
  const emb = await safeEmbed(queryText);
  if (!emb) return [];
  const memories = await messagesRepo.recallMemories({
    chatId, userId, queryEmbedding: emb, k: k || config.semanticRecallK,
  });
  return memories;
}

async function remember({ chatId, userId, content, kind, importance }) {
  if (!content || content.length < 5) return;
  const emb = await safeEmbed(content);
  await messagesRepo.addMemory({
    chatId, userId, content, kind: kind || 'fact',
    importance: importance ?? 0.5, embedding: emb,
  });
}

function formatRecall(memories) {
  if (!memories || memories.length === 0) return '';
  const lines = memories.map(m => {
    const date = m.ts ? new Date(m.ts).toLocaleDateString('ru-RU') : '';
    return `- (${date}, ${m.kind}) ${m.content}`;
  });
  return lines.join('\n');
}

module.exports = { recall, remember, formatRecall };
