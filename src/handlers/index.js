const config = require('../config');
const usersRepo = require('../db/repo/users');
const chatsRepo = require('../db/repo/chats');
const { isMentioned } = require('../utils/triggers');
const { enqueue } = require('../utils/queue');
const { handleText } = require('./text');
const { handlePhoto } = require('./photo');
const { handleVoice } = require('./voice');
const { handleAudio } = require('./audio');
const { handleCommand } = require('./commands');
const { handleCallback } = require('./callback');

let botMeta = { id: null, username: null };

async function init(bot) {
  const me = await bot.getMe();
  botMeta.id = me.id;
  botMeta.username = me.username;
  console.log(`[BOT] @${me.username} id=${me.id}`);
  return botMeta;
}

async function dispatch(bot, msg) {
  const chatId = msg.chat.id;
  enqueue(chatId, () => _process(bot, msg));
}

async function _process(bot, msg) {
  const chatId = msg.chat.id;
  const isPrivate = msg.chat.type === 'private';
  const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup';

  // Системные события — joined/left/etc
  if (msg.new_chat_members || msg.left_chat_member || msg.group_chat_created) {
    return handleSystemEvent(bot, msg);
  }

  // Базовая запись чата
  await chatsRepo.upsertChat(chatId, msg.chat.title || (msg.chat.first_name || 'private'), msg.chat.type);

  // Бан
  if (config.banEnabled && msg.from?.id && await chatsRepo.isBanned(msg.from.id)) {
    return;
  }

  // Mute
  if (await chatsRepo.isMuted(chatId, msg.message_thread_id)) {
    return;
  }

  // Сообщения от других ботов — не отвечаем, но логируем
  if (msg.from?.is_bot && msg.from.id !== botMeta.id) {
    return;
  }

  // Регистрация юзера
  if (msg.from?.id) {
    const uname = msg.from.username ? `@${msg.from.username}` : (msg.from.first_name || 'Анон');
    await usersRepo.upsertUser(msg.from.id, msg.from.username, msg.from.first_name);
    await usersRepo.trackChatUser(chatId, msg.from.id, uname);
  }

  // ЛС: опционально только для админа
  if (isPrivate && config.privateChatAdminOnly && msg.from?.id !== config.adminId) {
    return;
  }

  // Команды (приоритет)
  if (msg.text && msg.text.startsWith('/')) {
    const handled = await handleCommand(bot, msg);
    if (handled) return;
  }

  // Фото
  if (msg.photo && msg.photo.length > 0) {
    if (shouldRespond(msg, isGroup)) {
      return handlePhoto(bot, msg);
    }
    return;
  }

  // Голосовое / video_note
  if (msg.voice || msg.video_note) {
    return handleVoice(bot, msg);
  }

  // Аудио / музыкальный документ
  if (msg.audio || (msg.document && /audio|mpeg|ogg|wav|mp3|flac|m4a/i.test(msg.document.mime_type || ''))) {
    return handleAudio(bot, msg);
  }

  // Стикер — пока без реакции
  if (msg.sticker) {
    return;
  }

  // Текст
  const text = msg.text || msg.caption || '';
  if (!text) return;

  if (!shouldRespond(msg, isGroup)) {
    // в группе без упоминания — просто сохраняем в историю для контекста
    const messagesRepo = require('../db/repo/messages');
    await messagesRepo.addMessage(chatId, 'user', text, {
      userId: msg.from?.id,
      username: msg.from?.first_name || 'Гость',
      messageId: msg.message_id,
    });
    return;
  }

  return handleText(bot, msg);
}

function shouldRespond(msg, isGroup) {
  if (!isGroup) return true;
  const text = msg.text || msg.caption || '';
  const isReplyToMe = msg.reply_to_message?.from?.id === botMeta.id;
  if (isReplyToMe) return true;
  return isMentioned(text, botMeta.username);
}

async function handleSystemEvent(bot, msg) {
  if (!msg.new_chat_members) return;
  const addedMe = msg.new_chat_members.some(m => m.id === botMeta.id);
  if (!addedMe) return;

  // Проверка: админ должен быть в чате
  if (config.adminMustBeInGroup && config.adminId) {
    try {
      const member = await bot.getChatMember(msg.chat.id, config.adminId);
      if (!member || ['left', 'kicked'].includes(member.status)) {
        await bot.sendMessage(msg.chat.id, 'Без знакомого здесь не остаюсь. Ухожу.').catch(() => {});
        await bot.leaveChat(msg.chat.id).catch(() => {});
        return;
      }
    } catch (err) {
      await bot.leaveChat(msg.chat.id).catch(() => {});
      return;
    }
  }
  await bot.sendMessage(msg.chat.id, `Я здесь. Зови: ${config.botTriggers.slice(0, 2).join(' / ')}.`).catch(() => {});
}

module.exports = { init, dispatch, handleCallback };
