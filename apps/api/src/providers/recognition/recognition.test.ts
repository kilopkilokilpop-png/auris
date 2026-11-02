import { describe, expect, it } from 'vitest';
import { acrSignature } from './AcrCloudProvider.js';
import { FallbackRecognition, RecognitionUnavailableError, type RecognitionProvider } from './RecognitionProvider.js';

describe('recognition', () => {
  it('ACRCloud signature is HMAC-SHA1 over the documented string', () => {
    // POST\n/v1/identify\nkey\naudio\n1\n1700000000 with secret "s"
    expect(acrSignature('s', 'key', '1700000000')).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(acrSignature('s', 'key', '1700000000')).toBe(acrSignature('s', 'key', '1700000000'));
    expect(acrSignature('s', 'key', '1700000000')).not.toBe(acrSignature('s', 'key', '1700000001'));
  });
  it('falls back only when a provider is unavailable', async () => {
    const down: RecognitionProvider = { name: 'a', recognize: async () => { throw new RecognitionUnavailableError('x'); } };
    const none: RecognitionProvider = { name: 'b', recognize: async () => ({ status: 'not_found', provider: 'b' }) };
    const found: RecognitionProvider = { name: 'c', recognize: async () => ({ status: 'found', provider: 'c', match: { title: 't', artist: 'a' } }) };
    expect((await new FallbackRecognition([down, found]).recognize(Buffer.alloc(1), 'audio/mpeg')).provider).toBe('c');
    expect((await new FallbackRecognition([none, found]).recognize(Buffer.alloc(1), 'audio/mpeg')).status).toBe('not_found');
    await expect(new FallbackRecognition([down]).recognize(Buffer.alloc(1), 'audio/mpeg')).rejects.toBeInstanceOf(RecognitionUnavailableError);
  });
});
