const fs = require('fs');
const path = require('path');
const config = require('./config');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PROFILES_FILE = path.join(DATA_DIR, 'profiles.json');
const USERMEMORY_FILE = path.join(DATA_DIR, 'usermemory.json');
const CHATMEMORY_FILE = path.join(DATA_DIR, 'chatmemory.json');

// Убедимся что папка существует
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Загружаем данные
let db = loadJSON(DB_FILE, { chats: {} });
let profiles = loadJSON(PROFILES_FILE, {});
let userMemory = loadJSON(USERMEMORY_FILE, {});
let chatMemory = loadJSON(CHATMEMORY_FILE, {});

let saveTimer = null;
let profilesSaveTimer = null;
let userMemorySaveTimer = null;
let chatMemorySaveTimer = null;

// Очередь обновлений профилей — предотвращает race condition при одновременных обновлениях
let profileUpdateQueue = Promise.resolve();

function loadJSON(file, defaultVal) {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch (err) {
    console.error(`Ошибка загрузки ${file}:`, err.message);
  }
  return defaultVal;
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => _saveDB(), 5000);
}

function scheduleProfilesSave() {
  if (profilesSaveTimer) clearTimeout(profilesSaveTimer);
  profilesSaveTimer = setTimeout(() => _saveProfiles(), 5000);
}

function scheduleUserMemorySave() {
  if (userMemorySaveTimer) clearTimeout(userMemorySaveTimer);
  userMemorySaveTimer = setTimeout(() => _saveUserMemory(), 5000);
}

function scheduleChatMemorySave() {
  if (chatMemorySaveTimer) clearTimeout(chatMemorySaveTimer);
  chatMemorySaveTimer = setTimeout(() => _saveChatMemory(), 5000);
}

function _saveDB() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  } catch (err) {
    console.error('Ошибка сохранения DB:', err.message);
  }
}

function _saveProfiles() {
  try {
    fs.writeFileSync(PROFILES_FILE, JSON.stringify(profiles, null, 2));
  } catch (err) {
    console.error('Ошибка сохранения Profiles:', err.message);
  }
}

function _saveUserMemory() {
  try {
    fs.writeFileSync(USERMEMORY_FILE, JSON.stringify(userMemory, null, 2));
  } catch (err) {
    console.error('Ошибка сохранения UserMemory:', err.message);
  }
}

function _saveChatMemory() {
  try {
    fs.writeFileSync(CHATMEMORY_FILE, JSON.stringify(chatMemory, null, 2));
  } catch (err) {
    console.error('Ошибка сохранения ChatMemory:', err.message);
  }
}

// Принудительное сохранение при выходе — сбрасываем отложенные таймеры
function forceSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
    _saveDB();
  }
  if (profilesSaveTimer) {
    clearTimeout(profilesSaveTimer);
    profilesSaveTimer = null;
    _saveProfiles();
  }
  if (userMemorySaveTimer) {
    clearTimeout(userMemorySaveTimer);
    userMemorySaveTimer = null;
    _saveUserMemory();
  }
  if (chatMemorySaveTimer) {
    clearTimeout(chatMemorySaveTimer);
    chatMemorySaveTimer = null;
    _saveChatMemory();
  }
}

// ================= ИСТОРИЯ СООБЩЕНИЙ =================

function addMessage(chatId, message) {
  const id = String(chatId);
  if (!db.chats[id]) db.chats[id] = { history: [], lastTs: 0 };

  db.chats[id].history.push(message);
  db.chats[id].lastTs = Date.now();

  // Обрезаем историю
  if (db.chats[id].history.length > config.HISTORY_LIMIT) {
    db.chats[id].history = db.chats[id].history.slice(-config.HISTORY_LIMIT);
  }

  scheduleSave();
}

function getHistory(chatId) {
  return db.chats[String(chatId)]?.history || [];
}

// Время последнего сообщения (для auto-revive)
function updateLastMessageTime(chatId) {
  const id = String(chatId);
  if (!db.chats[id]) db.chats[id] = { history: [], lastTs: 0 };
  db.chats[id].lastTs = Date.now();
  scheduleSave();
}

// ================= МУТ ЧАТА/ТОПИКА =================

function isTopicMuted(chatId, threadId) {
  const id = String(chatId);
  const tid = String(threadId === null || threadId === undefined ? 'general' : threadId);
  return (db.chats[id]?.mutedTopics || []).some(t => String(t) === tid);
}

function toggleMute(chatId, threadId) {
  const id = String(chatId);
  const tid = String(threadId === null || threadId === undefined ? 'general' : threadId);
  if (!db.chats[id]) db.chats[id] = { history: [], lastTs: 0 };
  if (!db.chats[id].mutedTopics) db.chats[id].mutedTopics = [];

  const index = db.chats[id].mutedTopics.findIndex(t => String(t) === tid);
  if (index > -1) {
    db.chats[id].mutedTopics.splice(index, 1);
    scheduleSave();
    return false; // Размьючено
  } else {
    db.chats[id].mutedTopics.push(tid);
    scheduleSave();
    return true; // Замьючено
  }
}

// ================= AUTO-REVIVE =================

function setAutoRevive(chatId, enabled) {
  const id = String(chatId);
  if (!db.chats[id]) db.chats[id] = { history: [], lastTs: 0 };
  db.chats[id].autoReviveEnabled = !!enabled;
  scheduleSave();
}

function getInactiveChats(thresholdMs) {
  const now = Date.now();
  const result = [];
  for (const [chatId, chat] of Object.entries(db.chats)) {
    if (!chat.autoReviveEnabled) continue;
    if (!chat.lastTs) continue;
    if (chat.mutedTopics && chat.mutedTopics.some(t => String(t) === 'general')) continue;
    if (now - chat.lastTs >= thresholdMs) result.push(chatId);
  }
  return result;
}

// ================= ЧАТ МЕТА-ДАННЫЕ =================

function hasChat(chatId) {
  return !!db.chats[String(chatId)];
}

function updateChatName(chatId, name) {
  const id = String(chatId);
  if (!db.chats[id]) db.chats[id] = { history: [], lastTs: 0 };
  if (db.chats[id].chatName !== name) {
    db.chats[id].chatName = name;
    scheduleSave();
  }
}

function getChatName(chatId) {
  return db.chats[String(chatId)]?.chatName || null;
}

// ================= ПРОФИЛИ ПОЛЬЗОВАТЕЛЕЙ =================

function getProfile(chatId, userId) {
  const cid = String(chatId);
  const uid = String(userId);
  if (!profiles[cid]) profiles[cid] = {};
  const p = profiles[cid][uid];
  if (!p) return { facts: [], attitude: 'нейтральное' };
  return p;
}

// Batch-обновление профилей (после анализа пачки сообщений)
// Через очередь — предотвращаем race condition
function bulkUpdateProfiles(chatId, updatesMap) {
  profileUpdateQueue = profileUpdateQueue.then(() => {
    _applyProfileUpdates(chatId, updatesMap);
  }).catch(err => {
    console.error('[PROFILE UPDATE ERROR]', err.message);
  });
}

function _applyProfileUpdates(chatId, updatesMap) {
  const cid = String(chatId);
  if (!profiles[cid]) profiles[cid] = {};

  for (const [userId, data] of Object.entries(updatesMap)) {
    const uid = String(userId);
    const current = profiles[cid][uid] || { facts: [], attitude: 'нейтральное' };

    // Обновляем факты (не дублируем)
    if (data.facts?.length) {
      const existing = new Set(current.facts || []);
      data.facts.forEach(f => existing.add(f));
      current.facts = [...existing].slice(-20);
    }

    if (data.attitude) current.attitude = data.attitude;

    profiles[cid][uid] = current;
  }

  scheduleProfilesSave();
}

// Одиночное обновление профиля
function updateProfile(chatId, userId, update) {
  bulkUpdateProfiles(chatId, { [userId]: update });
}

// ================= ГЛОБАЛЬНАЯ ПАМЯТЬ О ПОЛЬЗОВАТЕЛЯХ =================

function getUserMemory(userId) {
  const uid = String(userId);
  return userMemory[uid]?.summary || '';
}

function getUserMemoryFull(userId) {
  const uid = String(userId);
  return userMemory[uid] || null;
}

function setUserMemory(userId, summary) {
  const uid = String(userId);
  if (!userMemory[uid]) {
    userMemory[uid] = {};
  }
  userMemory[uid].summary = summary.substring(0, 5000);
  userMemory[uid].updatedAt = Date.now();
  scheduleUserMemorySave();
}

// Обновить мета-данные пользователя (имя, юзернейм, чаты)
function trackUserGlobal(userId, name, username, chatId, chatName) {
  const uid = String(userId);
  const cid = String(chatId);

  if (!userMemory[uid]) {
    userMemory[uid] = { summary: '', updatedAt: Date.now() };
  }

  let changed = false;

  if (name && userMemory[uid].name !== name) {
    userMemory[uid].name = name;
    changed = true;
  }
  if (username && userMemory[uid].username !== username) {
    userMemory[uid].username = username;
    changed = true;
  }

  if (!userMemory[uid].chats) userMemory[uid].chats = {};
  if (chatName && userMemory[uid].chats[cid] !== chatName) {
    userMemory[uid].chats[cid] = chatName;
    changed = true;
  }

  if (changed) {
    scheduleUserMemorySave();
  }
}

// Получить список всех пользователей для архивации
function getAllUserIds() {
  return Object.keys(userMemory);
}

// ================= ПАМЯТЬ ЧАТА (темы, ежедневный буфер, архив) =================

function _ensureChatMemory(chatId) {
  const id = String(chatId);
  if (!chatMemory[id]) {
    chatMemory[id] = {
      topics: '',
      dailyBuffer: [],
      archive: [],
      updatedAt: 0,
    };
  }
  return chatMemory[id];
}

// Добавить сообщение в ежедневный буфер (для анализа контекста и архивации)
function addToDailyBuffer(chatId, msg) {
  const mem = _ensureChatMemory(chatId);
  mem.dailyBuffer.push({
    name: msg.name || 'Пользователь',
    userId: msg.userId,
    text: msg.text,
    ts: msg.ts || Date.now(),
  });
  // Лимит буфера — 500 сообщений на день
  if (mem.dailyBuffer.length > 500) {
    mem.dailyBuffer = mem.dailyBuffer.slice(-500);
  }
  scheduleChatMemorySave();
}

function getDailyBuffer(chatId) {
  return chatMemory[String(chatId)]?.dailyBuffer || [];
}

function getChatTopics(chatId) {
  return chatMemory[String(chatId)]?.topics || '';
}

function updateChatTopics(chatId, topics) {
  const mem = _ensureChatMemory(chatId);
  mem.topics = topics.substring(0, 3000);
  mem.updatedAt = Date.now();
  scheduleChatMemorySave();
}

function getChatArchive(chatId, limit = 7) {
  const archive = chatMemory[String(chatId)]?.archive || [];
  return archive.slice(-limit);
}

// Архивировать день: сохранить сводку, очистить буфер
function archiveDay(chatId, dateSummary, dateStr) {
  const mem = _ensureChatMemory(chatId);

  mem.archive.push({
    date: dateStr,
    summary: dateSummary.substring(0, 2000),
  });

  // Хранить архив за последние 30 дней
  if (mem.archive.length > 30) {
    mem.archive = mem.archive.slice(-30);
  }

  // Очистить дневной буфер
  mem.dailyBuffer = [];
  mem.updatedAt = Date.now();
  scheduleChatMemorySave();
}

// Получить все chatId у которых есть дневной буфер
function getChatsWithBuffer() {
  const result = [];
  for (const [chatId, mem] of Object.entries(chatMemory)) {
    if (mem.dailyBuffer && mem.dailyBuffer.length > 0) {
      result.push(chatId);
    }
  }
  return result;
}

// Получить все chatId
function getAllChatIds() {
  return Object.keys(db.chats);
}

// ================= ОТСЛЕЖИВАНИЕ ЮЗЕРОВ В ЧАТЕ =================

function trackUser(chatId, user) {
  if (user.is_bot) return;
  const id = String(chatId);
  if (!db.chats[id]) db.chats[id] = { history: [], lastTs: 0 };
  if (!db.chats[id].users) db.chats[id].users = {};
  const name = user.username ? `@${user.username}` : (user.first_name || 'Анон');
  if (db.chats[id].users[user.id] !== name) {
    db.chats[id].users[user.id] = name;
    scheduleSave();
  }
}

function getRandomUser(chatId) {
  const id = String(chatId);
  const users = db.chats[id]?.users || {};
  const ids = Object.keys(users);
  if (ids.length === 0) return null;
  return users[ids[Math.floor(Math.random() * ids.length)]];
}

// Поиск профиля по нику или имени
function findProfileByQuery(chatId, query) {
  const id = String(chatId);
  const q = query.toLowerCase().replace('@', '');
  const users = db.chats[id]?.users || {};

  // Ищем по нику
  for (const [uid, uName] of Object.entries(users)) {
    if (String(uName).toLowerCase().includes(q)) {
      return { ...getProfile(chatId, uid), username: uName };
    }
  }
  // Ищем по realName в профилях
  if (profiles[id]) {
    for (const [uid, p] of Object.entries(profiles[id])) {
      if (p.realName && p.realName.toLowerCase().includes(q)) {
        return { ...p, username: users[uid] || 'Unknown' };
      }
    }
  }
  return null;
}

// ================= ПРОФИЛЬ ЧАТА =================

function getChatProfile(chatId) {
  const id = String(chatId);
  if (!db.chats[id]?.chatProfile) return { topic: null, facts: null, style: null };
  return db.chats[id].chatProfile;
}

function updateChatProfile(chatId, updates) {
  const id = String(chatId);
  if (!db.chats[id]) db.chats[id] = { history: [], lastTs: 0 };
  if (!db.chats[id].chatProfile) db.chats[id].chatProfile = { topic: null, facts: null, style: null };
  const p = db.chats[id].chatProfile;
  if (updates.topic) p.topic = updates.topic.substring(0, 300);
  if (updates.facts) p.facts = updates.facts.substring(0, 1000);
  if (updates.style) p.style = updates.style;
  scheduleSave();
}

// ================= EXPORTS =================

module.exports = {
  // История
  addMessage,
  getHistory,
  updateLastMessageTime,

  // Мут
  isTopicMuted,
  toggleMute,

  // Auto-revive
  setAutoRevive,
  getInactiveChats,

  // Чат мета
  hasChat,
  updateChatName,
  getChatName,

  // Профили
  getProfile,
  updateProfile,
  bulkUpdateProfiles,

  // Глобальная память пользователей
  getUserMemory,
  getUserMemoryFull,
  setUserMemory,
  trackUserGlobal,
  getAllUserIds,

  // Память чата (темы, буфер, архив)
  addToDailyBuffer,
  getDailyBuffer,
  getChatTopics,
  updateChatTopics,
  getChatArchive,
  archiveDay,
  getChatsWithBuffer,
  getAllChatIds,

  // Юзеры в чате
  trackUser,
  getRandomUser,
  findProfileByQuery,

  // Профиль чата
  getChatProfile,
  updateChatProfile,

  // Сохранение
  forceSave,
};
