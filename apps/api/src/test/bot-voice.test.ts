import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import { HttpAurisApi } from '../../../bot/src/api-client.js';
import { createBot } from '../../../bot/src/bot.js';
import { makeApp } from './helpers.js';

/** Bot -> internal API over real HTTP. Only Telegram itself is faked. */
const ctx = await makeApp();
let base = '';
beforeAll(async () => {
  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(ctx.app.server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await ctx.app.close();
});

const voicePath = path.join(os.tmpdir(), 'auris-voice.ogg');
if (!fs.existsSync(voicePath)) execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=523:duration=8', '-c:a', 'libopus', voicePath]);

describe('Слух via bot voice message', () => {
  it('recognises a voice note, replies with actions, and the download button sends audio', async () => {
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', (async (url: string | URL, init?: RequestInit) =>
      String(url).startsWith('https://api.telegram.org/file/') ? new Response(fs.readFileSync(voicePath)) : realFetch(url, init)) as typeof fetch);

    const bot = createBot(new HttpAurisApi(base, 'internal-secret'), {
      token: '1:x',
      miniAppUrl: 'https://app.auris.test',
      botInfo: { id: 1, is_bot: true, first_name: 'AURIS', username: 'auris_bot', can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false } as never,
    });
    const calls: { method: string; payload: Record<string, unknown> }[] = [];
    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload: payload as Record<string, unknown> });
      if (method === 'getFile') return { ok: true, result: { file_id: 'F', file_unique_id: 'U', file_path: 'voice/file_1.oga' } } as never;
      return { ok: true, result: { message_id: 10, date: 0, chat: { id: 4242, type: 'private' } } } as never;
    });
    const from = { id: 4242, is_bot: false, first_name: 'Ада' };
    const chat = { id: 4242, type: 'private' as const, first_name: 'Ада' };
    await bot.handleUpdate({ update_id: 1, message: { message_id: 1, date: 0, chat, from, voice: { file_id: 'F', file_unique_id: 'U', duration: 8, mime_type: 'audio/ogg', file_size: fs.statSync(voicePath).size } } });

    const edit = calls.find((c) => c.method === 'editMessageText')!;
    expect(edit, JSON.stringify(calls)).toBeTruthy();
    expect(String(edit.payload.text)).toMatch(/🎧/);
    const buttons = JSON.stringify(edit.payload.reply_markup);
    const dl = /"dl:(mock:t\d+)"/.exec(buttons);
    expect(dl).toBeTruthy();
    const hist = await ctx.db.query<{ source: string }>('SELECT source FROM recognitions WHERE user_id=4242');
    expect(hist.rows[0]!.source).toBe('bot');

    // Press "⬇ Скачать в Telegram"
    await bot.handleUpdate({ update_id: 2, callback_query: { id: 'q', from, chat_instance: 'c', data: `dl:${dl![1]}`, message: { message_id: 10, date: 0, chat, text: 'x' } } });
    const sent = ctx.sender.calls.at(-1)!;
    expect(sent.chatId).toBe(4242);
    expect(sent.meta.caption).toMatch(/CC0/);
  });
});
