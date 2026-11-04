import { describe, expect, it } from 'vitest';
import type { Update } from 'grammy/types';
import type { Recognition, Track } from '@auris/shared';
import type { AurisApi } from './api-client.js';

import { appUrl, createBot, recognitionMessage, trackKeyboard } from './bot.js';

const track = (id: string, kind: 'full' | 'preview' = 'full'): Track => ({
  id, provider: 'mock', title: 'Песня ' + id, artist: { id: 'mock:a', name: 'Артист' }, durationSec: 200, genres: [], tags: [], popularity: 0.5,
  playback: { kind, playableSec: kind === 'preview' ? 30 : 200, qualities: [] }, license: { name: 'CC0' },
});

function harness(api: Partial<AurisApi> = {}) {
  const calls: { method: string; payload: Record<string, unknown> }[] = [];
  const fake: AurisApi = {
    touchUser: async () => {}, liked: async () => [track('mock:t1'), track('deezer:1', 'preview')], termsAccepted: async () => true, acceptTerms: async () => {},
    like: async () => {}, recognize: async () => { throw new Error('x'); },
    resetRecommendations: async () => {}, deleteUser: async () => {},
    playlistInvite: async (t: string) => (t === 'goodtoken123' ? { title: 'Дорога', owner: 'Аня', trackCount: 4 } : null), ...api,
  };
  const bot = createBot(fake, {
    token: '1:x', miniAppUrl: 'https://app.auris.test',
    botInfo: { id: 1, is_bot: true, first_name: 'AURIS', username: 'auris_bot', can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false } as never,
  });
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    return { ok: true, result: method === 'sendMessage' ? { message_id: 1, chat: { id: 5 }, date: 0 } : true } as never;
  });
  const from = { id: 5, is_bot: false, first_name: 'Ада' };
  const chat = { id: 5, type: 'private' as const, first_name: 'Ада' };
  const text = (t: string): Update => ({ update_id: 1, message: { message_id: 1, date: 0, chat, from, text: t, entities: t.startsWith('/') ? [{ type: 'bot_command', offset: 0, length: t.split(' ')[0]!.length }] : [] } });
  const cb = (data: string): Update => ({ update_id: 2, callback_query: { id: 'q', from, chat_instance: 'c', data, message: { message_id: 1, date: 0, chat, text: 'x' } } });
  return { bot, calls, text, cb };
}

describe('bot', () => {
  it('/start asks a new user to accept the terms (AURIS + YouTube ToS + Google Privacy) first', async () => {
    const accepted: number[] = [];
    const h = harness({ termsAccepted: async () => false, acceptTerms: async (id) => { accepted.push(id); } });
    await h.bot.handleUpdate(h.text('/start'));
    const text = String(h.calls[0]!.payload.text);
    expect(text).toContain('https://www.youtube.com/t/terms');
    expect(text).toContain('https://policies.google.com/privacy');
    expect(text).toContain('https://app.auris.test/privacy.html');
    expect(JSON.stringify(h.calls[0]!.payload.reply_markup)).not.toContain('web_app');
    await h.bot.handleUpdate(h.cb('terms!'));
    expect(accepted).toEqual([5]);
    expect(JSON.stringify(h.calls.at(-1)!.payload.reply_markup)).toContain('web_app');
  });
  it('/start replies with a Mini App button', async () => {
    const h = harness();
    await h.bot.handleUpdate(h.text('/start'));
    const kb = (h.calls[0]!.payload.reply_markup as { inline_keyboard: { web_app?: { url: string } }[][] }).inline_keyboard;
    expect(kb[0]![0]!.web_app!.url).toBe('https://app.auris.test/');
  });
  it('/start with a playlist invite offers to open it', async () => {
    const h = harness();
    await h.bot.handleUpdate(h.text('/start pl_goodtoken123'));
    expect(String(h.calls[0]!.payload.text)).toContain('Аня');
    expect(String(h.calls[0]!.payload.text)).toContain('Дорога');
    expect(JSON.stringify(h.calls[0]!.payload.reply_markup)).toContain('join=goodtoken123');
    await h.bot.handleUpdate(h.text('/start pl_badtoken0000'));
    expect(String(h.calls[1]!.payload.text)).toContain('больше не действует');
  });
  it('/wave opens the wave screen', async () => {
    const h = harness();
    await h.bot.handleUpdate(h.text('/wave'));
    expect(JSON.stringify(h.calls[0]!.payload)).toContain('screen=wave');
  });
  it('/search opens the Mini App with the results instead of sending anything', async () => {
    const h = harness();
    await h.bot.handleUpdate(h.text('/search ночь'));
    const flat = JSON.stringify(h.calls[0]!.payload.reply_markup);
    expect(flat).toContain('screen=search');
    expect(flat).toContain('q=%D0%BD%D0%BE%D1%87%D1%8C');
  });
  it('/liked lists favourites with open buttons and no download buttons', async () => {
    const h = harness();
    await h.bot.handleUpdate(h.text('/liked'));
    expect(String(h.calls[0]!.payload.text)).toContain('превью 30 с');
    const flat = JSON.stringify(h.calls[0]!.payload.reply_markup);
    expect(flat).toContain('track=mock%3At1');
    expect(flat).not.toMatch(/dl:|Скачать/);
    expect(h.calls.some((c) => c.method === 'sendAudio' || c.method === 'sendDocument')).toBe(false);
  });
  it('/settings offers reset and delete with confirmation', async () => {
    const deleted: number[] = [];
    const h = harness({ deleteUser: async (id) => { deleted.push(id); } });
    await h.bot.handleUpdate(h.text('/settings'));
    expect(JSON.stringify(h.calls[0]!.payload.reply_markup)).toContain('"del"');
    await h.bot.handleUpdate(h.cb('del'));
    expect(deleted).toEqual([]);
    await h.bot.handleUpdate(h.cb('del!'));
    expect(deleted).toEqual([5]);
  });
  it('ignores group chats', async () => {
    const h = harness();
    await h.bot.handleUpdate({ update_id: 3, message: { message_id: 1, date: 0, chat: { id: -1, type: 'group', title: 'g' }, from: { id: 5, is_bot: false, first_name: 'A' }, text: '/start', entities: [{ type: 'bot_command', offset: 0, length: 6 }] } });
    expect(h.calls).toHaveLength(0);
  });
});

describe('formatting', () => {
  it('builds app urls', () => {
    expect(appUrl('https://a.test/app', { track: 'mock:t1' })).toBe('https://a.test/app?track=mock%3At1');
  });
  it('recognition offers "Найти на YouTube" (never autoplays) and "В избранное" for catalogue matches', () => {
    const r: Recognition = { id: '1', title: 'X', artist: 'Y', source: 'bot', createdAt: '' };
    const m = recognitionMessage(r, 'https://a.test');
    const flat = m.keyboard.inline_keyboard.flat();
    expect(flat.map((b) => b.text)).toEqual(['Найти на YouTube']);
    expect(JSON.stringify(flat)).toContain('source=youtube');
    const withTrack = recognitionMessage({ ...r, track: track('mock:t1') }, 'https://a.test').keyboard.inline_keyboard.flat().map((b) => b.text);
    expect(withTrack).toEqual(['Найти на YouTube', '▶ Слушать в AURIS', '♥ В избранное']);
  });
  it('keyboard rows', () => {
    expect(trackKeyboard([track('mock:t1')], 'http://localhost').inline_keyboard[0]).toHaveLength(1);
  });
});

describe('webhook', () => {
  it('rejects updates without the X-Telegram-Bot-Api-Secret-Token header', async () => {
    const { default: Fastify } = await import('fastify');
    const { webhookCallback } = await import('grammy');
    const h = harness();
    const app = Fastify();
    app.post('/telegram/webhook', webhookCallback(h.bot, 'fastify', { secretToken: 'top-secret' }));
    const update = h.text('/start');
    const bad = await app.inject({ method: 'POST', url: '/telegram/webhook', payload: update });
    expect(bad.statusCode).toBe(401);
    const wrong = await app.inject({ method: 'POST', url: '/telegram/webhook', payload: update, headers: { 'x-telegram-bot-api-secret-token': 'nope' } });
    expect(wrong.statusCode).toBe(401);
    expect(h.calls).toHaveLength(0);
    const ok = await app.inject({ method: 'POST', url: '/telegram/webhook', payload: update, headers: { 'x-telegram-bot-api-secret-token': 'top-secret' } });
    expect(ok.statusCode).toBe(200);
    expect(h.calls[0]!.method).toBe('sendMessage');
    await app.close();
  });
});
