import crypto from 'node:crypto';
import { RecognitionUnavailableError, type RecognitionProvider, type RecognitionResult } from './RecognitionProvider.js';

/** ACRCloud Identification API v1: POST https://<host>/v1/identify, HMAC-SHA1 signed. */
interface AcrResp {
  status: { code: number; msg: string };
  metadata?: {
    music?: {
      title: string;
      artists?: { name: string }[];
      album?: { name?: string };
      external_ids?: { isrc?: string };
      external_metadata?: { deezer?: { track?: { id?: string | number } } };
    }[];
  };
}

export function acrSignature(secret: string, accessKey: string, timestamp: string): string {
  const s = ['POST', '/v1/identify', accessKey, 'audio', '1', timestamp].join('\n');
  return crypto.createHmac('sha1', secret).update(s).digest('base64');
}

export class AcrCloudProvider implements RecognitionProvider {
  readonly name = 'acrcloud';
  constructor(private readonly cfg: { host: string; key: string; secret: string }) {}

  async recognize(audio: Buffer, mime: string): Promise<RecognitionResult> {
    const ts = String(Math.floor(Date.now() / 1000));
    const form = new FormData();
    form.set('access_key', this.cfg.key);
    form.set('data_type', 'audio');
    form.set('signature_version', '1');
    form.set('timestamp', ts);
    form.set('signature', acrSignature(this.cfg.secret, this.cfg.key, ts));
    form.set('sample_bytes', String(audio.length));
    form.set('sample', new Blob([new Uint8Array(audio)], { type: mime }), 'sample.mp3');
    let r: AcrResp;
    try {
      const res = await fetch(`https://${this.cfg.host.replace(/^https?:\/\//, '')}/v1/identify`, { method: 'POST', body: form, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      r = (await res.json()) as AcrResp;
    } catch (e) {
      throw new RecognitionUnavailableError(`ACRCloud недоступен: ${(e as Error).message}`);
    }
    // 1001 = no result; 2004 = can't generate fingerprint (silence/noise)
    if (r.status.code === 1001 || r.status.code === 2004) return { status: 'not_found', provider: this.name };
    if (r.status.code !== 0) throw new RecognitionUnavailableError(`ACRCloud: ${r.status.msg}`);
    const m = r.metadata?.music?.[0];
    if (!m) return { status: 'not_found', provider: this.name };
    const dz = m.external_metadata?.deezer?.track?.id;
    return {
      status: 'found',
      provider: this.name,
      match: {
        title: m.title,
        artist: m.artists?.map((a) => a.name).join(', ') ?? '',
        album: m.album?.name,
        isrc: m.external_ids?.isrc,
        externalIds: dz ? { deezer: String(dz) } : undefined,
      },
    };
  }
}
