# AURIS — слышать каждую ноту

Музыкальный сервис внутри Telegram: **Mini App** (основной интерфейс) + **бот** (вход, быстрые действия,
распознавание голосовых, отправка файлов). Поиск и прослушивание, бесконечная волна «Резонанс»,
распознавание «Слух», память о вкусах, скачивание разрешённых треков в Telegram.

```
apps/api        Fastify + Zod API, адаптеры музыки и распознавания, рекомендации, Postgres
apps/bot        grammY бот (webhook), ходит в API по внутреннему секрету
apps/mini-app   React + Vite + @telegram-apps/sdk-react
apps/server     production «всё в одном»: Mini App + API + webhook бота (Dockerfile, render.yaml)
packages/shared общие типы, Zod-схемы, логика бейджей качества
db/migrations   SQL-миграции PostgreSQL (подходит Supabase)
design/         макеты; screenshots/ — скриншоты Playwright и сравнение с макетами
```

## Быстрый старт (без ключей)

Нужны Node 22+, pnpm 10, ffmpeg (для демо-аудио и конвертации записей).

```bash
pnpm install
```

```bash
pnpm dev
```

Откройте http://localhost:5173. Без `.env` работает **MockProvider** (24 оригинальных синтезированных трека AURIS,
CC0, в том числе настоящие FLAC 16/44,1 и 24/96), мок-распознавание и встроенный PostgreSQL (PGlite в `.data/`).
В браузере Mini App получает initData, подписанную тем же алгоритмом, что и Telegram (только в dev),
поэтому серверная проверка подписи работает всегда. `?master=1` в URL включает флаг AURIS MASTER демо-пользователю.

| Команда | Что делает |
|---|---|
| `pnpm dev` | shared (watch) + API :3001 + бот :3002 + Mini App :5173 |
| `pnpm test` | unit (Vitest: shared, api, bot, mini-app) + e2e (Playwright 390×844) |
| `pnpm check` | типы, ESLint, проверка `.env.example`/`.env` против схем, проверка миграций на чистой БД |
| `pnpm build` | production-сборка всех пакетов |
| `pnpm screenshots` | скриншоты экранов + `screenshots/compare/*` (макет · наш экран · diff) |
| `pnpm smoke` | живая проверка подключённых провайдеров против настоящих API |
| `pnpm db:migrate` | применить миграции к `DATABASE_URL` |
| `TEST_DATABASE_URL=postgres://… pnpm --filter @auris/api test` | API-тесты на настоящем PostgreSQL (по базе на тест) |

## 1. Бот в BotFather

1. `@BotFather` → `/newbot` → имя и username → получите **токен** → `BOT_TOKEN`, username → `BOT_USERNAME`.
2. `/newapp` (или Bot Settings → Configure Mini App) → выберите бота → укажите **HTTPS URL Mini App** (`MINI_APP_URL`).
   Short name, например `app`, даёт ссылку `https://t.me/<bot>/app`.
3. Menu Button и список команд бот настраивает сам при старте (`setChatMenuButton` + `setMyCommands`).
4. Сгенерируйте секреты:

```bash
openssl rand -hex 32
```

   — для `INTERNAL_API_SECRET`, `STREAM_SIGNING_SECRET`, `WEBHOOK_SECRET`.

## 2. Ключи провайдеров

Скопируйте `.env.example` в `.env`. Все ключи хранятся только на сервере; в бандл Mini App попадают лишь `VITE_*`.

| Провайдер | Ключ | Где взять | Что даёт |
|---|---|---|---|
| Deezer | не нужен | — | поиск, чарты, обложки, метаданные, **30-секундные превью**. Включается `MUSIC_PROVIDERS=deezer` + `DEEZER_ENABLED_NONCOMMERCIAL=true` (подтверждение некоммерческого использования) |
| Jamendo | `JAMENDO_CLIENT_ID` | https://devportal.jamendo.com | полные треки Creative Commons; скачивание — только где артист разрешил |
| Licensed (B2B) | `LICENSED_API_URL`, `LICENSED_API_KEY` | договор с Tuned Global / 7digital / аналогом | см. `docs/licensed-provider.md` |
| AudD | `AUDD_API_TOKEN` | https://dashboard.audd.io | распознавание |
| ACRCloud | `ACRCLOUD_HOST`, `ACRCLOUD_ACCESS_KEY`, `ACRCLOUD_ACCESS_SECRET` | https://console.acrcloud.com → Audio & Video Recognition project | распознавание |

Пример боевой конфигурации:

```
MUSIC_PROVIDERS=jamendo,deezer
DEEZER_ENABLED_NONCOMMERCIAL=true
JAMENDO_CLIENT_ID=...
RECOGNITION_PROVIDERS=audd,acrcloud   # второй — запасной, если первый недоступен
```

Смена поставщика = новый адаптер `MusicProvider` в `apps/api/src/providers/music/` + строка в `registry.ts` + env.
UI, рекомендации и бот работают только через интерфейс и namespaced id (`jamendo:123`).

## 3. Локальная проверка в Telegram через HTTPS-туннель

Telegram открывает Mini App только по HTTPS. Поднимите туннель на Vite (он проксирует `/api` на API):

```bash
cloudflared tunnel --url http://localhost:5173
```

или

```bash
ngrok http 5173
```

Затем в `.env`:

```
MINI_APP_URL=https://<ваш-туннель>
BOT_TOKEN=...
BOT_USERNAME=...
INTERNAL_API_SECRET=...
BOT_MODE=polling        # локально; в проде — webhook
```

и `pnpm dev`. Укажите тот же URL в BotFather (`/myapps` → Edit Web App URL). Для webhook локально нужен второй туннель
на порт 3002 и `BOT_MODE=webhook`, `BOT_WEBHOOK_URL=https://<туннель-бота>`.

## 4. Деплой

**Быстрый путь — один сервис:** `Dockerfile` + `render.yaml` (Render Blueprint) + Supabase, пошагово в
[`docs/deploy-render.md`](docs/deploy-render.md). Образ собирает `apps/server`: Mini App, API и webhook бота на одном HTTPS-адресе.

Раздельный деплой:

* **БД**: Supabase или любой PostgreSQL 14+. `DATABASE_URL=postgres://...?sslmode=require`, затем `pnpm db:migrate`
  (API также применяет миграции при старте).
* **API** (`apps/api`): `pnpm build && node apps/api/dist/index.js`. Нужны ffmpeg, `NODE_ENV=production`, `DATABASE_URL`,
  `BOT_TOKEN`, `INTERNAL_API_SECRET`, `STREAM_SIGNING_SECRET`, `MINI_APP_URL` (https). Без них сервер не стартует.
* **Бот** (`apps/bot`): `node apps/bot/dist/index.js`, `BOT_MODE=webhook`, `BOT_WEBHOOK_URL` (публичный HTTPS до порта `BOT_PORT`),
  `WEBHOOK_SECRET`, `INTERNAL_API_URL` (внутренний адрес API).
* **Mini App** (`apps/mini-app/dist`): любой статический хостинг/CDN. Проще всего тот же домен, что и API,
  с проксированием `/api/*` на API (тогда `VITE_API_URL` пустой и CORS не нужен). Если API на другом домене —
  `VITE_API_URL=https://api.example.com` при сборке и `PUBLIC_API_URL` у API; CORS разрешён только для `MINI_APP_URL`.
* Внутренние маршруты `/internal/*` не должны быть доступны снаружи (закройте на прокси) — они дополнительно защищены секретом.

## Безопасность

* Каждый запрос Mini App несёт `Authorization: tma <initData>`; сервер проверяет HMAC-подпись (`WebAppData` + токен бота)
  и срок `auth_date`. `initDataUnsafe` не используется.
* Webhook: grammY отклоняет обновления без правильного `X-Telegram-Bot-Api-Secret-Token` (тест есть).
* Rate limit (глобальный и по пользователю), Zod-валидация всех входов, лимиты размера тела и файлов, CORS только для Mini App.
* Аудиопотоки идут через API по коротким подписанным ссылкам — URL и ключи провайдеров (например `client_id` Jamendo) не попадают на клиент.
* Записи «Слуха» живут только в памяти/временном каталоге на время конвертации и удаляются; тело запросов не логируется.

## Рекомендации «Резонанс»

`apps/api/src/reco/weights.ts` — все веса в одном месте; `scoring.ts` — объяснимый скоринг; тесты в `scoring.test.ts`.
Кандидаты: чарты провайдера, топ-треки любимых артистов, похожие артисты, любимые жанры, теги настроения,
избранное пользователя, выбор при онбординге. Сигналы с затуханием (период полураспада 14 дней):
лайк +3, полное прослушивание +1, повтор +1,5, добавление в плейлист +2, найдено через Слух +1,5,
ранний пропуск (< 30 с или < 30 %) −1,5, поздний −0,2, дизлайк −4. Режимы меняют вес знакомого/нового.
Очередь: не повторяет недавно сыгранное, один артист не чаще одного раза на 3 трека, подгружается заранее,
перестраивается сразу после лайка, дизлайка или смены настроения. Коллаборативная фильтрация — следующий источник кандидатов.

## Ограничения источников

| Источник | Прослушивание | Скачивание в Telegram | Качество |
|---|---|---|---|
| Deezer API | только превью 30 с; условия — некоммерческое личное использование | **запрещено** условиями — сервер всегда отказывает | MP3 128 кбит/с превью, бейджи качества не показываются |
| Jamendo | полные треки CC | только если `audiodownload_allowed=true` и лицензия CC распознана; подпись с атрибуцией и ссылкой; `file_id` не кэшируется по умолчанию | MP3 VBR (FLAC Jamendo не выдаём за lossless — исходник неизвестен) |
| Licensed | по правам трека | только при `LICENSED_DOWNLOADS_CONTRACTED=true` и `rights.download` | по заявленным данным, Hi-Res только при 24 бит |
| Mock (демо) | полные 45-секундные синтезированные треки | разрешено (CC0, собственный контент) | реальные MP3 192 / FLAC 16/44,1 / FLAC 24/96 |

Лимиты Telegram Bot API (проверено 2026-11): `sendAudio` — до 50 МБ, только MP3/M4A для встроенного плеера;
`getFile` (голосовые боту) — до 20 МБ.

## Фоновое воспроизведение

Mini App — это WebView Telegram. На iOS при сворачивании Telegram или блокировке экрана WKWebView обычно
приостанавливает звук; на Android поведение зависит от версии Telegram и производителя (часто играет до выгрузки WebView).
Media Session API подключён (обложка, название, кнопки на экране блокировки, где система это поддерживает),
но фоновое воспроизведение мы не обещаем — для офлайна есть «Скачать в Telegram» для разрешённых треков.
