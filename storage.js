const fs = require('fs');
const path = require('path');
const config = require('./config');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PROFILES_FILE = path.join(DATA_DIR, 'profiles.json');

// Убедимся что папка существует
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Загружаем данные
let db = loadJSON(DB_FILE, { chats: {} });
let profiles = loadJSON(PROFILES_FILE, {});

let saveTimer = null;
let profilesSaveTimer = null;

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
}

// История сообщений
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

// Мут чата/топика
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

// Auto-revive
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

// Уведомление о новом чате (для проверки в handler)
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

// Профили пользователей
function getProfile(chatId, userId) {
  const cid = String(chatId);
  const uid = String(userId);
  if (!profiles[cid]) profiles[cid] = {};
  const p = profiles[cid][uid];
  if (!p) return { facts: [], attitude: 'нейтральное', relationship: 50 };
  // Миграция: если relationship не задан — ставим 50
  if (typeof p.relationship === 'undefined') p.relationship = 50;
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
    const current = profiles[cid][uid] || { facts: [], attitude: 'нейтральное', relationship: 50 };

    // Обновляем факты (не дублируем)
    if (data.facts?.length) {
      const existing = new Set(current.facts || []);
      data.facts.forEach(f => existing.add(f));
      current.facts = [...existing].slice(-20);
    }

    if (data.attitude) current.attitude = data.attitude;

    // Репутация: плавное изменение с ограничениями
    if (data.relationship !== undefined) {
      const newScore = parseInt(data.relationship, 10);
      if (!isNaN(newScore)) {
        const oldScore = current.relationship || 50;
        let delta = newScore - oldScore;
        // Ограничиваем: максимум +3 за позитив, -5..-10 за негатив
        if (delta > 0) delta = Math.min(delta, 3);
        else if (delta < 0) {
          delta = Math.max(delta, -10);
          if (delta > -5) delta = -5;
        }
        current.relationship = Math.max(0, Math.min(100, oldScore + delta));
      }
    }

    profiles[cid][uid] = current;
  }

  scheduleProfilesSave();
}

// Одиночное обновление профиля (для совместимости с текущим кодом)
function updateProfile(chatId, userId, update) {
  bulkUpdateProfiles(chatId, { [userId]: update });
}

module.exports = {
  addMessage,
  getHistory,
  getProfile,
  updateProfile,
  bulkUpdateProfiles,
  updateLastMessageTime,
  isTopicMuted,
  toggleMute,
  setAutoRevive,
  getInactiveChats,
  hasChat,
  updateChatName,
  forceSave,
};

// Отслеживание юзеров в чате (для "кто из нас" и поиска по нику)
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

// Профиль чата
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

module.exports.trackUser = trackUser;
module.exports.getRandomUser = getRandomUser;
module.exports.findProfileByQuery = findProfileByQuery;
module.exports.getChatProfile = getChatProfile;
module.exports.updateChatProfile = updateChatProfile;
