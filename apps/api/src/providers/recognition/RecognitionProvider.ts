import type { ProviderId } from '@auris/shared';

export interface RecognitionMatch {
  title: string;
  artist: string;
  album?: string;
  isrc?: string;
  coverUrl?: string;
  externalIds?: Partial<Record<ProviderId, string>>;
}
export type RecognitionResult = { status: 'found'; match: RecognitionMatch; provider: string } | { status: 'not_found'; provider: string };

/** Thrown when the service itself is down / misconfigured / out of quota. */
export class RecognitionUnavailableError extends Error {}

export interface RecognitionProvider {
  readonly name: string;
  /** `audio` is MP3 (normalised by ffmpeg on our side). Must not persist the audio. */
  recognize(audio: Buffer, mime: string): Promise<RecognitionResult>;
}

/** Tries providers in order; moves on only when one is unavailable (not when it found nothing). */
export class FallbackRecognition implements RecognitionProvider {
  readonly name: string;
  constructor(private readonly list: RecognitionProvider[]) {
    this.name = list.map((p) => p.name).join('+');
  }
  async recognize(audio: Buffer, mime: string): Promise<RecognitionResult> {
    let last: unknown;
    for (const p of this.list) {
      try {
        return await p.recognize(audio, mime);
      } catch (e) {
        last = e;
      }
    }
    throw last instanceof RecognitionUnavailableError ? last : new RecognitionUnavailableError('Сервис распознавания недоступен');
  }
}
