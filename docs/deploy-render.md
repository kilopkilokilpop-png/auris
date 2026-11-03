# Деплой: Render + Supabase

Один Docker-сервис (`apps/server`) на одном HTTPS-адресе:

| Путь | Что |
|---|---|
| `/` | Mini App |
| `/api/*` | API |
| `/telegram/webhook` | бот (проверяется `X-Telegram-Bot-Api-Secret-Token`) |
| `/internal/*` | только с самой машины (бот → API), снаружи 404 |

## 1. База — Supabase

1. Создайте проект (регион Frankfurt `eu-central-1`, рядом с Render Frankfurt).
2. **Connect → Session pooler** → скопируйте URI вида
   `postgresql://postgres.<ref>:<пароль>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`.
   Прямой адрес `db.<ref>.supabase.co` на бесплатном тарифе только IPv6 — Render к нему не подключится.
   Если пароль неизвестен: Project Settings → Database → Reset database password.
   Можно указать несколько адресов через запятую (например, пулеры `aws-0-…` и `aws-1-…`) — сервер возьмёт первый рабочий.
3. Таблицы сервер создаёт сам при первом запуске (`db/migrations`). Миграция `0002` включает RLS на всех таблицах,
   поэтому публичный ключ Supabase Data API их не видит; сервер подключается владельцем БД.

## 2. Код — GitHub

Render собирает из репозитория. Залейте проект в свой (можно приватный) репозиторий.

## 3. Сервис — Render

1. https://dashboard.render.com → **New → Blueprint** → выберите репозиторий (Render прочитает `render.yaml`).
2. Заполните запрошенные значения:
   * `DATABASE_URL` — URI из шага 1;
   * `BOT_TOKEN` — токен от @BotFather;
   * `BOT_USERNAME` — имя бота без `@`;
   * `AUDD_API_TOKEN` — можно оставить пустым (тогда Слух честно показывает «не настроено»; чтобы включить,
     задайте токен и `RECOGNITION_PROVIDERS=audd`).
3. **Apply**. Первая сборка 5–10 минут. Секреты `INTERNAL_API_SECRET`, `STREAM_SIGNING_SECRET`, `WEBHOOK_SECRET`
   Render сгенерирует сам; публичный адрес сервер берёт из `RENDER_EXTERNAL_URL`.
4. При старте сервер сам ставит webhook, команды и кнопку меню бота на `https://<сервис>.onrender.com`.

Если раньше бот запускался локально в режиме `polling`, остановите его: webhook и polling не работают одновременно.

## 4. Telegram

* Кнопка меню «AURIS» появится сама.
* Для ссылки вида `t.me/<bot>/app`: @BotFather → `/newapp` → бот → URL `https://<сервис>.onrender.com`.

## Тариф

Бесплатный инстанс Render засыпает после ~15 минут без запросов; первый запрос (открытие Mini App или сообщение боту)
будит его ~30–60 секунд, Telegram повторит доставку сам. Тариф Starter не засыпает.
Диск инстанса временный: демо-аудио пересоздаётся при старте, данные пользователей — в Supabase.

## Проверка

```bash
curl https://<сервис>.onrender.com/api/health
```

Ответ `{"ok":true,...}`. Затем `/start` боту и кнопка «AURIS».
