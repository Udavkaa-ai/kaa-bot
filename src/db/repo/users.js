const { query } = require('../pool');

async function upsertUser(userId, username, firstName) {
  await query(
    `INSERT INTO users (id, username, first_name, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (id) DO UPDATE SET
       username = EXCLUDED.username,
       first_name = EXCLUDED.first_name,
       updated_at = now()`,
    [userId, username, firstName]
  );
}

async function getUser(userId) {
  const r = await query(`SELECT * FROM users WHERE id = $1`, [userId]);
  return r.rows[0] || null;
}

async function setGlobalMemory(userId, text) {
  await query(
    `UPDATE users SET global_memory = $2, updated_at = now() WHERE id = $1`,
    [userId, text]
  );
}

async function getGlobalMemory(userId) {
  const r = await query(`SELECT global_memory FROM users WHERE id = $1`, [userId]);
  return r.rows[0]?.global_memory || null;
}

async function getUserPersona(userId, chatId) {
  const r = await query(
    `SELECT persona_id, date_assigned FROM user_personas WHERE user_id = $1 AND chat_id = $2`,
    [userId, chatId]
  );
  return r.rows[0] || null;
}

async function setUserPersona(userId, chatId, personaId, dateAssigned) {
  await query(
    `INSERT INTO user_personas (user_id, chat_id, persona_id, date_assigned)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, chat_id) DO UPDATE SET
       persona_id = EXCLUDED.persona_id,
       date_assigned = EXCLUDED.date_assigned`,
    [userId, chatId, personaId, dateAssigned]
  );
}

async function getProfile(chatId, userId) {
  const r = await query(
    `SELECT * FROM profiles WHERE chat_id = $1 AND user_id = $2`,
    [chatId, userId]
  );
  return r.rows[0] || {
    chat_id: chatId,
    user_id: userId,
    real_name: null,
    location: null,
    facts: '',
    attitude: 'нейтральное',
    relationship: 50,
    interests: null,
  };
}

async function getProfiles(chatId, userIds) {
  if (!userIds || userIds.length === 0) return {};
  const r = await query(
    `SELECT * FROM profiles WHERE chat_id = $1 AND user_id = ANY($2)`,
    [chatId, userIds]
  );
  const map = {};
  for (const row of r.rows) map[row.user_id] = row;
  return map;
}

async function upsertProfile(chatId, userId, patch) {
  const existing = await getProfile(chatId, userId);
  const merged = {
    real_name: patch.realName ?? patch.real_name ?? existing.real_name,
    location: patch.location ?? existing.location,
    facts: patch.facts ?? existing.facts,
    attitude: patch.attitude ?? existing.attitude,
    relationship: clampRel(existing.relationship, patch.relationship),
    interests: patch.interests ?? existing.interests,
  };

  await query(
    `INSERT INTO profiles (chat_id, user_id, real_name, location, facts, attitude, relationship, interests, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
     ON CONFLICT (chat_id, user_id) DO UPDATE SET
       real_name = EXCLUDED.real_name,
       location = EXCLUDED.location,
       facts = EXCLUDED.facts,
       attitude = EXCLUDED.attitude,
       relationship = EXCLUDED.relationship,
       interests = EXCLUDED.interests,
       updated_at = now()`,
    [chatId, userId, merged.real_name, merged.location, merged.facts, merged.attitude, merged.relationship, merged.interests]
  );
  return merged;
}

function clampRel(oldScore, newScore) {
  const o = oldScore ?? 50;
  if (newScore === undefined || newScore === null) return o;
  const n = parseInt(newScore, 10);
  if (isNaN(n)) return o;
  let delta = n - o;
  if (delta > 0) delta = Math.min(delta, 3);
  else if (delta < 0) {
    delta = Math.max(delta, -10);
    if (delta > -5 && delta < 0) delta = -5;
  }
  return Math.max(0, Math.min(100, o + delta));
}

async function trackChatUser(chatId, userId, displayName) {
  await query(
    `INSERT INTO chat_users (chat_id, user_id, display_name, last_seen)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (chat_id, user_id) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       last_seen = now()`,
    [chatId, userId, displayName]
  );
}

async function findUserIdByUsername(username) {
  const target = username.replace('@', '').toLowerCase();
  const r = await query(
    `SELECT user_id, display_name FROM chat_users
     WHERE LOWER(display_name) LIKE $1
     ORDER BY last_seen DESC LIMIT 1`,
    [`%${target}%`]
  );
  return r.rows[0] || null;
}

async function findProfileByQuery(chatId, q) {
  const target = q.replace('@', '').toLowerCase();
  const r1 = await query(
    `SELECT cu.user_id, cu.display_name, p.*
     FROM chat_users cu
     LEFT JOIN profiles p ON p.chat_id = cu.chat_id AND p.user_id = cu.user_id
     WHERE cu.chat_id = $1 AND LOWER(cu.display_name) LIKE $2
     LIMIT 1`,
    [chatId, `%${target}%`]
  );
  if (r1.rows[0]) return r1.rows[0];

  const r2 = await query(
    `SELECT p.*, cu.display_name FROM profiles p
     LEFT JOIN chat_users cu ON cu.chat_id = p.chat_id AND cu.user_id = p.user_id
     WHERE p.chat_id = $1 AND LOWER(p.real_name) LIKE $2
     LIMIT 1`,
    [chatId, `%${target}%`]
  );
  return r2.rows[0] || null;
}

module.exports = {
  upsertUser,
  getUser,
  setGlobalMemory,
  getGlobalMemory,
  getUserPersona,
  setUserPersona,
  getProfile,
  getProfiles,
  upsertProfile,
  trackChatUser,
  findUserIdByUsername,
  findProfileByQuery,
};
