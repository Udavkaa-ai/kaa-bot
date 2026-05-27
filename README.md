# kaa-bot

Самый умный Telegram-бот: Claude Sonnet 4.6, долговременная память с pgvector, vision, voice-распознавание, понимание музыки/звуков, 10 личностей с ежедневной ротацией.

## Возможности

- **Главный мозг:** Claude Sonnet 4.6 через OpenRouter с prompt caching
- **Долговременная память:** Postgres + pgvector — бот помнит юзеров, факты, события, может семантически искать по всей истории
- **Распознавание картинок:** Gemini 2.0 Flash (бесплатно)
- **Голосовые сообщения:** Groq Whisper Large v3 Turbo (<1 сек распознавание)
- **Музыка, звуки, аудио:** Gemini audio input — расшифровывает речь, определяет жанры, настроение
- **Веб-поиск:** Tavily / Perplexity (через OpenRouter)
- **Генерация картинок:** Pollinations FLUX (бесплатно)
- **10 личностей** Билли Миллигана — каждому юзеру в каждом чате назначается случайная на день, в 0:00 МСК сброс
- **Индивидуальный подход:** для каждого юзера хранится досье, репутация 0-100, факты, тон общения адаптируется
- **Авто-оживление** неактивных чатов после N часов тишины
- **Ежедневная сводка чата** в 2:00 МСК с архивом в semantic memory
- **Бан-лист, /mute топиков, /draw, /recap, /profile, /stats**
- **Ротация ключей** Gemini и OpenRouter — обход квот
- **Splitting длинных ответов** по 4000 символов
- **Юмористические ответы при ошибках API** в характере персоны

## Установка локально

```bash
git clone https://github.com/udavkaa-ai/kaa-bot
cd kaa-bot
npm install
cp .env.example .env
# заполни .env (см. ниже)
# подними Postgres локально или используй Railway:
psql $DATABASE_URL < src/db/schema.sql
npm start
```

## Деплой на Railway

1. Зайди в [Railway](https://railway.com), создай новый проект
2. **Add Service → GitHub Repo** → выбери `kaa-bot`
3. **Add Service → Database → PostgreSQL**
4. В сервисе бота открой вкладку **Variables**, добавь:
   - `BOT_TOKEN` — токен от [@BotFather](https://t.me/BotFather)
   - `ADMIN_ID` — твой Telegram user id (узнать у [@userinfobot](https://t.me/userinfobot))
   - `OPENROUTER_KEY` — с [openrouter.ai/keys](https://openrouter.ai/keys), там же пополнить баланс ($5 хватит надолго)
   - `GEMINI_KEY` — с [aistudio.google.com](https://aistudio.google.com/app/apikey) (бесплатно). Можно несколько: `GEMINI_KEY_2`, `GEMINI_KEY_3` для ротации квот
   - `GROQ_KEY` — с [console.groq.com/keys](https://console.groq.com/keys) (бесплатно)
   - `TAVILY_KEY` — с [tavily.com](https://tavily.com) (1000 запросов бесплатно)
   - `DATABASE_URL` — нажми **Reference** → выбери `Postgres.DATABASE_URL`
5. **Deploy** — Railway сам соберёт по `Dockerfile`
6. После первого запуска посмотри логи — должно появиться `🐍 Каа запущен`

### Опциональные переменные

```env
BOT_NAME=Каа                              # как тебя зовут
BOT_TRIGGER=каа,kaa,удав,udav             # слова на которые откликается в группах
CLAUDE_MODEL=anthropic/claude-sonnet-4.6  # модель Claude
FALLBACK_MODELS=google/gemini-2.5-flash,meta-llama/llama-3.3-70b-instruct:free
AUTO_REVIVE=true                          # оживлять мёртвые чаты
AUTO_REVIVE_HOURS=3
SEARCH=true                                # веб-поиск (нужен TAVILY_KEY)
IMAGES=true                                # /draw команда
VISION=true                                # распознавать картинки
VOICE=true                                 # распознавать голосовые
AUDIO=true                                 # понимать музыку
HISTORY_LIMIT=30                           # глубина истории в контексте
PROMPT_CACHE=true                          # кэширование Claude (экономия 60-90%)
PRIVATE_CHAT_ADMIN_ONLY=false              # отвечать в ЛС только админу
ADMIN_MUST_BE_IN_GROUP=false               # покидать чаты где нет админа
SEMANTIC_RECALL_K=5                        # сколько релевантных воспоминаний подгружать
```

## Команды

| Команда | Что делает |
|---------|-----------|
| `/start` | Приветствие |
| `/help` | Справка |
| `/persona` | Выбрать какая личность будет общаться сегодня |
| `/recap [часы]` | Пересказ чата за последние N часов |
| `/mute` | Заткнуть бота в текущем топике |
| `/draw <описание>` | Сгенерировать картинку |
| `/profile <ник>` | Досье на участника (имя, факты, репутация) |
| `/stats` (admin) | Статистика использования моделей |
| `/ban <id\|ник>` (admin) | Забанить юзера |
| `/unban <id>` (admin) | Разбанить |
| `/banned` (admin) | Список банов |

## Архитектура

```
src/
├── index.js                 # Bootstrap, polling, cron
├── config.js                # ENV
├── db/
│   ├── schema.sql           # Postgres + pgvector
│   ├── pool.js              # pg pool
│   └── repo/                # CRUD по доменам
├── providers/
│   ├── claude.js            # OpenRouter (главный)
│   ├── gemini.js            # vision + audio + embeddings (ротация ключей)
│   ├── groq.js              # Whisper STT
│   ├── pollinations.js      # генерация картинок
│   ├── tavily.js            # поиск
│   ├── perplexity.js        # альт. поиск
│   └── search.js            # роутер
├── memory/
│   ├── embed.js             # text -> 768-dim
│   ├── semantic.js          # cosine recall
│   ├── archive.js           # daily summary cron
│   └── profile.js           # обновление досье
├── ai/
│   ├── personas.js          # 10 личностей
│   ├── prompt.js            # сборка system prompt с памятью
│   └── errorHumor.js        # шутливые ответы на ошибки
├── handlers/
│   ├── index.js             # диспетчер
│   ├── context.js           # сбор контекста
│   ├── text.js
│   ├── photo.js
│   ├── voice.js             # голос → STT → Claude
│   ├── audio.js             # музыка → Gemini → Claude
│   ├── commands.js
│   ├── callback.js          # inline кнопки (выбор персоны)
│   └── persona.js           # ротация в 0:00 МСК
└── utils/
    ├── queue.js             # per-chat очередь (анти race)
    ├── triggers.js
    ├── typing.js            # typing indicator + min delay
    ├── telegram.js          # split 4000+ ответов
    └── time.js              # МСК helpers
```

## Долговременная память

Три уровня:

1. **Short-term (`messages` table)** — последние `HISTORY_LIMIT` сообщений в контексте Claude
2. **Mid-term (`profiles` table)** — досье на каждого юзера в каждом чате: имя, факты, репутация, тон
3. **Long-term semantic (`memories` table)** — каждое значимое сообщение/факт превращается в embedding и хранится навсегда. При новом запросе подбираются top-K релевантных через cosine similarity

Плюс `daily_summaries` — ежедневная сводка чата с embedding для долгого ретроспективного контекста.

## Личности

Каждому юзеру в каждом чате на день назначается одна из 10 личностей (Колян, Лёха_Крипто, Профессор Берков, Маша, Подполковник Чернов, Витя, Доктор Иванов, Dredd, Следователь Коган, Баба Клава). В 0:00 МСК — сброс, при первом обращении в новом дне — новая случайная.

Если юзер позвал персону по имени («Маша, привет»), назначается она.

Команда `/persona` показывает меню для ручного выбора.

## Лицензия

ISC
