import { RecognitionUnavailableError, type RecognitionProvider, type RecognitionResult } from './RecognitionProvider.js';

/** https://docs.audd.io/ — POST https://api.audd.io/ with api_token + file. */
interface AuddResp {
  status: 'success' | 'error';
  error?: { error_code: number; error_message: string };
  result: null | {
    artist: string;
    title: string;
    album?: string;
    deezer?: { id?: number; album?: { cover_big?: string; cover_medium?: string } };
    apple_music?: { isrc?: string; artwork?: { url?: string } };
    spotify?: { external_ids?: { isrc?: string } };
  };
}

export class AuddProvider implements RecognitionProvider {
  readonly name = 'audd';
  constructor(
    private readonly token: string,
    private readonly endpoint = 'https://api.audd.io/',
  ) {}

  async recognize(audio: Buffer, mime: string): Promise<RecognitionResult> {
    const form = new FormData();
    form.set('api_token', this.token);
    form.set('return', 'deezer,apple_music,spotify');
    form.set('file', new Blob([new Uint8Array(audio)], { type: mime }), 'sample.mp3');
    let r: AuddResp;
    try {
      const res = await fetch(this.endpoint, { method: 'POST', body: form, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      r = (await res.json()) as AuddResp;
    } catch (e) {
      throw new RecognitionUnavailableError(`AudD недоступен: ${(e as Error).message}`);
    }
    if (r.status === 'error') {
      // 900/901/902: token problems & limits -> service unavailable for us. Others: treat as no match.
      const code = r.error?.error_code ?? 0;
      if (code >= 900 || code === 19) throw new RecognitionUnavailableError(`AudD: ${r.error?.error_message ?? code}`);
      return { status: 'not_found', provider: this.name };
    }
    if (!r.result) return { status: 'not_found', provider: this.name };
    const x = r.result;
    return {
      status: 'found',
      provider: this.name,
      match: {
        title: x.title,
        artist: x.artist,
        album: x.album,
        isrc: x.apple_music?.isrc ?? x.spotify?.external_ids?.isrc,
        coverUrl: x.deezer?.album?.cover_big ?? x.apple_music?.artwork?.url?.replace('{w}', '600').replace('{h}', '600'),
        externalIds: x.deezer?.id ? { deezer: String(x.deezer.id) } : undefined,
      },
    };
  }
}
