import { z } from 'zod';

/**
 * Track ids are always namespaced by provider: "<provider>:<native id>".
 * The UI, recommendations and the bot treat them as opaque strings.
 */
export const TrackIdSchema = z
  .string()
  .min(3)
  .max(96)
  .regex(/^[a-z0-9]+:[A-Za-z0-9_.-]+$/, 'invalid id');
export type TrackId = z.infer<typeof TrackIdSchema>;

export const ProviderIdSchema = z.enum(['mock', 'deezer', 'jamendo', 'licensed']);
export type ProviderId = z.infer<typeof ProviderIdSchema>;

/** One real, measured or provider-declared audio variant. Never inferred. */
export const AudioQualitySchema = z.object({
  tier: z.enum(['standard', 'hifi', 'hires']),
  codec: z.enum(['mp3', 'aac', 'ogg', 'flac']),
  bitrateKbps: z.number().int().positive().optional(),
  /** Only set when the provider (or our own file probe) states it. */
  bitDepth: z.number().int().positive().optional(),
  sampleRateHz: z.number().int().positive().optional(),
  lossless: z.boolean(),
});
export type AudioQuality = z.infer<typeof AudioQualitySchema>;

export const PlaybackSchema = z.object({
  /** full = whole recording, preview = provider-limited clip, none = cannot be played here */
  kind: z.enum(['full', 'preview', 'none']),
  /** Length of what we can actually play, seconds. */
  playableSec: z.number().nonnegative(),
  /** Available real variants. Empty for kind = none. */
  qualities: z.array(AudioQualitySchema),
  /** Human reason when kind = none or preview. */
  note: z.string().optional(),
});
export type Playback = z.infer<typeof PlaybackSchema>;

export const LicenseSchema = z.object({
  /** e.g. "CC BY-NC-SA 3.0", "CC0", "Deezer API terms", "Unknown" */
  name: z.string(),
  url: z.string().url().optional(),
  attribution: z.string().optional(),
  /** Link back to the source page (required by Jamendo terms). */
  sourceUrl: z.string().url().optional(),
});
export type License = z.infer<typeof LicenseSchema>;

export const ArtistRefSchema = z.object({ id: z.string(), name: z.string() });

export const TrackSchema = z.object({
  id: TrackIdSchema,
  provider: ProviderIdSchema,
  title: z.string(),
  artist: ArtistRefSchema,
  album: z.object({ id: z.string(), title: z.string() }).optional(),
  /** Full recording length, seconds (may exceed playable length for previews). */
  durationSec: z.number().nonnegative(),
  coverUrl: z.string().optional(),
  genres: z.array(z.string()),
  tags: z.array(z.string()),
  popularity: z.number().min(0).max(1),
  isrc: z.string().optional(),
  explicit: z.boolean().optional(),
  playback: PlaybackSchema,
  license: LicenseSchema,
  /** Coarse hint for UI; the server re-decides on every download request. */
  downloadable: z.boolean(),
  downloadNote: z.string().optional(),
});
export type Track = z.infer<typeof TrackSchema>;

export const AlbumSchema = z.object({
  id: TrackIdSchema,
  provider: ProviderIdSchema,
  title: z.string(),
  artist: ArtistRefSchema,
  coverUrl: z.string().optional(),
  releaseDate: z.string().optional(),
  trackCount: z.number().int().nonnegative().optional(),
  tracks: z.array(TrackSchema).optional(),
});
export type Album = z.infer<typeof AlbumSchema>;

export const ArtistSchema = z.object({
  id: TrackIdSchema,
  provider: ProviderIdSchema,
  name: z.string(),
  pictureUrl: z.string().optional(),
  genres: z.array(z.string()),
  fans: z.number().int().nonnegative().optional(),
});
export type Artist = z.infer<typeof ArtistSchema>;

export const GenreSchema = z.object({ id: z.string(), name: z.string() });
export type Genre = z.infer<typeof GenreSchema>;

export const MoodSchema = z.enum(['any', 'energetic', 'calm', 'sad', 'work', 'sport']);
export type Mood = z.infer<typeof MoodSchema>;
export const WaveModeSchema = z.enum(['favorite', 'mix', 'discovery']);
export type WaveMode = z.infer<typeof WaveModeSchema>;
export const QualityTierSchema = z.enum(['standard', 'hifi', 'hires']);
export type QualityTier = z.infer<typeof QualityTierSchema>;

export const MOOD_LABELS: Record<Mood, string> = {
  any: 'Любое',
  energetic: 'Бодрое',
  calm: 'Спокойное',
  sad: 'Грустное',
  work: 'Для работы',
  sport: 'Для спорта',
};
export const WAVE_MODE_LABELS: Record<WaveMode, string> = {
  favorite: 'Любимое',
  mix: 'Микс',
  discovery: 'Открытия',
};
export const QUALITY_LABELS: Record<QualityTier, string> = {
  standard: 'Стандарт',
  hifi: 'Hi-Fi',
  hires: 'Hi-Res',
};

export const UserProfileSchema = z.object({
  id: z.number().int(),
  firstName: z.string(),
  lastName: z.string().optional(),
  username: z.string().optional(),
  photoUrl: z.string().optional(),
  isMaster: z.boolean(),
  botStarted: z.boolean(),
  onboarded: z.boolean(),
  settings: z.object({
    quality: QualityTierSchema,
    waveMood: MoodSchema,
    waveMode: WaveModeSchema,
  }),
  stats: z.object({
    liked: z.number().int(),
    playlists: z.number().int(),
    listenedHours: z.number(),
  }),
});
export type UserProfile = z.infer<typeof UserProfileSchema>;

export const PlaylistSchema = z.object({
  id: z.string(),
  title: z.string(),
  trackCount: z.number().int(),
  coverUrl: z.string().optional(),
  createdAt: z.string(),
});
export type Playlist = z.infer<typeof PlaylistSchema>;

export const RecognitionSchema = z.object({
  id: z.string(),
  title: z.string(),
  artist: z.string(),
  album: z.string().optional(),
  coverUrl: z.string().optional(),
  /** Track in the active catalogue, if we found one. */
  track: TrackSchema.optional(),
  /** Why there is no playable match. */
  unavailableReason: z.string().optional(),
  source: z.enum(['miniapp', 'bot']),
  createdAt: z.string(),
});
export type Recognition = z.infer<typeof RecognitionSchema>;

export const CatalogCapabilitiesSchema = z.object({
  providers: z.array(
    z.object({
      id: ProviderIdSchema,
      name: z.string(),
      fullStreams: z.boolean(),
      previewsOnly: z.boolean(),
      downloads: z.boolean(),
      notice: z.string(),
    }),
  ),
  qualities: z.array(
    z.object({
      tier: QualityTierSchema,
      available: z.boolean(),
      /** Human summary of the best real variant for the tier, e.g. "до 24 бит / 96 кГц". */
      summary: z.string().optional(),
      reason: z.string().optional(),
    }),
  ),
});
export type CatalogCapabilities = z.infer<typeof CatalogCapabilitiesSchema>;
