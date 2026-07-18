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
const giveaway = require('./giveaway');
const quiz = require('./quiz');
const article = require('./article');
const eyeballRepo = require('../db/repo/eyeball');

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

    case '/giveaway':
    case '/розыгрыш':
      await giveaway.handleGiveawayCommand(bot, msg, args.join(' '));
      return true;

    case '/quiz':
    case '/викторина':
      await quiz.handleQuizCommand(bot, msg, args.join(' '));
      return true;

    case '/leaderboard':
    case '/топ':
      await quiz.handleLeaderboard(bot, msg);
      return true;

    case '/sec':
    case '/сечение':
      return handleEyeball(bot, msg, args);

    case '/article':
    case '/статья':
      await article.handleArticleCommand(bot, msg, args.join(' '));
      return true;

    case '/transcribe':
    case '/расшифровка':
    case '/расшифровывать':
      return handleTranscribe(bot, msg, args);

    case '/trigger':
    case '/триггер':
      return handleTrigger(bot, msg, args);

    case '/triggers':
    case '/триггеры':
      return handleShowTriggers(bot, msg);

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
    '/giveaway <приз> [время|до N] [winners=K] — розыгрыш',
    '/quiz [тема] — викторина с вариантами ответа',
    '/leaderboard — топ викторины в этом чате',
    '/sec — Сечение, игра на глазомер. /sec top — топ чата',
    '/article <тема> — написать статью на заданную тему (можно "в стиле: научпоп")',
    '/transcribe on|off — авто-расшифровка голосовых в чат (только админ чата)',
    '/trigger <слова> — задать как меня звать в этом чате (только админ)',
    '/triggers — показать текущие триггеры',
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

async function isChatAdmin(bot, chatId, userId) {
  if (config.adminId && userId === config.adminId) return true;
  try {
    const member = await bot.getChatMember(chatId, userId);
    return member && ['creator', 'administrator'].includes(member.status);
  } catch (_) {
    return false;
  }
}

async function handleTrigger(bot, msg, args) {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;
  const isPrivate = msg.chat.type === 'private';

  if (!isPrivate && !(await isChatAdmin(bot, chatId, userId))) {
    await sendSafe(bot, chatId, 'Триггеры может менять только админ чата.', { reply_to_message_id: msg.message_id });
    return true;
  }

  const arg = args.join(' ').trim();
  if (!arg) {
    await sendSafe(bot, chatId,
      `Текущие триггеры — посмотри /triggers.\n` +
      `Установить: /trigger слово1, слово2, слово3\n` +
      `Сбросить на стандартные: /trigger reset`,
      { reply_to_message_id: msg.message_id });
    return true;
  }

  if (/^(reset|сброс|default|по умолчанию)$/i.test(arg)) {
    await chatsRepo.setTriggers(chatId, null);
    await sendSafe(bot, chatId, `Триггеры сброшены на стандартные: ${config.botTriggers.join(', ')}`,
      { reply_to_message_id: msg.message_id });
    return true;
  }

  const triggers = arg.toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  if (triggers.length === 0 || triggers.some(t => t.length < 2 || t.length > 30)) {
    await sendSafe(bot, chatId, 'Каждый триггер должен быть 2-30 символов. Раздели запятыми.',
      { reply_to_message_id: msg.message_id });
    return true;
  }

  await chatsRepo.setTriggers(chatId, triggers.join(','));
  await sendSafe(bot, chatId, `Теперь зови меня так: ${triggers.join(', ')}`,
    { reply_to_message_id: msg.message_id });
  return true;
}

async function handleShowTriggers(bot, msg) {
  const chatId = msg.chat.id;
  const custom = await chatsRepo.getTriggers(chatId);
  if (custom) {
    await sendSafe(bot, chatId, `В этом чате зови: ${custom.join(', ')}\nСтандартные: ${config.botTriggers.join(', ')}`,
      { reply_to_message_id: msg.message_id });
  } else {
    await sendSafe(bot, chatId, `Триггеры: ${config.botTriggers.join(', ')}\nИзменить: /trigger <слова через запятую>`,
      { reply_to_message_id: msg.message_id });
  }
  return true;
}

async function handleEyeball(bot, msg, args) {
  const chatId = msg.chat.id;
  const sub = (args[0] || '').toLowerCase();

  if (sub === 'top' || sub === 'топ') {
    const top = await eyeballRepo.topByStreak(chatId, 10);
    if (top.length === 0) {
      await sendSafe(bot, chatId, 'В этом чате ещё никто не играл. Команда: /sec', { reply_to_message_id: msg.message_id });
      return true;
    }
    const medals = ['🥇', '🥈', '🥉'];
    const lines = top.map((r, i) => {
      const m = medals[i] || `${i + 1}.`;
      const name = r.username || ('id' + r.user_id);
      const acc = Number(r.best_accuracy).toFixed(1);
      return `${m} ${name} — 🔥 ${r.best_streak} · ${acc}%`;
    });
    await sendSafe(bot, chatId, `Сечение — топ чата:\n\n${lines.join('\n')}`,
      { reply_to_message_id: msg.message_id });
    return true;
  }

  if (!config.botUsername) {
    try {
      const me = await bot.getMe();
      config.botUsername = me.username;
    } catch (_) {}
  }
  if (!config.botUsername) {
    await sendSafe(bot, chatId, 'Не получилось узнать имя бота.', { reply_to_message_id: msg.message_id });
    return true;
  }

  const url = `https://t.me/${config.botUsername}/${config.eyeballAppShortName}?startapp=${chatId}`;
  await bot.sendMessage(chatId,
    'Сечение — проверь глазомер.\nПопадание с точностью ≤5% засчитывается в streak. Лучшая серия за сессию → в топ чата.',
    {
      reply_to_message_id: msg.message_id,
      reply_markup: {
        inline_keyboard: [[
          { text: 'Открыть', url },
        ]],
      },
    });
  return true;
}

async function handleTranscribe(bot, msg, args) {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;
  const isPrivate = msg.chat.type === 'private';

  if (!isPrivate && !(await isChatAdmin(bot, chatId, userId))) {
    await sendSafe(bot, chatId, 'Переключать может только админ чата.',
      { reply_to_message_id: msg.message_id });
    return true;
  }

  const arg = args.join(' ').trim().toLowerCase();
  const current = await chatsRepo.getTranscribeVoice(chatId);

  if (!arg) {
    const state = current ? 'ВКЛючена' : 'ВЫКЛючена';
    await sendSafe(bot, chatId,
      `Автотранскрипция голосовых сейчас ${state}.\nПереключить: /transcribe on или /transcribe off`,
      { reply_to_message_id: msg.message_id });
    return true;
  }

  if (/^(on|вкл|да|yes|1|включи|enable)$/.test(arg)) {
    await chatsRepo.setTranscribeVoice(chatId, true);
    await sendSafe(bot, chatId,
      'Ок. Теперь под каждым голосовым буду постить расшифровку в чат.',
      { reply_to_message_id: msg.message_id });
    return true;
  }

  if (/^(off|выкл|нет|no|0|выключи|disable)$/.test(arg)) {
    await chatsRepo.setTranscribeVoice(chatId, false);
    await sendSafe(bot, chatId, 'Расшифровку в чат отключил.',
      { reply_to_message_id: msg.message_id });
    return true;
  }

  await sendSafe(bot, chatId, 'Не понял. Скажи on или off.',
    { reply_to_message_id: msg.message_id });
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
