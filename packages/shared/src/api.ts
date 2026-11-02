import { z } from 'zod';
import {
  AlbumSchema,
  ArtistSchema,
  GenreSchema,
  MoodSchema,
  QualityTierSchema,
  TrackIdSchema,
  TrackSchema,
  WaveModeSchema,
} from './models.js';

export const ErrorCodeSchema = z.enum([
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'NOT_FOUND',
  'RATE_LIMITED',
  'DOWNLOAD_FORBIDDEN',
  'DOWNLOAD_QUOTA',
  'FILE_TOO_LARGE',
  'BOT_NOT_STARTED',
  'BOT_NOT_CONFIGURED',
  'RECOGNITION_NOT_FOUND',
  'RECOGNITION_UNAVAILABLE',
  'AUDIO_INVALID',
  'PROVIDER_UNAVAILABLE',
  'INTERNAL',
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    /** Deep link to start the bot, when code = BOT_NOT_STARTED */
    botLink: z.string().optional(),
    retryAfterSec: z.number().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const EventKindSchema = z.enum([
  'play_start',
  'play_complete',
  'skip',
  'repeat',
  'like',
  'unlike',
  'dislike',
  'playlist_add',
  'recognized',
]);
export type EventKind = z.infer<typeof EventKindSchema>;

export const PostEventSchema = z.object({
  trackId: TrackIdSchema,
  kind: EventKindSchema,
  positionSec: z.number().min(0).max(36_000).optional(),
  listenedSec: z.number().min(0).max(36_000).optional(),
  context: z.string().max(64).optional(),
});
export type PostEvent = z.infer<typeof PostEventSchema>;

export const WaveRequestSchema = z.object({
  mood: MoodSchema.default('any'),
  mode: WaveModeSchema.default('mix'),
  /** Tracks already in the client queue / just played — never returned again. */
  exclude: z.array(TrackIdSchema).max(200).default([]),
  /** Last artists in the queue, to keep the artist spread when appending. */
  recentArtists: z.array(z.string().max(96)).max(20).default([]),
  count: z.number().int().min(1).max(20).default(5),
});
export type WaveRequest = z.input<typeof WaveRequestSchema>;

export const WaveItemSchema = z.object({
  track: TrackSchema,
  score: z.number(),
  reasons: z.array(z.string()),
});
export const WaveResponseSchema = z.object({ items: z.array(WaveItemSchema) });
export type WaveItem = z.infer<typeof WaveItemSchema>;

export const SearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(120),
  type: z.enum(['all', 'track', 'artist', 'album']).default('all'),
});
export const SearchResponseSchema = z.object({
  tracks: z.array(TrackSchema),
  artists: z.array(ArtistSchema),
  albums: z.array(AlbumSchema),
});
export type SearchResponse = z.infer<typeof SearchResponseSchema>;

export const SettingsPatchSchema = z
  .object({
    quality: QualityTierSchema,
    waveMood: MoodSchema,
    waveMode: WaveModeSchema,
  })
  .partial();

export const OnboardingResponseSchema = z.object({
  genres: z.array(GenreSchema),
  artists: z.array(ArtistSchema),
});
export const OnboardingSubmitSchema = z.object({
  genres: z.array(z.string().max(64)).min(1).max(8),
  artists: z.array(TrackIdSchema).length(3),
});

export const StreamInfoSchema = z.object({
  url: z.string(),
  kind: z.enum(['full', 'preview']),
  playableSec: z.number(),
  qualityLine: z.string(),
  expiresAt: z.number(),
});
export type StreamInfo = z.infer<typeof StreamInfoSchema>;

export const DownloadDecisionSchema = z.object({
  allowed: z.boolean(),
  reason: z.string().optional(),
});
export type DownloadDecisionDto = z.infer<typeof DownloadDecisionSchema>;

export const PlaylistCreateSchema = z.object({ title: z.string().trim().min(1).max(64) });
export const PlaylistAddSchema = z.object({ trackId: TrackIdSchema });

/** Max recognition upload, bytes. ~10s of any browser codec is far below this. */
export const RECOGNITION_MAX_BYTES = 3 * 1024 * 1024;
/** Telegram Bot API: bots can send audio files up to 50 MB (sendAudio, checked 2026-11). */
export const TELEGRAM_SEND_MAX_BYTES = 50 * 1024 * 1024;
/** Telegram Bot API: getFile can download files up to 20 MB. */
export const TELEGRAM_GETFILE_MAX_BYTES = 20 * 1024 * 1024;
