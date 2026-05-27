CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  global_memory TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chats (
  id BIGINT PRIMARY KEY,
  title TEXT,
  type TEXT,
  auto_revive BOOLEAN DEFAULT false,
  chat_topic TEXT,
  chat_facts TEXT,
  chat_style TEXT,
  triggers TEXT,
  last_msg_ts TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
-- Идемпотентная миграция: добавляем колонку если её ещё нет
ALTER TABLE chats ADD COLUMN IF NOT EXISTS triggers TEXT;

CREATE TABLE IF NOT EXISTS user_personas (
  user_id BIGINT NOT NULL,
  chat_id BIGINT NOT NULL,
  persona_id TEXT NOT NULL,
  date_assigned DATE NOT NULL,
  PRIMARY KEY (user_id, chat_id)
);

CREATE TABLE IF NOT EXISTS profiles (
  chat_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  real_name TEXT,
  location TEXT,
  facts TEXT DEFAULT '',
  attitude TEXT DEFAULT 'нейтральное',
  relationship INTEGER DEFAULT 50,
  interests TEXT,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (chat_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id BIGSERIAL PRIMARY KEY,
  chat_id BIGINT NOT NULL,
  user_id BIGINT,
  username TEXT,
  role TEXT NOT NULL,
  text TEXT,
  message_id BIGINT,
  ts TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_chat_ts ON messages (chat_id, ts DESC);

CREATE TABLE IF NOT EXISTS memories (
  id BIGSERIAL PRIMARY KEY,
  chat_id BIGINT,
  user_id BIGINT,
  content TEXT NOT NULL,
  kind TEXT,
  importance REAL DEFAULT 0.5,
  embedding vector(768),
  ts TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_memories_chat ON memories (chat_id);
CREATE INDEX IF NOT EXISTS idx_memories_user ON memories (user_id);
CREATE INDEX IF NOT EXISTS idx_memories_embedding ON memories USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE TABLE IF NOT EXISTS daily_summaries (
  chat_id BIGINT NOT NULL,
  date DATE NOT NULL,
  summary TEXT,
  embedding vector(768),
  PRIMARY KEY (chat_id, date)
);
CREATE INDEX IF NOT EXISTS idx_summaries_embedding ON daily_summaries USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE TABLE IF NOT EXISTS banned_users (
  user_id BIGINT PRIMARY KEY,
  reason TEXT,
  banned_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS muted_topics (
  chat_id BIGINT NOT NULL,
  thread_id TEXT NOT NULL,
  PRIMARY KEY (chat_id, thread_id)
);

CREATE TABLE IF NOT EXISTS usage_stats (
  date DATE NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  count INTEGER DEFAULT 0,
  PRIMARY KEY (date, provider, model)
);

CREATE TABLE IF NOT EXISTS reminders (
  id BIGSERIAL PRIMARY KEY,
  chat_id BIGINT NOT NULL,
  user_id BIGINT,
  username TEXT,
  fire_at TIMESTAMPTZ NOT NULL,
  text TEXT
);
CREATE INDEX IF NOT EXISTS idx_reminders_fire ON reminders (fire_at);

CREATE TABLE IF NOT EXISTS chat_users (
  chat_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  display_name TEXT,
  last_seen TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (chat_id, user_id)
);

-- Розыгрыши
CREATE TABLE IF NOT EXISTS giveaways (
  id BIGSERIAL PRIMARY KEY,
  chat_id BIGINT NOT NULL,
  message_id BIGINT NOT NULL,
  creator_id BIGINT NOT NULL,
  prize TEXT NOT NULL,
  ends_at TIMESTAMPTZ,
  target_count INTEGER,
  winners_count INTEGER DEFAULT 1,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_giveaways_active ON giveaways (status, ends_at) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS giveaway_participants (
  giveaway_id BIGINT NOT NULL REFERENCES giveaways(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL,
  username TEXT,
  joined_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (giveaway_id, user_id)
);

CREATE TABLE IF NOT EXISTS giveaway_winners (
  giveaway_id BIGINT NOT NULL REFERENCES giveaways(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL,
  username TEXT,
  PRIMARY KEY (giveaway_id, user_id)
);

-- Викторины
CREATE TABLE IF NOT EXISTS quizzes (
  poll_id TEXT PRIMARY KEY,
  chat_id BIGINT NOT NULL,
  message_id BIGINT,
  question TEXT,
  correct_option INTEGER,
  topic TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quiz_scores (
  chat_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  username TEXT,
  correct INTEGER DEFAULT 0,
  total INTEGER DEFAULT 0,
  PRIMARY KEY (chat_id, user_id)
);

CREATE TABLE IF NOT EXISTS quiz_answers (
  poll_id TEXT NOT NULL,
  user_id BIGINT NOT NULL,
  PRIMARY KEY (poll_id, user_id)
);
