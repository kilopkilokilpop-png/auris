/** Picks a container the current WebView can record. iOS WKWebView: audio/mp4; Android Chrome: audio/webm;codecs=opus. */
export function pickMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  const candidates = ['audio/webm;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'];
  return candidates.find((m) => {
    try {
      return MediaRecorder.isTypeSupported(m);
    } catch {
      return false;
    }
  });
}

export type RecordError = 'unsupported' | 'denied' | 'no-device' | 'failed';

export function canRecord(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
}

export interface Recording {
  blob: Blob;
  mime: string;
  filename: string;
}

/**
 * Records `seconds` of microphone audio. Echo cancellation / noise suppression are disabled —
 * they destroy music for fingerprinting. `onLevel` gets 0..1 for the visualiser.
 */
export async function recordClip(seconds: number, onLevel: (v: number) => void, signal: AbortSignal): Promise<Recording> {
  if (!canRecord()) throw Object.assign(new Error('unsupported'), { kind: 'unsupported' as RecordError });
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  } catch (e) {
    const name = (e as DOMException).name;
    const kind: RecordError = name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : name === 'NotFoundError' ? 'no-device' : 'failed';
    throw Object.assign(new Error(kind), { kind });
  }
  const mime = pickMime();
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 128_000 } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);

  let ctx: AudioContext | undefined;
  let raf = 0;
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AC) {
      ctx = new AC();
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.fftSize);
      const tick = () => {
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += ((v - 128) / 128) ** 2;
        onLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4));
        raf = requestAnimationFrame(tick);
      };
      tick();
    }
  } catch {
    /* visualiser is optional */
  }

  const done = new Promise<Recording>((resolve, reject) => {
    rec.onstop = () => {
      const type = rec.mimeType || mime || 'audio/webm';
      const blob = new Blob(chunks, { type });
      chunks.length = 0;
      const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
      resolve({ blob, mime: type, filename: `clip.${ext}` });
    };
    rec.onerror = () => reject(Object.assign(new Error('failed'), { kind: 'failed' as RecordError }));
  });
  const stopAll = () => {
    cancelAnimationFrame(raf);
    void ctx?.close().catch(() => {});
    stream.getTracks().forEach((t) => t.stop());
  };
  rec.start(250);
  const timer = setTimeout(() => rec.state !== 'inactive' && rec.stop(), seconds * 1000);
  signal.addEventListener('abort', () => {
    clearTimeout(timer);
    if (rec.state !== 'inactive') rec.stop();
  });
  try {
    return await done;
  } finally {
    clearTimeout(timer);
    stopAll();
  }
}
