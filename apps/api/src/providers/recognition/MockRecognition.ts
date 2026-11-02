import crypto from 'node:crypto';
import { MOCK_ARTISTS, MOCK_TRACKS } from '../music/mock-catalog.js';
import type { RecognitionProvider, RecognitionResult } from './RecognitionProvider.js';

/**
 * Dev-only stand-in that needs no keys. It does NOT listen: it deterministically picks a demo
 * track from the audio hash, and returns "not found" for near-silent input so every UI state is reachable.
 */
export class MockRecognition implements RecognitionProvider {
  readonly name = 'mock';
  async recognize(audio: Buffer): Promise<RecognitionResult> {
    await new Promise((r) => setTimeout(r, 600));
    if (audio.length < 2000) return { status: 'not_found', provider: this.name };
    const h = crypto.createHash('sha256').update(audio).digest();
    const t = MOCK_TRACKS[h[0]! % MOCK_TRACKS.length]!;
    const a = MOCK_ARTISTS.find((x) => x.id === t.artist)!;
    return { status: 'found', provider: this.name, match: { title: t.title, artist: a.name } };
  }
}
