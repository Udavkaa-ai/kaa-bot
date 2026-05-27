const config = require('../config');
const usersRepo = require('../db/repo/users');
const chatsRepo = require('../db/repo/chats');
const messagesRepo = require('../db/repo/messages');
const statsRepo = require('../db/repo/stats');
const claude = require('../providers/claude');
const pollinations = require('../providers/pollinations');
const { sendPersonaMenu } = require('./persona');
const { sendSafe } = require('../utils/telegram');
const { withTyping } = require('../utils/typing');
const { humorReply } = require('../ai/errorHumor');

function isAdmin(msg) {
  return config.adminId && msg.from?.id === config.adminId;
}

async function handleCommand(bot, msg) {
  const text = (msg.text || '').trim();
  if (!text.startsWith('/')) return false;
  const [cmdRaw, ...args] = text.split(/\s+/);
  const cmd = cmdRaw.split('@')[0].toLowerCase();
  const chatId = msg.chat.id;

  switch (cmd) {
    case '/start':
      await sendSafe(bot, chatId,
        `Привет. Я — ${config.botName}.\nПиши мне в личку или упоминай в чате словами: ${config.botTriggers.join(', ')}.\nКоманды: /help`,
        { reply_to_message_id: msg.message_id });
      return true;

    case '/help':
      await sendSafe(bot, chatId, buildHelp(), { reply_to_message_id: msg.message_id });
      return true;

    case '/persona':
      await sendPersonaMenu(bot, chatId, msg.message_id);
      return true;

    case '/mute':
      const muted = await chatsRepo.toggleMute(chatId, msg.message_thread_id);
      await sendSafe(bot, chatId, muted ? 'Замолчал.' : 'Снова с вами.', { reply_to_message_id: msg.message_id });
      return true;

    case '/revive_on':
      await chatsRepo.setAutoRevive(chatId, true);
      await sendSafe(bot, chatId, 'Буду оживлять чат если тишина.', { reply_to_message_id: msg.message_id });
      return true;

    case '/revive_off':
      await chatsRepo.setAutoRevive(chatId, false);
      await sendSafe(bot, chatId, 'Молчание не нарушу.', { reply_to_message_id: msg.message_id });
      return true;

    case '/recap':
    case '/пересказ':
      return handleRecap(bot, msg, args);

    case '/draw':
    case '/нарисуй':
      return handleDraw(bot, msg, args);

    case '/profile':
    case '/досье':
      return handleProfile(bot, msg, args);

    case '/stats':
      if (!isAdmin(msg)) return true;
      return handleStats(bot, msg);

    case '/ban':
      if (!isAdmin(msg)) return true;
      return handleBan(bot, msg, args, true);

    case '/unban':
      if (!isAdmin(msg)) return true;
      return handleBan(bot, msg, args, false);

    case '/banned':
      if (!isAdmin(msg)) return true;
      return handleBanned(bot, msg);
  }
  return false;
}

function buildHelp() {
  const modules = [];
  if (config.visionEnabled) modules.push('👁 Распознавание картинок');
  if (config.voiceEnabled) modules.push('🎙 Голосовые сообщения');
  if (config.audioEnabled) modules.push('🎵 Понимание музыки и звуков');
  if (config.searchEnabled) modules.push('🔍 Веб-поиск');
  if (config.imagesEnabled) modules.push('🎨 Генерация картинок: /draw <prompt>');
  if (config.autoReviveEnabled) modules.push('💬 Авто-оживление чата');
  return [
    `Я — ${config.botName}, версия ${config.version}.`,
    `Триггеры: ${config.botTriggers.join(', ')}`,
    '',
    'Команды:',
    '/persona — выбрать с кем поговорить сегодня',
    '/recap [N] — пересказ чата за последние N часов (по умолчанию 6)',
    '/mute — заткнуть/расткнуть',
    '/profile <ник> — досье на участника',
    config.imagesEnabled ? '/draw <описание> — нарисую' : null,
    '',
    modules.length ? 'Активно:\n' + modules.join('\n') : null,
  ].filter(Boolean).join('\n');
}

async function handleRecap(bot, msg, args) {
  const chatId = msg.chat.id;
  const hoursMatch = (args.join(' ').match(/(\d+)/) || [])[1];
  const hours = Math.min(parseInt(hoursMatch || '6', 10), 48);
  try {
    const recent = await messagesRepo.getRecentSince(chatId, hours);
    if (recent.length < 3) {
      await sendSafe(bot, chatId, 'Тишина была. Нечего пересказывать.', { reply_to_message_id: msg.message_id });
      return true;
    }
    const transcript = recent
      .map(m => `[${m.role === 'user' ? (m.username || 'юзер') : 'бот'}] ${m.text || ''}`)
      .filter(line => line.length > 5)
      .join('\n')
      .slice(0, 10000);

    const result = await withTyping(bot, chatId, () =>
      claude.callWithFallback(
        [
          { role: 'system', content: `Краткий пересказ чата за последние ${hours} ч. Темы, события, эмоциональные моменты. 5-10 предложений. Без воды.` },
          { role: 'user', content: transcript },
        ],
        { temperature: 0.4, maxTokens: 600 }
      )
    );
    const text = result?.text || 'Не получилось пересказать.';
    await sendSafe(bot, chatId, text, { reply_to_message_id: msg.message_id });
  } catch (err) {
    console.error('[RECAP]', err.message);
    await sendSafe(bot, chatId, humorReply(err), { reply_to_message_id: msg.message_id });
  }
  return true;
}

async function handleDraw(bot, msg, args) {
  const chatId = msg.chat.id;
  if (!config.imagesEnabled) {
    await sendSafe(bot, chatId, 'Картинки выключены.', { reply_to_message_id: msg.message_id });
    return true;
  }
  const prompt = args.join(' ').trim();
  if (!prompt) {
    await sendSafe(bot, chatId, 'Опиши что нарисовать. Пример: /draw питон в очках на ноутбуке', { reply_to_message_id: msg.message_id });
    return true;
  }
  try {
    // Переводим промпт на английский через Claude для лучшего качества
    const translated = await claude.callWithFallback(
      [
        { role: 'system', content: 'Переведи на английский описание для генератора картинок. Сделай его выразительным, добавь стилевые детали. Верни ТОЛЬКО английский промпт без пояснений.' },
        { role: 'user', content: prompt },
      ],
      { temperature: 0.5, maxTokens: 200 }
    );
    const enPrompt = translated?.text?.trim() || prompt;

    await bot.sendChatAction(chatId, 'upload_photo').catch(() => {});
    const buf = await pollinations.generateImage(enPrompt);
    await bot.sendPhoto(chatId, buf, { reply_to_message_id: msg.message_id, caption: prompt.slice(0, 200) });
  } catch (err) {
    console.error('[DRAW]', err.message);
    await sendSafe(bot, chatId, 'Не получилось нарисовать. Попробуй другое описание.', { reply_to_message_id: msg.message_id });
  }
  return true;
}

async function handleProfile(bot, msg, args) {
  const chatId = msg.chat.id;
  const q = args.join(' ').trim();
  if (!q) {
    await sendSafe(bot, chatId, 'Кого искать? Пример: /profile @vasya', { reply_to_message_id: msg.message_id });
    return true;
  }
  const profile = await usersRepo.findProfileByQuery(chatId, q);
  if (!profile) {
    await sendSafe(bot, chatId, 'Не нашёл такого в этом чате.', { reply_to_message_id: msg.message_id });
    return true;
  }
  const lines = [
    `Имя: ${profile.display_name || profile.real_name || '?'}`,
    profile.real_name && profile.real_name !== profile.display_name ? `Настоящее имя: ${profile.real_name}` : null,
    profile.location ? `Откуда: ${profile.location}` : null,
    `Репутация: ${profile.relationship ?? 50}/100 (${profile.attitude || 'нейтральное'})`,
    profile.facts ? `Что знаю: ${profile.facts.slice(0, 800)}` : null,
  ].filter(Boolean);
  await sendSafe(bot, chatId, lines.join('\n'), { reply_to_message_id: msg.message_id });
  return true;
}

async function handleStats(bot, msg) {
  const chatId = msg.chat.id;
  const [today, week, allTime] = await Promise.all([
    statsRepo.getToday(),
    statsRepo.getPeriod(7),
    statsRepo.getAllTime(),
  ]);
  const fmt = (rows) => rows.length
    ? rows.map(r => `  ${r.provider}/${r.model}: ${r.count}`).join('\n')
    : '  (нет)';
  const text = [
    'Сегодня:', fmt(today),
    '', 'За неделю:', fmt(week),
    '', 'Всего:', fmt(allTime),
  ].join('\n');
  await sendSafe(bot, chatId, text, { reply_to_message_id: msg.message_id });
  return true;
}

async function handleBan(bot, msg, args, isBan) {
  const chatId = msg.chat.id;
  let targetId = null;
  if (msg.reply_to_message?.from?.id) targetId = msg.reply_to_message.from.id;
  else if (args[0]) {
    const arg = args[0];
    if (/^\d+$/.test(arg)) targetId = parseInt(arg, 10);
    else {
      const row = await usersRepo.findUserIdByUsername(arg);
      if (row) targetId = parseInt(row.user_id, 10);
    }
  }
  if (!targetId) {
    await sendSafe(bot, chatId, 'Кого? Реплай на сообщение или укажи @ник/id.', { reply_to_message_id: msg.message_id });
    return true;
  }
  if (isBan) {
    await chatsRepo.banUser(targetId, args.slice(1).join(' ') || null);
    await sendSafe(bot, chatId, `Забанен: ${targetId}`, { reply_to_message_id: msg.message_id });
  } else {
    await chatsRepo.unbanUser(targetId);
    await sendSafe(bot, chatId, `Разбанен: ${targetId}`, { reply_to_message_id: msg.message_id });
  }
  return true;
}

async function handleBanned(bot, msg) {
  const chatId = msg.chat.id;
  const list = await chatsRepo.listBanned();
  if (list.length === 0) {
    await sendSafe(bot, chatId, 'Никого нет в бан-листе.', { reply_to_message_id: msg.message_id });
    return true;
  }
  const text = list.map(b => `${b.user_id} — ${b.reason || '?'}`).join('\n');
  await sendSafe(bot, chatId, text, { reply_to_message_id: msg.message_id });
  return true;
}

module.exports = { handleCommand };
