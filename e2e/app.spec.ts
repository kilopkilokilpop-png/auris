import { expect, test, type Page } from '@playwright/test';

const open = async (page: Page, uid: number, extra = '') => {
  await page.goto(`/?uid=${uid}${extra}`);
  await expect(page.getByRole('tab', { name: 'Главная' })).toBeVisible();
};
const audioState = (page: Page) =>
  page.evaluate(() => {
    const a = document.querySelector('audio')!;
    return { paused: a.paused, t: a.currentTime, src: a.src };
  });

test('home shows real data, no mockup placeholders', async ({ page }) => {
  await open(page, 2001);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Доброе утро|Добрый день|Добрый вечер|Доброй ночи/);
  await expect(page.getByText('Выбор редакции')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Полярный свет' })).toBeVisible();
  // Real data: the album has 24-bit tracks, so the badge is legit.
  await expect(page.getByText('HI-RES · 24 БИТ')).toBeVisible();
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/\[(Название|Исполнитель|N|Имя)/);
});

test('global player survives navigation; Media Session gets metadata', async ({ page }) => {
  await open(page, 2002);
  await page.getByRole('button', { name: 'Слушать Полярный свет' }).click();
  const mini = page.getByRole('region', { name: 'Сейчас играет' });
  await expect(mini).toContainText('Магнитное поле');
  await expect.poll(async () => (await audioState(page)).t, { timeout: 15_000 }).toBeGreaterThan(0.5);
  await page.getByRole('tab', { name: 'Резонанс' }).click();
  await page.getByRole('tab', { name: 'Профиль' }).click();
  await page.getByRole('tab', { name: 'Слух' }).click();
  const s = await audioState(page);
  expect(s.paused).toBe(false);
  expect(s.src).toMatch(/\/api\/stream\//);
  expect(await page.evaluate(() => navigator.mediaSession.metadata?.title)).toBe('Магнитное поле');
  // Full player
  await mini.getByRole('button', { name: /Открыть плеер/ }).click();
  const player = page.getByRole('dialog', { name: 'Плеер' });
  await expect(player.getByText('Играет из')).toBeVisible();
  await expect(player.getByText('MP3 · 192')).toBeVisible();
  await player.getByRole('button', { name: 'Следующий' }).click();
  await expect(player.getByRole('heading', { level: 1 })).toHaveText('Ледяной гул');
  await player.getByRole('button', { name: 'Свернуть плеер' }).click();
  await expect(player).toBeHidden();
});

test('quality switch: Hi-Res uses a real 24/96 FLAC stream', async ({ page }) => {
  await open(page, 2003);
  await page.getByRole('radio', { name: 'Hi-Res' }).click();
  await expect(page.getByText('Hi-Res, до 24 бит / 96 кГц')).toBeVisible();
  await page.getByRole('button', { name: 'Слушать Полярный свет' }).click();
  await page.getByRole('button', { name: /Открыть плеер/ }).click();
  await expect(page.getByRole('dialog', { name: 'Плеер' }).getByText('HI-RES · 24/96')).toBeVisible();
});

test('search: results, recent queries, track menu with honest download state', async ({ page }) => {
  await open(page, 2004);
  await page.getByRole('button', { name: 'Поиск' }).click();
  await expect(page.getByRole('heading', { name: 'Популярное сейчас' })).toBeVisible();
  const searched = page.waitForResponse((r) => r.url().includes('/api/search?q='));
  await page.getByRole('searchbox').fill('напряжение');
  await searched;
  await expect(page.getByRole('heading', { name: 'Треки' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Высокое напряжение,/ })).toBeVisible();
  await page.getByRole('searchbox').fill('zzzzqqq');
  await expect(page.getByText('Ничего не нашлось')).toBeVisible();
  await page.getByRole('button', { name: 'Очистить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'напряжение', exact: true })).toBeVisible();
  // Track menu: download goes through the server; without a bot token we get a clear message.
  await page.getByRole('button', { name: 'Действия: Тихий час' }).click();
  const sheet = page.getByRole('dialog', { name: 'Действия с треком' });
  await expect(sheet.getByText('Скачать в Telegram')).toBeVisible();
  await sheet.getByText('Скачать в Telegram').click();
  await expect(page.getByRole('status').filter({ hasText: /BOT_TOKEN|Бот ещё не настроен/ })).toBeVisible();
});

test('likes show up in profile with real counters', async ({ page }) => {
  await open(page, 2005, '&master=1');
  await page.getByRole('button', { name: 'Поиск' }).click();
  await page.getByRole('button', { name: 'Действия: Ток' }).click();
  await page.getByRole('dialog').getByText('В избранное').click();
  await page.getByRole('tab', { name: 'Профиль' }).click();
  await expect(page.getByText('AURIS MASTER')).toBeVisible();
  await expect(page.locator('.stat').first()).toContainText('1');
  await expect(page.getByRole('button', { name: /^Ток, Мира Вольт/ })).toBeVisible();
});

test('Резонанс: onboarding, endless queue, like changes the queue immediately', async ({ page }) => {
  await open(page, 2006);
  await page.getByRole('tab', { name: 'Резонанс' }).click();
  await page.getByRole('button', { name: 'Запустить Резонанс' }).click();
  await expect(page.getByRole('heading', { name: 'Что вы любите слушать?' })).toBeVisible();
  await page.getByRole('button', { name: 'Джаз' }).click();
  await page.getByRole('button', { name: 'Дальше' }).click();
  for (const a of ['Koda Brass', 'Velvet Static', 'Lumen Field']) await page.getByRole('button', { name: new RegExp(a) }).click();
  const first = page.waitForResponse((r) => r.url().includes('/api/wave/next'));
  await page.getByRole('button', { name: /Запустить Резонанс \(3\/3\)/ }).click();
  const body = await (await first).json();
  const artists = body.items.map((i: { track: { artist: { name: string } } }) => i.track.artist.name);
  expect(artists.slice(0, 3).some((a: string) => ['Koda Brass', 'Velvet Static', 'Lumen Field'].includes(a))).toBe(true);
  // No two neighbours by the same artist
  for (let i = 1; i < artists.length; i++) expect(artists[i]).not.toBe(artists[i - 1]);
  await expect(page.getByText('Резонанс играет')).toBeVisible({ timeout: 15_000 });

  const refreshed = page.waitForResponse((r) => r.url().includes('/api/wave/next'));
  await page.locator('.wave-now').getByRole('button', { name: 'Нравится', exact: true }).click();
  const after = await (await refreshed).json();
  expect(after.items.length).toBeGreaterThan(0);
  // Mood switch rebuilds what comes next without stopping playback
  const moodResp = page.waitForResponse((r) => r.url().includes('/api/wave/next'));
  await page.getByRole('radio', { name: 'Для спорта' }).click();
  const moodBody = await (await moodResp).json();
  expect(moodBody.items[0].reasons.join(' ')).toMatch(/настроение|нравится|Популярно|Новый|Жанр|выбрали/);
  expect((await audioState(page)).paused).toBe(false);
});

test('Слух: records from the (fake) microphone and shows the result with actions', async ({ page }) => {
  await open(page, 2007);
  await page.getByRole('tab', { name: 'Слух' }).click();
  await page.getByRole('button', { name: 'Распознать песню' }).click();
  await expect(page.getByText('Слушаю…')).toBeVisible();
  const req = page.waitForRequest((r) => r.url().includes('/api/recognize'), { timeout: 20_000 });
  const r = await req;
  expect(r.headers()['content-type']).toMatch(/multipart\/form-data/);
  await expect(page.getByText('Найдено')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: /^Слушать/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /В избранное/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Скачать в Telegram' })).toBeVisible();
  await page.getByRole('button', { name: 'Распознать ещё' }).click();
  await expect(page.getByText('Недавно найденные')).toBeVisible();
  await expect(page.locator('.list .row')).toHaveCount(1);
});

test('Слух: denied microphone explains the bot fallback', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('no', 'NotAllowedError'));
  });
  await open(page, 2008);
  await page.getByRole('tab', { name: 'Слух' }).click();
  await page.getByRole('button', { name: 'Распознать песню' }).click();
  await expect(page.getByText('Нет доступа к микрофону')).toBeVisible();
  await expect(page.getByRole('button', { name: /Отправить голосовое боту/ })).toBeVisible();
});

test('settings: reset recommendations and delete all data', async ({ page }) => {
  await open(page, 2009);
  await page.getByRole('tab', { name: 'Профиль' }).click();
  await page.getByRole('button', { name: 'Настройки' }).click();
  await expect(page.getByRole('heading', { name: 'Настройки' })).toBeVisible();
  await expect(page.getByText('Демо-каталог AURIS')).toBeVisible();
  await page.getByRole('button', { name: /Сбросить рекомендации/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Сбросить' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Рекомендации сброшены' })).toBeVisible();
  await page.getByRole('button', { name: /Удалить все мои данные/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Удалить навсегда' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Данные удалены' })).toBeVisible();
});

test('forbidden download is refused by the API even when called directly', async ({ page, request }) => {
  await open(page, 2010);
  const initData = await page.evaluate(async () => (await (await fetch('/api/dev/init-data?id=2010')).json()).initData as string);
  const r = await request.post('/api/downloads', { headers: { authorization: `tma ${initData}` }, data: { trackId: 'deezer:3135556' } });
  // Not in the active catalogue (mock only) -> 404; with Deezer enabled -> 403 DOWNLOAD_FORBIDDEN (see API tests).
  expect([403, 404]).toContain(r.status());
  const unauth = await request.post('/api/downloads', { data: { trackId: 'mock:t1' } });
  expect(unauth.status()).toBe(401);
});

test('volume and like work from the mini player, download sits in the full player', async ({ page }) => {
  await open(page, 2101);
  await page.getByRole('button', { name: 'Слушать Полярный свет' }).click();
  const mini = page.getByRole('region', { name: 'Сейчас играет' });
  await expect(mini).toContainText('Магнитное поле');
  // Like without opening the player
  await mini.getByRole('button', { name: 'В избранное' }).click();
  await expect(mini.getByRole('button', { name: 'Убрать из избранного' })).toBeVisible();
  // Volume without opening the player
  await mini.getByRole('button', { name: 'Громкость' }).click();
  const vol = page.getByRole('dialog', { name: 'Громкость' });
  await vol.getByRole('button', { name: 'Тише' }).click();
  await vol.getByRole('button', { name: 'Тише' }).click();
  await expect.poll(() => page.evaluate(() => document.querySelector('audio')!.volume)).toBeCloseTo(0.8, 2);
  await vol.getByRole('button', { name: 'Громче' }).click();
  await expect.poll(() => page.evaluate(() => document.querySelector('audio')!.volume)).toBeCloseTo(0.9, 2);
  // Full player: volume slider + download button
  await mini.getByRole('button', { name: /Открыть плеер/ }).click();
  const player = page.getByRole('dialog', { name: 'Плеер' });
  await expect(player.getByRole('group', { name: 'Громкость' })).toBeVisible();
  await player.getByRole('button', { name: 'Скачать в Telegram' }).click();
  // No bot token in this test run: the server explains instead of failing silently.
  await expect(page.getByRole('status').filter({ hasText: /Бот ещё не настроен|BOT_TOKEN/ })).toBeVisible();
});

test('curated collections open from home', async ({ page }) => {
  await open(page, 2102);
  await page.getByRole('heading', { name: 'Подборки' }).scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: /Спокойствие/ }).click();
  await expect(page.getByRole('main', { name: 'Подборка' }).getByRole('heading', { name: 'Спокойствие' })).toBeVisible();
  await expect(page.getByRole('main', { name: 'Подборка' }).locator('.list .row').first()).toBeVisible();
});

test('playlists: create, add a track, invite friends, a friend joins by link', async ({ page, browser }) => {
  await open(page, 2103);
  await page.getByRole('tab', { name: 'Профиль' }).click();
  await page.getByRole('radio', { name: 'Плейлисты' }).click();
  await page.getByPlaceholder('Новый плейлист').fill('Дорога домой');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  const pl = page.getByRole('main', { name: 'Плейлист' });
  await expect(pl.getByRole('heading', { name: 'Дорога домой' })).toBeVisible();
  await expect(pl.getByText('Ваш плейлист')).toBeVisible();
  await expect(pl.getByText('Пока пусто')).toBeVisible();
  // Add a track from search
  await page.getByRole('button', { name: 'Назад' }).click();
  await page.getByRole('tab', { name: 'Главная' }).click();
  await page.getByRole('button', { name: 'Поиск' }).click();
  await page.getByRole('button', { name: 'Действия: Тихий час' }).click();
  await page.getByRole('dialog').getByText('Добавить в плейлист').click();
  await page.getByRole('dialog').getByRole('button', { name: /Дорога домой/ }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Добавлено в «Дорога домой»' })).toBeVisible();

  // Invite link (server side) and a second user joining through the deep link
  const auth = async (uid: number) => `tma ${await page.evaluate(async (id) => (await (await fetch(`/api/dev/init-data?id=${id}`)).json()).initData as string, uid)}`;
  const list = await (await page.request.get('/api/playlists', { headers: { authorization: await auth(2103) } })).json();
  const pid = list.playlists[0].id as string;
  const { token, link } = await (await page.request.post(`/api/playlists/${pid}/invite`, { headers: { authorization: await auth(2103) } })).json();
  expect(link).toContain(token);

  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const friend = await ctx2.newPage();
  await friend.goto(`/?uid=2104&join=${token}`);
  const sheet = friend.getByRole('dialog', { name: 'Плейлист «Дорога домой»' });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'Присоединиться' }).click();
  const fpl = friend.getByRole('main', { name: 'Плейлист' });
  await expect(fpl.getByText(/Совместный · 2 участника/)).toBeVisible();
  await expect(fpl.getByRole('button', { name: /^Тихий час,/ })).toBeVisible();
  // A friend cannot remove the owner's track (no remove button), the owner can
  await expect(fpl.getByRole('button', { name: 'Убрать из плейлиста: Тихий час' })).toHaveCount(0);
  await ctx2.close();
});
