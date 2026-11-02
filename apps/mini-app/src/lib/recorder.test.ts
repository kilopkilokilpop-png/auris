import { afterEach, describe, expect, it, vi } from 'vitest';
import { canRecord, pickMime } from './recorder';

afterEach(() => vi.unstubAllGlobals());

describe('recorder format choice', () => {
  it('prefers Opus/WebM (Android Chrome)', () => {
    vi.stubGlobal('MediaRecorder', { isTypeSupported: (m: string) => m.startsWith('audio/webm') });
    expect(pickMime()).toBe('audio/webm;codecs=opus');
  });
  it('falls back to AAC/MP4 (iOS WKWebView)', () => {
    vi.stubGlobal('MediaRecorder', { isTypeSupported: (m: string) => m.startsWith('audio/mp4') });
    expect(pickMime()).toBe('audio/mp4;codecs=mp4a.40.2');
  });
  it('reports when recording is impossible so the UI offers the bot fallback', () => {
    vi.stubGlobal('MediaRecorder', undefined);
    expect(pickMime()).toBeUndefined();
    expect(canRecord()).toBe(false);
  });
});
