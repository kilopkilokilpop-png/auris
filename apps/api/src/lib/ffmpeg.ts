import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Accepted upload containers. iOS WebView records audio/mp4 (AAC), Android Chrome audio/webm (Opus), Telegram voice = ogg/opus. */
export const ACCEPTED_AUDIO = /^(audio\/(webm|ogg|mp4|mpeg|mp3|x-m4a|m4a|aac|wav|x-wav|wave|3gpp|flac|opus)|video\/(webm|mp4))(;.*)?$/i;

/**
 * Normalises any recorded clip to MP3 mono 44.1 kHz, max `maxSec` seconds.
 * Input and output live in a private temp dir that is removed in `finally` — audio never persists.
 */
export async function normalizeForRecognition(ffmpeg: string, input: Buffer, maxSec = 12, tmpRoot = os.tmpdir()): Promise<Buffer> {
  const dir = await fs.mkdtemp(path.join(tmpRoot, 'auris-rec-'));
  const src = path.join(dir, crypto.randomUUID());
  const out = path.join(dir, 'out.mp3');
  try {
    await fs.writeFile(src, input, { mode: 0o600 });
    await run(ffmpeg, ['-y', '-loglevel', 'error', '-i', src, '-t', String(maxSec), '-vn', '-ac', '1', '-ar', '44100', '-b:a', '128k', '-f', 'mp3', out], { timeout: 20_000 });
    return await fs.readFile(out);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** Telegram audio thumbnail: JPEG, <= 320px, < 200 kB. */
export async function makeThumbnail(ffmpeg: string, input: Buffer): Promise<Buffer | null> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'auris-thumb-'));
  try {
    const src = path.join(dir, 'in');
    const out = path.join(dir, 'thumb.jpg');
    await fs.writeFile(src, input);
    await run(ffmpeg, ['-y', '-loglevel', 'error', '-i', src, '-vf', 'scale=320:320:force_original_aspect_ratio=decrease', '-q:v', '5', '-frames:v', '1', out], { timeout: 10_000 });
    const b = await fs.readFile(out);
    return b.length < 200_000 ? b : null;
  } catch {
    return null;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

export async function ffmpegAvailable(ffmpeg: string): Promise<boolean> {
  try {
    await run(ffmpeg, ['-version'], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}
