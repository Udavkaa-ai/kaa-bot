# Интеграция с «Билли»

## Что выяснилось про «Билли»
- Node 20, CommonJS, без сборки. Бот — `node-telegram-bot-api` на long polling.
- HTTP-сервер есть: Express в `src/webapp/server.js`, на нём уже живут мини-аппы
  «Сечение», «Эрудит», «Контур». HTTPS даёт Railway.
- База — Postgres (`src/db/pool.js`, `DATABASE_URL`). Файловая система контейнера на Railway
  стирается при каждом деплое.
- Деплой — Dockerfile: копируются `src`, `public`, теперь и `koleya`.

## Выбранный режим: A, внутри процесса
Koleya живёт в каталоге `koleya/` репозитория «Билли» (отдельного репозитория у проекта нет —
сессия разработки имела доступ только к репозиторию «Билли»). Разделение слоёв из
`ARCHITECTURE.md` сохранено каталогами:

| Архитектура | Здесь |
|---|---|
| `packages/engine` | `koleya/engine/` — чистые функции, свой RNG, без I/O |
| `packages/data` | `koleya/content/` — загрузка и валидация `koleya/data/` |
| `packages/core` | `koleya/core/` — API, хранилище, проверка initData |
| `packages/billy-plugin` | `koleya/billy-plugin.js` + `koleya/http.js` |
| `apps/miniapp` | `koleya/miniapp/` — статический HTML/CSS/JS |
| `apps/dev-server` | `koleya/scripts/dev-server.js` |
| `scripts/check-facts.ts` | `koleya/scripts/check-facts.js` |

## Отступления от ARCHITECTURE.md и почему
- **JavaScript, а не TypeScript + pnpm + Vite/Preact.** «Билли» собирается без шага сборки;
  добавлять тулчейн ради модуля — лишний риск деплоя. Когда проект переедет в свой
  репозиторий, слои переносятся один к одному.
- **Postgres «Билли», а не `koleya.sqlite`.** На Railway файл SQLite пропадал бы при каждом
  деплое. Таблицы отдельные (`koleya_players`, `koleya_games`, `koleya_museum`,
  `koleya_quiz_results`), миграция своя (`core/index.js`, `MIGRATION`), со схемой «Билли» не пересекается.
- **Валидация контента без zod** — ручные проверки в `content/index.js`, чтобы не тянуть зависимость.
- **Тесты на `node:test`**, а не Vitest — по той же причине.
- **Викторина главы — внутри мини-аппа**, а не опросами в чате. Опросы «Билли» пишут
  в общий топ чата, а в Koleya рейтингов быть не должно (правило 10). Результаты — в `koleya_quiz_results`.

## Что изменено в самом «Билли»
- `src/webapp/server.js`: `koleya.setBot(bot)` и `koleya.mount(app)` — 4 строки.
- `src/handlers/commands.js`: команда `/koleya`, строка в `/help` и в `/games`.
- `Dockerfile`: `COPY koleya ./koleya`. `.gitignore`: исключение для `koleya/data/`.
- `package.json`: скрипты `koleya:*`. `.env.example`: `KOLEYA_APP`, `KOLEYA_PUBLIC_URL`.

## Настройка на проде
1. BotFather → `/newapp` → короткое имя `koleya`, URL `https://<домен Railway>/koleya/`.
   Нужен для кнопки в группах (Direct Link `t.me/<bot>/koleya`).
2. В личке кнопка — `web_app` с адресом из `KOLEYA_PUBLIC_URL` или `RAILWAY_PUBLIC_DOMAIN`
   (Railway задаёт её сам).
3. Таблицы создаются при старте. Бэкап — вместе с базой «Билли».

## Команды
- `npm run koleya:test` — тесты (ядро на Postgres — при `KOLEYA_TEST_DATABASE_URL`).
- `npm run koleya:check` — проверка фактов и контента.
- `npm run koleya:sim` — симулятор баланса, 1000 партий на стратегию.
- `KOLEYA_DEV_DATABASE_URL=… npm run koleya:dev` — стенд, `http://localhost:8787/koleya/#dev`.
