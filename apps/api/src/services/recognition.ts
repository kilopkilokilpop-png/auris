import crypto from 'node:crypto';
import { ACCEPTED_AUDIO, normalizeForRecognition } from '../lib/ffmpeg.js';
import { AppError } from '../lib/errors.js';
import { RECOGNITION_MAX_BYTES, type Recognition } from '@auris/shared';
import type { CompositeProvider } from '../providers/music/registry.js';
import { RecognitionUnavailableError, type RecognitionProvider, type RecognitionResult } from '../providers/recognition/RecognitionProvider.js';
import type { Store } from './store.js';

export class RecognitionService {
  private minute = new Map<number, number[]>();
  constructor(
    private readonly d: {
      provider: RecognitionProvider;
      music: CompositeProvider;
      store: Store;
      ffmpeg: string;
      hasFfmpeg: boolean;
      perDay: number;
      perMinute: number;
    },
  ) {}

  private checkMinute(userId: number) {
    const now = Date.now();
    const list = (this.minute.get(userId) ?? []).filter((t) => now - t < 60_000);
    if (list.length >= this.d.perMinute) {
      throw new AppError('RATE_LIMITED', 'Слишком часто. Подождите минуту и попробуйте снова.', 429, { retryAfterSec: Math.ceil((60_000 - (now - list[0]!)) / 1000) });
    }
    list.push(now);
    this.minute.set(userId, list);
  }

  async recognize(userId: number, audio: Buffer, mime: string, source: 'miniapp' | 'bot'): Promise<Recognition> {
    if (audio.length === 0) throw new AppError('AUDIO_INVALID', 'Пустая запись', 400);
    if (audio.length > RECOGNITION_MAX_BYTES && source === 'miniapp') throw new AppError('AUDIO_INVALID', 'Запись слишком длинная', 413);
    if (!ACCEPTED_AUDIO.test(mime)) throw new AppError('AUDIO_INVALID', 'Этот формат аудио не поддерживается', 415);
    this.checkMinute(userId);
    const used = await this.d.store.bumpUsage(userId, 'recognize');
    if (used > this.d.perDay) throw new AppError('RATE_LIMITED', `Лимит — ${this.d.perDay} распознаваний в сутки`, 429);

    const sha = crypto.createHash('sha256').update(audio).digest('hex');
    let result = (await this.d.store.cachedRecognition(sha)) as RecognitionResult | undefined;
    if (!result) {
      let sample = audio;
      let sampleMime = mime;
      if (this.d.hasFfmpeg) {
        try {
          sample = await normalizeForRecognition(this.d.ffmpeg, audio);
          sampleMime = 'audio/mpeg';
        } catch {
          throw new AppError('AUDIO_INVALID', 'Не удалось прочитать запись. Попробуйте ещё раз.', 422);
        }
      }
      try {
        result = await this.d.provider.recognize(sample, sampleMime);
      } catch (e) {
        if (e instanceof RecognitionUnavailableError) throw new AppError('RECOGNITION_UNAVAILABLE', 'Сервис распознавания сейчас недоступен. Попробуйте позже.', 503);
        throw e;
      }
      if (result.status === 'found') await this.d.store.cacheRecognition(sha, result);
    }
    if (result.status === 'not_found') throw new AppError('RECOGNITION_NOT_FOUND', 'Не удалось распознать. Поднесите телефон ближе к источнику звука.', 404);

    const m = result.match;
    const track = await this.d.music.match({ title: m.title, artist: m.artist, isrc: m.isrc, externalIds: m.externalIds }).catch(() => null);
    let unavailableReason: string | undefined;
    if (!track) unavailableReason = 'Этого трека нет в каталоге AURIS — послушать его здесь нельзя.';
    else if (track.playback.kind === 'none') unavailableReason = track.playback.note ?? 'Трек нельзя послушать в AURIS.';
    else if (track.playback.kind === 'preview') unavailableReason = `Доступно только превью ${Math.round(track.playback.playableSec)} секунд.`;

    const saved = await this.d.store.addRecognition(userId, {
      title: m.title,
      artist: m.artist,
      album: m.album,
      coverUrl: m.coverUrl ?? track?.coverUrl,
      matchedTrackId: track?.id,
      unavailableReason,
      source,
      provider: result.provider,
    });
    if (track) {
      await this.d.store.saveSnapshots([track]);
      await this.d.store.addEvent(userId, { trackId: track.id, kind: 'recognized', artistId: track.artist.id, genres: track.genres, context: 'hear' });
    }
    return { id: saved.id, title: m.title, artist: m.artist, album: m.album, coverUrl: m.coverUrl ?? track?.coverUrl, track: track ?? undefined, unavailableReason, source, createdAt: saved.createdAt };
  }
}
