# Архитектура

## Главное: игра живёт внутри бота «Билли»
Своего бота у Koleya нет. Игра — модуль «Билли»: запускается отдельной командой `/koleya`,
использует токен, базу-инфраструктуру и движок викторины «Билли». Всё игровое
(движок, контент, Mini App, API игры) живёт в репозитории Koleya и подключается к «Билли»
как зависимость. Код «Билли» при этом меняется минимально: регистрация модуля в одном месте.

## Структура репозитория
```
koleya/
  CLAUDE.md
  data/                  # контент: факты, карты, события, баланс (JSON)
  docs/
  packages/
    engine/              # чистая игровая логика (TS, без I/O)
    data/                # zod-схемы, загрузка и валидация data/, типы
    core/                # API игры, хранилище, проверка initData — без привязки к фреймворку
    billy-plugin/        # тонкий адаптер под стек «Билли»: команда, маршруты, уведомления
  apps/
    miniapp/             # Vite + Preact + TS, Telegram WebApp SDK, SVG-карта
    dev-server/          # локальный стенд для разработки без «Билли» (тестовый бот)
  scripts/
    check-facts.ts       # валидатор исторической базы
```

## Поток данных
```
Пользователь в «Билли» ──/koleya──▶ кнопка «Открыть игру» (web_app) ──▶ Mini App
Mini App ──(action + initData)──▶ /koleya/api/* (HTTP-сервер «Билли»)
                                   ──▶ core: validate initData (HMAC, токен «Билли»)
                                   ──▶ load state (koleya.sqlite)
                                   ──▶ engine.apply(state, action, rng)
                                   ──▶ save state, return new state + log
core ──notify(tgId, text)──▶ бот «Билли» («Сезон завершён», «Ревизия!», «Глава пройдена»)
Финал главы ──▶ викторина в чате через движок викторины «Билли»
```

## Контракт модуля
`packages/core` ничего не знает о библиотеке бота и HTTP-фреймворке. Он экспортирует:
```ts
createKoleya(deps: {
  botToken: string;                 // токен «Билли», нужен для проверки initData
  dbPath: string;                   // отдельный файл koleya.sqlite
  publicUrl: string;                // https://<домен «Билли»>/koleya/
  notify: (tgId: number, text: string, opts?: { button?: 'open_game' }) => Promise<void>;
  startQuiz?: (tgId: number, questions: QuizQuestion[]) => Promise<void>; // движок «Билли»
  log?: (msg: string, meta?: object) => void;
}): {
  handleApi(req: { method: string; path: string; body?: unknown; initData: string }):
    Promise<{ status: number; body: unknown }>;
  staticDir: string;                // собранный Mini App для раздачи по /koleya/
  commandText(): string;            // текст сообщения по /koleya
}
```
`packages/billy-plugin` — 30–80 строк под реальный стек «Билли»: зарегистрировать команду
`/koleya`, отправить кнопку web_app, пробросить `/koleya/api/*` в `handleApi`, раздать
`staticDir`, реализовать `notify` и `startQuiz` через уже существующие функции «Билли».

## Режимы подключения
- **A. Внутри процесса (основной).** «Билли» импортирует `@koleya/billy-plugin` (git-зависимость
  или локальный workspace). Требует, чтобы у «Билли» был HTTP-сервер с HTTPS (он обычно уже есть
  для вебхука). Плюсы: один деплой, прямой доступ к викторине и уведомлениям.
- **B. Сосед по серверу (запасной).** Koleya работает отдельным процессом, «Билли» только
  отвечает на `/koleya` кнопкой и принимает уведомления по внутреннему HTTP с секретом.
  Выбирать, если «Билли» живёт на long polling без веб-сервера и поднимать его там неудобно.

## Ограничения Telegram, которые надо учесть
- Кнопка `web_app` в инлайн-клавиатуре работает только в личке с ботом. Если `/koleya`
  вызвали в группе, «Билли» отвечает ссылкой на Direct Link Mini App
  (`t.me/<bot>/<app>`, регистрируется в BotFather через /newapp) или предлагает перейти в личку.
- initData подписан токеном того бота, из которого открыт Mini App, — то есть «Билли».
- Имя команды — только латиница: `/koleya`.

## Данные
Отдельный файл `koleya.sqlite`, чтобы миграции игры не пересекались со схемой «Билли».
Идентификатор игрока — Telegram user id, общий с «Билли».

## Engine
Чистые функции:
- `createGame(chapterId, content, seed): GameState`
- `applyAction(state, action, content, rng): { state, log: GameLogEntry[] }`
- `endSeason(state, content, rng): { state, log, triggeredEvents }`
- `simulateFirstTrain(state, content): TrainRunResult`
- `scoreChapter(state, content): ChapterScore`

RNG: mulberry32 или аналог, сид хранится в состоянии и продвигается детерминированно.

### Основные типы (ориентир, уточнить в коде)
```ts
type Season = 'spring' | 'summer' | 'autumn' | 'winter';
type Terrain = 'plain' | 'forest' | 'swamp' | 'hills';

interface GameState {
  chapterId: 'prologue' | 'chapter1';
  seed: number; rngCursor: number;
  year: number; season: Season; turn: number;
  treasury: number;          // тыс. руб., игровые единицы
  favor: number;             // 0..100
  morale: number;            // 0..100
  crewsTotal: number;        // тысячи рабочих
  decisions: Record<string, string>;   // eventId -> choiceId
  routeVariant: 'direct' | 'novgorod' | null;
  gauge: 1435 | 1524 | 1829 | null;
  tracks: 1 | 2 | null;
  segments: Record<string, SegmentState>;
  rollingStock: { locomotives: Record<string, number>; carriages: number };
  pendingEvents: string[];
  firedEvents: string[];
  incidents: number;
  finished: boolean;
}

interface SegmentState {
  id: string; directorate: 'north' | 'south' | null;
  crews: number;             // тысячи рабочих на участке
  workDone: number; workTotal: number;
  features: Record<string, string>;    // 'verebye_grade' -> 'steep' | 'bypass'
  opened: boolean;
}

type Action =
  | { type: 'CHOOSE'; eventId: string; choiceId: string }
  | { type: 'ASSIGN_CREWS'; segmentId: string; crews: number }
  | { type: 'HIRE_CREWS'; amount: number }
  | { type: 'DISMISS_CREWS'; amount: number }
  | { type: 'SET_PAY'; level: 'low' | 'normal' | 'high' }
  | { type: 'BUY'; itemId: string; qty: number }
  | { type: 'PETITION_FUNDS' }
  | { type: 'END_SEASON' };
```

### Эффекты событий (декларативные, в JSON)
```json
{ "treasury": -500, "favor": 5, "morale": -10,
  "set": { "gauge": 1524 },
  "segmentFeature": { "segment": "vishera_okulovka", "feature": "verebye_grade", "value": "bypass" },
  "addLengthKm": { "segment": "vishera_okulovka", "km": 5 },
  "flag": "novgorod_served" }
```
Новый тип эффекта = изменение схемы + обработчик в engine + тест.

## Схемы контента (data/)
- `facts.json`: `{ id, title, text, year?, date?, status, sources[{title,url}], note?, tags[] }`
- `chapterN/map.json`: узлы (id, name, lat, lon, kind), участки (id, from, to, length_km,
  terrain{доли}, features[], variant, directorate)
- `chapterN/events.json`: `{ id, type, trigger, title, text, choices[], history, fact_refs[] }`
- `chapterN/advisors.json`, `chapterN/quiz.json`, `balance.json`, `forbidden_terms.json`

Триггеры событий:
`{ "atTurn": 0 }`, `{ "afterEvent": "E03" }`, `{ "segmentProgress": { "segment": "...", "gte": 0.3 } }`,
`{ "season": "winter", "chance": 0.5 }`, `{ "favorLte": 20 }`.

## API игры (core)
- Маршруты под префиксом `/koleya/api`: `POST /game/start`, `GET /game`, `POST /game/action`,
  `GET /museum` (открытые карточки фактов).
- Проверка `initData` на каждом запросе (HMAC-SHA256 от токена «Билли», проверка `auth_date`).
- SQLite (better-sqlite3 + drizzle): `games(id, tg_id, chapter, state_json, updated_at)`,
  `museum(tg_id, fact_id, opened_at)`, `quiz_results(tg_id, chapter, score, created_at)`.
- Команды в «Билли»: `/koleya` — кнопка игры и краткий прогресс. Турниров и рейтингов нет.

## Локальная разработка
`apps/dev-server` поднимает `core` на Fastify с отдельным тестовым ботом из BotFather и туннелем
(cloudflared/ngrok) для HTTPS. Так игру можно разрабатывать, не трогая прод «Билли».

## Mini App
- Preact + TS, без UI-китов. Telegram WebApp SDK: `ready()`, `expand()`, `MainButton`
  для «Завершить сезон», `HapticFeedback` на подтверждениях.
- Карта: SVG, простая равнопромежуточная проекция, вписанная в bbox главы.
  Участки — линии, прогресс — отрисовка части линии, особенности рельефа — штриховки.
- Состояние клиента — сигнал (preact/signals), источник истины — ответ сервера.

## Темы эпох
Корневой `data-era` (`engraving`, `lithograph`, `poster`, `booklet`). Каждая тема — файл токенов
(`apps/miniapp/src/themes/<era>.css`) и набор SVG-паттернов карты (`.../themes/<era>/patterns.svg`).
Глава в `map.json` указывает свою эпоху полем `era`.

## LLM (после MVP, опционально)
Советники могут перефразировать реплики через OpenRouter, получая на вход только
текст фактов по `fact_refs`. Без доступа к фактам — статичная реплика. Никаких «новых фактов».
Проект бесплатный: по умолчанию LLM выключен, при включении — только бесплатные модели.

## Деплой
Вместе с «Билли»: его домен и HTTPS, путь `/koleya/`. Бэкап `koleya.sqlite` добавить в бэкап «Билли».
