import { Api, GrammyError, InputFile } from 'grammy';

export interface AudioMeta {
  title: string;
  performer: string;
  durationSec?: number;
  caption?: string;
  thumbnail?: Buffer | null;
}
export type AudioInput = { fileId: string } | { path: string; filename: string };

export class TelegramSendError extends Error {
  constructor(
    readonly kind: 'not_started' | 'too_large' | 'rate_limited' | 'other',
    message: string,
    readonly retryAfterSec?: number,
  ) {
    super(message);
  }
}

/** The only place that talks to the Bot API from the API service. Mockable in tests. */
export interface TelegramSender {
  sendAudio(chatId: number, input: AudioInput, meta: AudioMeta): Promise<{ fileId: string }>;
}

export class GrammyTelegramSender implements TelegramSender {
  private api: Api;
  constructor(token: string) {
    this.api = new Api(token);
  }
  async sendAudio(chatId: number, input: AudioInput, meta: AudioMeta) {
    try {
      const audio = 'fileId' in input ? input.fileId : new InputFile(input.path, input.filename);
      const msg = await this.api.sendAudio(chatId, audio, {
        title: meta.title.slice(0, 64),
        performer: meta.performer.slice(0, 64),
        duration: meta.durationSec ? Math.round(meta.durationSec) : undefined,
        caption: meta.caption?.slice(0, 1024),
        thumbnail: meta.thumbnail && !('fileId' in input) ? new InputFile(meta.thumbnail, 'cover.jpg') : undefined,
      });
      return { fileId: msg.audio?.file_id ?? '' };
    } catch (e) {
      if (e instanceof GrammyError) {
        const d = e.description.toLowerCase();
        if (e.error_code === 403 || d.includes('chat not found') || d.includes("can't initiate")) {
          throw new TelegramSendError('not_started', e.description);
        }
        if (e.error_code === 413 || d.includes('too big') || d.includes('too large')) throw new TelegramSendError('too_large', e.description);
        if (e.error_code === 429) throw new TelegramSendError('rate_limited', e.description, e.parameters.retry_after);
      }
      throw new TelegramSendError('other', (e as Error).message);
    }
  }
}
