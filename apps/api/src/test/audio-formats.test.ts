import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACCEPTED_AUDIO, normalizeForRecognition } from '../lib/ffmpeg.js';

/**
 * Formats real clients produce: iOS WKWebView MediaRecorder -> audio/mp4 (AAC),
 * Android Chrome -> audio/webm (Opus), Telegram voice -> audio/ogg (Opus), plus mp3/wav files.
 */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auris-fmt-'));
const make = (name: string, args: string[]) => {
  const out = path.join(dir, name);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=10', ...args, out]);
  return fs.readFileSync(out);
};

describe('server-side audio normalisation (ffmpeg)', () => {
  const cases: [string, string, string[]][] = [
    ['ios.m4a', 'audio/mp4', ['-c:a', 'aac']],
    ['android.webm', 'audio/webm;codecs=opus', ['-c:a', 'libopus']],
    ['voice.ogg', 'audio/ogg', ['-c:a', 'libopus']],
    ['file.mp3', 'audio/mpeg', ['-c:a', 'libmp3lame']],
    ['file.wav', 'audio/wav', []],
  ];
  for (const [name, mime, args] of cases) {
    it(`${mime} -> mp3, trimmed to 12 s, temp files removed`, async () => {
      expect(ACCEPTED_AUDIO.test(mime)).toBe(true);
      const before = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('auris-rec-')).length;
      const out = await normalizeForRecognition('ffmpeg', make(name, args));
      expect(out.subarray(0, 3).toString() === 'ID3' || (out[0] === 0xff && (out[1]! & 0xe0) === 0xe0)).toBe(true);
      const after = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('auris-rec-')).length;
      expect(after).toBe(before);
    });
  }
  it('rejects garbage', async () => {
    await expect(normalizeForRecognition('ffmpeg', Buffer.from('not audio at all'))).rejects.toThrow();
    expect(ACCEPTED_AUDIO.test('text/html')).toBe(false);
  });
});
