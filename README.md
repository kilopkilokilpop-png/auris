# AURIS — слышать каждую ноту

Некоммерческий музыкальный сервис внутри Telegram: **Mini App** (основной интерфейс) + **бот** (вход и согласие с условиями,
быстрые команды, распознавание голосовых). Поиск и прослушивание через официальные источники (**YouTube** — официальный
плеер YouTube, **Jamendo** — треки Creative Commons), бесконечная волна «Резонанс», распознавание «Слух», память о вкусах.
**Скачивания, офлайн-режима, рекламы и подписок нет.** Бот не отправляет музыкальные файлы.

```
apps/api        Fastify + Zod API, адаптеры MusicProvider / RecognitionProvider, рекомендации, Postgres, ретенция данных YouTube
apps/bot        grammY бот (webhook), ходит в API по внутреннему секрету
apps/mini-app   React + Vite + @telegram-apps/sdk-react; официальный YouTube IFrame Player API
apps/server     production «всё в одном»: Mini App + API + webhook бота (Dockerfile, render.yaml)
packages/shared общие типы, Zod-схемы, логика бейджей качества, заголовки безопасности
db/migrations   SQL-миграции PostgreSQL (подходит Supabase)
design/         макеты; screenshots/ — скриншоты Playwright 390×844 и сравнение с макетами
```

## Быстрый старт (без ключей)

Нужны Node 22+, pnpm 10, ffmpeg (демо-аудио и конвертация записей Слуха).

```bash
pnpm install
```

```bash
pnpm dev
```

Откройте http://localhost:5173. Без `.env` работают:

* **MockProvider** — локальные демо-треки AURIS (CC0, настоящие MP3 и FLAC 16/44,1 и 24/96);
* **YouTube на dev-фикстурах** — если `YOUTUBE_API_KEY` пуст и `NODE_ENV≠production`: несколько публичных встраиваемых видео
  с заранее записанными метаданными, воспроизведение — в настоящем официальном плеере YouTube (нужен доступ к youtube.com);
* мок-распознавание и встроенный PostgreSQL (PGlite в `.data/`).

В браузере Mini App получает initData, подписанную тем же алгоритмом, что и Telegram (только в dev), поэтому серверная проверка
подписи работает всегда. Первый вход показывает экран условий. `?terms=1` в URL принимает их заранее (для тестов).

| Команда | Что делает |
|---|---|
| `pnpm dev` | shared (watch) + API :3001 + бот :3002 + Mini App :5173 |
| `pnpm test` | unit (Vitest: shared, api, bot, mini-app) + e2e (Playwright 390×844, включая настоящий плеер YouTube) |
| `pnpm check` | типы, ESLint, проверка `.env.example`/`.env` против схемы, проверка миграций на чистой БД |
| `pnpm build` | production-сборка всех пакетов |
| `pnpm screenshots` | скриншоты экранов + `screenshots/compare/*` (макет · наш экран · diff) |
| `pnpm smoke` | живая проверка подключённых провайдеров против настоящих API |
| `pnpm db:migrate` | применить миграции к `DATABASE_URL` |

## 1. Бот в BotFather

1. `@BotFather` → `/newbot` → имя и username → **токен** → `BOT_TOKEN`, username → `BOT_USERNAME`.
2. `/newapp` (или Bot Settings → Configure Mini App) → выберите бота → **HTTPS URL Mini App** (`MINI_APP_URL`).
3. Menu Button и команды (`/start /wave /search /liked /settings`) бот настраивает сам при старте.
4. Секреты для `INTERNAL_API_SECRET`, `STREAM_SIGNING_SECRET`, `WEBHOOK_SECRET`:

```bash
openssl rand -hex 32
```

## 2. Ключи API и квоты

Скопируйте `.env.example` в `.env`. Ключи хранятся только на сервере; в бандл Mini App попадают лишь `VITE_*`.

| Источник | Переменные | Где взять | Квоты и правила |
|---|---|---|---|
| YouTube Data API v3 | `YOUTUBE_API_KEY`, `YOUTUBE_REGION` | console.cloud.google.com → **один** проект для AURIS → Library → «YouTube Data API v3» → Credentials → API key; ограничьте ключ этим API | по умолчанию 10 000 единиц/сутки: `search.list` = 100, `videos.list`/`channels.list` = 1. ≈ 90 поисков в сутки на всех. Поиск и списки кэшируются на 12 ч, сведения о видео — на 6 ч; при исчерпании квоты показывается сообщение и отдаётся кэш не старше 30 дней. Дополнительную квоту — только через аудит Google; создавать лишние проекты запрещено |
| Jamendo | `JAMENDO_CLIENT_ID` | https://devportal.jamendo.com | бесплатно только для **некоммерческого** использования; у каждого трека — автор, лицензия и ссылка на Jamendo |
| Licensed (B2B) | `LICENSED_API_URL`, `LICENSED_API_KEY` | договор с поставщиком каталога | контракт — `docs/licensed-provider.md` |
| AudD | `AUDD_API_TOKEN` | https://dashboard.audd.io | платные запросы — ограничены `RECOGNITION_DAILY_BUDGET` |
| ACRCloud | `ACRCLOUD_HOST`, `ACRCLOUD_ACCESS_KEY`, `ACRCLOUD_ACCESS_SECRET` | https://console.acrcloud.com | то же |

Боевая конфигурация:

```
MUSIC_PROVIDERS=youtube,jamendo
YOUTUBE_API_KEY=...
YOUTUBE_REGION=RU
JAMENDO_CLIENT_ID=...
RECOGNITION_PROVIDERS=audd,acrcloud      # второй — запасной
RECOGNITION_PER_DAY=30                   # на пользователя
RECOGNITION_DAILY_BUDGET=300             # на весь сервис (лимит расходов)
```

Без ключа распознавания Слух отключается с понятным сообщением (`RECOGNITION_PROVIDERS=none`).
Смена поставщика = новый адаптер `MusicProvider` в `apps/api/src/providers/music/` + строка в `registry.ts` + env.
UI, рекомендации и бот работают только через интерфейс и namespaced id (`youtube:<videoId>`, `jamendo:123`).

## 3. Локальная проверка в Telegram через HTTPS-туннель

Telegram открывает Mini App только по HTTPS. Туннель на Vite (он проксирует `/api` на API):

```bash
cloudflared tunnel --url http://localhost:5173
```

или

```bash
ngrok http 5173
```

В `.env`: `MINI_APP_URL=https://<туннель>`, `BOT_TOKEN`, `BOT_USERNAME`, `INTERNAL_API_SECRET`, `BOT_MODE=polling`; затем `pnpm dev`
и тот же URL в BotFather. **Referer для плеера YouTube:** страницы отдаются с `Referrer-Policy: strict-origin-when-cross-origin`
(и `<meta name="referrer">`), плееру передаются `origin` и `widget_referrer` — YouTube видит домен AURIS. Проверьте в Telegram
на телефоне, что видео запускается (ошибка 153 означает, что Referer не дошёл).

## 4. Деплой

**Один сервис:** `Dockerfile` + `render.yaml` (Render Blueprint) + Supabase, пошагово — [`docs/deploy-render.md`](docs/deploy-render.md).
`apps/server` отдаёт Mini App (с CSP: фреймы только `youtube.com` / `youtube-nocookie.com`), API и webhook бота на одном HTTPS-адресе.
Миграции применяются при старте API. Раздельный деплой: API (`node apps/api/dist/index.js`), бот (`node apps/bot/dist/index.js`,
`BOT_MODE=webhook`, `BOT_WEBHOOK_URL`, `WEBHOOK_SECRET`), статический Mini App с проксированием `/api/*`. `/internal/*` закройте на прокси.

## Правила YouTube (как они выполнены)

* Только официальный видимый **YouTube IFrame Player** не меньше 200×200 (на 390 px — 340×200), элементы управления YouTube видны полностью.
  Поверх плеера ничего нет: без скруглений и обрезки, без шторок и затемнений; тосты уходят вниз, пока плеер на экране (есть e2e-тест).
* Нет фонового режима и отделения звука: плеер ставится на паузу, если виден меньше чем наполовину, если Mini App свёрнут или скрыт,
  и уничтожается при уходе с экрана. Мини-плеера для YouTube нет, кнопки экрана блокировки им не управляют.
* Автозапуск следующего видео — только во включённом пользователем «Резонансе», только при видимости больше 50 % и через официальный API.
  В обычных списках следующее видео запускает пользователь.
* Ничего не скачивается и не кэшируется из аудио/видео; `getStream()` YouTube всегда `null`, `/api/stream-url` для YouTube отвечает 400.
* Результаты YouTube — отдельная секция поиска с подписью и ссылкой на YouTube, никогда не смешиваются с другими источниками
  (YouTube не участвует в общих списках, чартах, подборках). Названия и имена каналов показываются как отдаёт API.
* Статистика YouTube не запрашивается вообще: `popularity` YouTube-треков — постоянные 0,5, рекомендации — только по действиям в AURIS.
* Данные YouTube в БД живут ≤ 30 дней: каждые 12 часов `YouTubeRetention` обновляет снимки старше `YOUTUBE_DATA_MAX_AGE_DAYS` (29) через
  `videos.list`; удалённые, скрытые, невстраиваемые и заблокированные в регионе видео удаляются из снимков, избранного, плейлистов,
  истории и Слуха; если обновить нельзя (квота), данные старше 30 дней удаляются.
* Made for Kids: `status.madeForKids` проверяется у каждого видео; такие видео открываются на `youtube-nocookie.com`, действия
  с ними не сохраняются и в «Резонанс» они не попадают.
* Перед использованием пользователь принимает условия AURIS (со ссылкой на Условия YouTube и согласием с ними) и политику
  конфиденциальности (с упоминанием YouTube API Services и ссылкой на Политику Google) — в Mini App и в боте (`/start`).
  Без этого API отвечает `TERMS_REQUIRED`.
* Логин и пароль YouTube не запрашиваются; YouTube в название приложения не входит.

## Jamendo

Только некоммерческое использование. Лицензия проверяется у каждого трека: без распознанной лицензии Creative Commons трек отключён.
Под плеером — автор, ссылка на текст лицензии и ссылка на страницу трека на Jamendo. Скачивание не предлагается.

## Безопасность

* Каждый запрос Mini App несёт `Authorization: tma <initData>`; сервер проверяет HMAC-подпись и срок `auth_date`. `initDataUnsafe` не используется.
* Webhook: обновления без верного `X-Telegram-Bot-Api-Secret-Token` отклоняются (тест есть).
* Rate limit, Zod-валидация всех входов, лимиты тела и файлов, CORS только для `MINI_APP_URL`, CSP для страниц Mini App.
* Аудио Jamendo идёт через API по коротким подписанным ссылкам — `client_id` и ключи не попадают на клиент. Ключ YouTube используется только сервером.
* Записи Слуха живут в памяти на время распознавания и удаляются; тела запросов не логируются. Кэшируется только хеш записи и результат.

## «Резонанс»

`apps/api/src/reco/weights.ts` — все веса; `scoring.ts` — объяснимый скоринг; тесты — `scoring.test.ts`, `api.test.ts`, `player.test.ts`.
Кандидаты: чарты и жанры Jamendo, теги настроения Jamendo, топ любимых артистов, выбор при онбординге (жанры + 3 артиста), избранное;
для YouTube — поисковые запросы по артистам и жанрам, которые пользователь выбрал или лайкнул, и музыкальный чарт YouTube.
«Похожих видео» Data API не даёт — их не имитируем. Сигналы с затуханием 14 дней: лайк +3, прослушивание +1, повтор +1,5,
в плейлист +2, Слух +1,5, ранний пропуск −1,5, поздний −0,2, дизлайк −4. Режимы: «Любимое» ближе к вкусу, «Открытия» — новые артисты,
«Микс» — баланс. Один артист не чаще раза на 3 трека, недавнее не повторяется, лайк/дизлайк перестраивают очередь сразу.
Источник каждого трека виден в очереди. Сброс рекомендаций и полное удаление данных — в настройках и `/settings` (удаляются сразу;
данные на YouTube это не затрагивает).

## Воспроизведение в фоне

Видео YouTube не играют в фоне по правилам YouTube. Треки Jamendo играют через `<audio>` с Media Session; на iOS WKWebView обычно
останавливает звук при сворачивании Telegram, на Android поведение зависит от версии Telegram.
