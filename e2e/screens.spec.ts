import { expect, test, type Page } from '@playwright/test';

/**
 * Screenshots at 390x844 @2x — the mockups in design/ are 780x1688.
 * State is prepared to mirror the mockups (Hi-Res selected, MASTER flag, liked tracks, history),
 * but every value is real data from the API.
 */
const OUT = 'screenshots';
const UID = 3001;

async function prepare(page: Page) {
  await page.goto(`/?uid=${UID}&master=1`);
  await expect(page.getByRole('tab', { name: 'Главная' })).toBeVisible();
  const auth = await page.evaluate(async (uid) => (await (await fetch(`/api/dev/init-data?id=${uid}&master=1`)).json()).initData as string, UID);
  const call = async (method: string, url: string, body?: unknown) => {
    const r = await page.request.fetch(url, { method, headers: { authorization: `tma ${auth}`, ...(body ? { 'content-type': 'application/json' } : {}) }, data: body });
    expect(r.ok(), `${method} ${url}: ${await r.text()}`).toBe(true);
  };
  await call('PATCH', '/api/me/settings', { quality: 'hires' });
  for (const id of ['mock:t4', 'mock:t1', 'mock:t17', 'mock:t9']) await call('POST', `/api/likes/${id}`);
  for (const id of ['mock:t6', 'mock:t1']) await call('POST', '/api/events', { trackId: id, kind: 'play_start' });
  await call('POST', '/api/playlists', { title: 'Вечер' });
  await call('POST', '/api/playlists', { title: 'Фокус' });
  await call('POST', '/api/events', { trackId: 'mock:t1', kind: 'play_complete', listenedSec: 3 * 3600 + 1200 });
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Главная' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

const shot = (page: Page, name: string) => page.screenshot({ path: `${OUT}/${name}.png`, animations: 'disabled' });

test('screens for design comparison', async ({ page }) => {
  await prepare(page);
  await expect(page.getByRole('button', { name: /Тихий час/ })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await shot(page, 'home');

  await page.getByRole('tab', { name: 'Резонанс' }).click();
  await page.getByText('Нажмите, чтобы начать').waitFor();
  await shot(page, 'wave');

  await page.getByRole('tab', { name: 'Слух' }).click();
  await page.getByText('Нажмите, и Auris послушает').waitFor();
  // Seed "Недавно найденные" through the real recording flow (fake mic).
  await page.getByRole('button', { name: 'Распознать песню' }).click();
  await page.getByText('Найдено').waitFor({ timeout: 25_000 });
  await shot(page, 'hear-result');
  await page.getByRole('button', { name: 'Распознать ещё' }).click();
  await page.locator('.list .row').first().waitFor();
  await shot(page, 'hear');

  await page.getByRole('tab', { name: 'Профиль' }).click();
  await page.getByText('AURIS MASTER').waitFor();
  await page.locator('.list .row').nth(3).waitFor();
  await shot(page, 'profile');

  await page.getByRole('tab', { name: 'Главная' }).click();
  await page.getByRole('button', { name: 'Слушать Полярный свет' }).click();
  await page.getByRole('region', { name: 'Сейчас играет' }).waitFor();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /Открыть плеер/ }).click();
  await page.getByRole('dialog', { name: 'Плеер' }).getByText('HI-RES · 24/96').waitFor();
  await page.evaluate(() => {
    const a = document.querySelector('audio')!;
    a.pause();
    a.currentTime = 17;
  });
  await page.waitForTimeout(300);
  await shot(page, 'player');
  await page.getByRole('button', { name: 'Свернуть плеер' }).click();
  await shot(page, 'home-miniplayer');

  await page.getByRole('button', { name: 'Поиск' }).click();
  await page.getByRole('heading', { name: 'Популярное сейчас' }).waitFor();
  await page.waitForLoadState('networkidle');
  await shot(page, 'search');
  await page.getByRole('searchbox').fill('Север');
  await page.getByRole('heading', { name: 'Треки' }).waitFor();
  await shot(page, 'search-results');
  await page.getByRole('button', { name: /Действия: Магнитное поле/ }).click();
  await shot(page, 'track-menu');
});

test('screens: new features (volume, collections, shared playlist)', async ({ page }) => {
  await page.goto('/?uid=3002');
  await expect(page.getByRole('tab', { name: 'Главная' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole('heading', { name: 'Подборки' }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await shot(page, 'home-collections');
  await page.getByRole('button', { name: /^Слушать Полярный свет/ }).click({ force: true });
  const mini = page.getByRole('region', { name: 'Сейчас играет' });
  await mini.getByRole('button', { name: 'Громкость' }).click();
  await page.waitForTimeout(300);
  await shot(page, 'mini-volume');
  await mini.getByRole('button', { name: 'Громкость' }).click();
  await mini.getByRole('button', { name: /Открыть плеер/ }).click();
  await page.getByRole('dialog', { name: 'Плеер' }).getByRole('group', { name: 'Громкость' }).waitFor();
  await page.evaluate(() => document.querySelector('audio')!.pause());
  await page.waitForTimeout(400);
  await shot(page, 'player-volume');
  await page.getByRole('button', { name: 'Свернуть плеер' }).click();
  const authz = `tma ${await page.evaluate(async () => (await (await fetch('/api/dev/init-data?id=3002')).json()).initData as string)}`;
  const friend = `tma ${await page.evaluate(async () => (await (await fetch('/api/dev/init-data?id=3003&name=Борис&last=К')).json()).initData as string)}`;
  const { id } = await (await page.request.post('/api/playlists', { headers: { authorization: authz, 'content-type': 'application/json' }, data: { title: 'Дорога домой' } })).json();
  for (const t of ['mock:t6', 'mock:t1', 'mock:t20']) await page.request.post(`/api/playlists/${id}/tracks`, { headers: { authorization: authz, 'content-type': 'application/json' }, data: { trackId: t } });
  const { token } = await (await page.request.post(`/api/playlists/${id}/invite`, { headers: { authorization: authz } })).json();
  await page.request.post('/api/playlists/join', { headers: { authorization: friend, 'content-type': 'application/json' }, data: { token } });
  await page.request.post(`/api/playlists/${id}/tracks`, { headers: { authorization: friend, 'content-type': 'application/json' }, data: { trackId: 'mock:t10' } });
  await page.getByRole('tab', { name: 'Профиль' }).click();
  await page.getByRole('radio', { name: 'Плейлисты' }).click();
  await page.getByRole('button', { name: /Дорога домой/ }).click();
  await page.getByRole('main', { name: 'Плейлист' }).getByText('Совместный · 2 участника').waitFor();
  await page.waitForTimeout(400);
  await shot(page, 'playlist-shared');
});
