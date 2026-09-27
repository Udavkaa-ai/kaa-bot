# «История железных дорог России» — веб-версия

Та же игра, что в мини-аппе «Билли», но в обычном браузере и отдельным сервисом на Railway.
Код игры общий (`koleya/`), здесь только сервер: `server.js`.

## Как устроено
- Вход гостевой: при первом заходе сервер выдаёт подписанный токен игрока
  (`POST /koleya/web/session`), браузер хранит его в localStorage. Каждый запрос к API
  проверяется HMAC-подписью токена (секрет `KOLEYA_WEB_SECRET`), как initData в Telegram.
- Гостевые id берутся из отдельного диапазона (от 10^15), поэтому база может быть общей
  с «Билли»: таблицы `koleya_*` те же, игроки не пересекаются.
- **Вход по имени** (без сторонних сервисов): уникальное имя + PIN из 4–8 цифр (хранится scrypt-хешем,
  не больше 10 неверных PIN в час на имя). Текущая игра гостя закрепляется за новым именем;
  на другом устройстве то же имя и PIN возвращают ту же игру.
- **Вход через Telegram** (Login Widget): переменные `KOLEYA_BOT_TOKEN` (токен бота «Билли»,
  на Railway — ссылкой `${{<сервис бота>.BOT_TOKEN}}`) и `KOLEYA_BOT_USERNAME` (имя бота без @).
  В @BotFather для бота: `/setdomain` → домен сайта. Игрок получает свой Telegram id — прогресс общий
  с мини-аппом в боте; главы гостя переносятся в аккаунт, если их там ещё нет.
- `GET /healthz` — проверка здоровья для Railway, `/` → `/koleya/`.

## Railway: новый сервис из ветки

> **Важно.** В ветке `koleya-web` корневой `railway.json` заменён на конфиг веб-версии, чтобы
> сервис игры собирался из `koleya/web/Dockerfile` без ручных настроек. При слиянии ветки
> в master этот файл **брать нельзя**: в master он собирает бота «Билли»
> (`git checkout master -- railway.json` после слияния).
1. В проекте Railway, где живёт «Билли»: **New → GitHub Repo →** этот репозиторий.
2. У нового сервиса в **Settings**:
   - **Source → Branch:** `koleya-web`;
   - **Config-as-code → Railway Config File:** `/koleya/web/railway.json`
     (в нём сборка по `koleya/web/Dockerfile` и healthcheck `/healthz`).
3. **Variables:**
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (ссылка на базу проекта; можно и отдельную);
   - `KOLEYA_WEB_SECRET` = длинная случайная строка (не короче 32 символов). Смена секрета
     обнуляет все гостевые сессии;
   - по желанию `KOLEYA_WEB_SESSIONS_PER_HOUR` (по умолчанию 20 новых игроков в час с адреса).
4. **Settings → Networking → Generate Domain** — адрес игры: `https://<домен>/`.

## Локально
```
DATABASE_URL=postgres://... KOLEYA_WEB_SECRET=$(openssl rand -hex 32) node koleya/web/server.js
# http://localhost:8080/
```
