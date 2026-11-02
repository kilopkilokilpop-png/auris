import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { TELEGRAM_SEND_MAX_BYTES, type Track } from '@auris/shared';
import { AppError } from '../lib/errors.js';
import { makeThumbnail } from '../lib/ffmpeg.js';
import type { CompositeProvider } from '../providers/music/registry.js';
import type { Store } from './store.js';
import { TelegramSendError, type TelegramSender } from './telegram.js';

/** Minimal FIFO with bounded concurrency and spacing between sends (Bot API: ~30 msg/s overall). */
export class JobQueue {
  private active = 0;
  private waiting: (() => void)[] = [];
  private last = 0;
  constructor(
    private readonly concurrency: number,
    private readonly minIntervalMs = 60,
    readonly maxWaiting = 200,
  ) {}
  get size() {
    return this.waiting.length + this.active;
  }
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.waiting.length >= this.maxWaiting) throw new AppError('RATE_LIMITED', 'Очередь отправки переполнена, попробуйте через минуту', 429, { retryAfterSec: 60 });
    if (this.active >= this.concurrency) await new Promise<void>((r) => this.waiting.push(r));
    this.active++;
    try {
      const gap = this.last + this.minIntervalMs - Date.now();
      if (gap > 0) await new Promise((r) => setTimeout(r, gap));
      this.last = Date.now();
      return await fn();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
}

export interface DownloadDeps {
  music: CompositeProvider;
  store: Store;
  sender: TelegramSender | null;
  botUsername?: string;
  perDay: number;
  concurrency: number;
  ffmpeg: string;
  /** Resolves relative cover URLs (demo media served by this API) to a local file. */
  localCover?: (url: string) => Promise<string | null>;
}

async function fetchToFile(url: string, dest: string, maxBytes: number): Promise<number> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok || !res.body) throw new AppError('PROVIDER_UNAVAILABLE', 'Источник файла недоступен', 502);
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > maxBytes) throw new AppError('FILE_TOO_LARGE', 'Файл больше 50 МБ — Telegram не позволяет ботам отправлять такие файлы', 413);
  let seen = 0;
  const guard = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctrl) {
      seen += chunk.byteLength;
      if (seen > maxBytes) ctrl.error(new AppError('FILE_TOO_LARGE', 'Файл больше 50 МБ — Telegram не позволяет ботам отправлять такие файлы', 413));
      else ctrl.enqueue(chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body.pipeThrough(guard) as never), createWriteStream(dest, { mode: 0o600 }));
  return seen;
}

export class DownloadService {
  private queue: JobQueue;
  constructor(private readonly d: DownloadDeps) {
    this.queue = new JobQueue(d.concurrency);
  }

  botLink(payload = 'download') {
    return this.d.botUsername ? `https://t.me/${this.d.botUsername}?start=${payload}` : undefined;
  }

  /** Server-side, per-track decision. Revoked rights also purge the cached file_id. */
  async check(trackId: string) {
    const decision = await this.d.music.getDownload(trackId);
    if (!decision.allowed) await this.d.store.dropFileId(trackId);
    return decision;
  }

  async send(userId: number, track: Track): Promise<{ status: 'sent'; cached: boolean }> {
    const decision = await this.check(track.id);
    if (!decision.allowed) throw new AppError('DOWNLOAD_FORBIDDEN', decision.reason, 403);
    if (!this.d.sender) throw new AppError('BOT_NOT_CONFIGURED', 'Бот ещё не настроен на сервере (нет BOT_TOKEN)', 503);
    const used = await this.d.store.bumpUsage(userId, 'download');
    if (used > this.d.perDay) {
      await this.d.store.unbumpUsage(userId, 'download');
      throw new AppError('DOWNLOAD_QUOTA', `Лимит — ${this.d.perDay} скачиваний в сутки. Попробуйте завтра.`, 429);
    }
    const sender = this.d.sender;
    try {
      const out = await this.queue.run(async () => {
        const meta = {
          title: track.title,
          performer: track.artist.name,
          durationSec: track.durationSec,
          caption: `${decision.attribution}\nAURIS · Слышать каждую ноту`,
        };
        const cachedId = decision.cacheFileId ? await this.d.store.cachedFileId(track.id) : undefined;
        if (!decision.cacheFileId) await this.d.store.dropFileId(track.id);
        if (cachedId) {
          try {
            await sender.sendAudio(userId, { fileId: cachedId }, meta);
            return { cached: true };
          } catch (e) {
            if (e instanceof TelegramSendError && e.kind === 'not_started') throw e;
            await this.d.store.dropFileId(track.id); // stale file_id -> upload again
          }
        }
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'auris-dl-'));
        try {
          let filePath = decision.source.filePath;
          if (!filePath) {
            if (decision.source.sizeBytes && decision.source.sizeBytes > TELEGRAM_SEND_MAX_BYTES) {
              throw new AppError('FILE_TOO_LARGE', 'Файл больше 50 МБ — Telegram не позволяет ботам отправлять такие файлы', 413);
            }
            filePath = path.join(dir, 'audio');
            await fetchToFile(decision.source.url!, filePath, TELEGRAM_SEND_MAX_BYTES);
          } else {
            const st = await fs.stat(filePath);
            if (st.size > TELEGRAM_SEND_MAX_BYTES) throw new AppError('FILE_TOO_LARGE', 'Файл больше 50 МБ — Telegram не позволяет ботам отправлять такие файлы', 413);
          }
          const thumbnail = await this.thumbnail(track.coverUrl);
          const r = await sender.sendAudio(userId, { path: filePath, filename: decision.source.filename.replace(/[\\/:*?"<>|]+/g, ' ') }, { ...meta, thumbnail });
          if (decision.cacheFileId && r.fileId) await this.d.store.cacheFileId(track.id, track.provider, r.fileId);
          return { cached: false };
        } finally {
          // Never keep the audio on our server.
          await fs.rm(dir, { recursive: true, force: true });
        }
      });
      await this.d.store.recordDownload(userId, track.id, track.provider);
      await this.d.store.setBotStarted(userId, true);
      return { status: 'sent', cached: out.cached };
    } catch (e) {
      await this.d.store.unbumpUsage(userId, 'download');
      if (e instanceof TelegramSendError) {
        if (e.kind === 'not_started') {
          await this.d.store.setBotStarted(userId, false);
          throw new AppError('BOT_NOT_STARTED', 'Запустите бота AURIS, чтобы он мог присылать вам файлы', 409, { botLink: this.botLink() });
        }
        if (e.kind === 'too_large') throw new AppError('FILE_TOO_LARGE', 'Файл слишком большой для отправки через Telegram', 413);
        if (e.kind === 'rate_limited') throw new AppError('RATE_LIMITED', 'Telegram просит подождать', 429, { retryAfterSec: e.retryAfterSec });
        throw new AppError('INTERNAL', 'Не удалось отправить файл в Telegram', 502);
      }
      throw e;
    }
  }

  private async thumbnail(coverUrl?: string): Promise<Buffer | null> {
    if (!coverUrl) return null;
    try {
      let buf: Buffer;
      if (coverUrl.startsWith('/')) {
        const file = await this.d.localCover?.(coverUrl);
        if (!file) return null;
        buf = await fs.readFile(file);
      } else {
        const res = await fetch(coverUrl, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) return null;
        buf = Buffer.from(await res.arrayBuffer());
      }
      if (buf.length > 5_000_000) return null;
      return await makeThumbnail(this.d.ffmpeg, buf);
    } catch {
      return null;
    }
  }
}
