import type { Mood, WaveMode } from '@auris/shared';

/**
 * All recommendation weights in one place. Tuning = editing this file; tests pin the behaviour.
 */
export const RECO_WEIGHTS = {
  /** Signal value of one event, before time decay. */
  signals: {
    like: 3.0,
    unlike: -1.5,
    dislike: -4.0,
    play_complete: 1.0,
    repeat: 1.5,
    playlist_add: 2.0,
    recognized: 1.5,
    play_start: 0.05,
    earlySkip: -1.5,
    lateSkip: -0.2,
  },
  /** A skip before this many seconds (or this share of the playable length) is "early". */
  earlySkipSec: 30,
  earlySkipShare: 0.3,
  /** Newer actions matter more: weight halves every N days. */
  halfLifeDays: 14,
  /** How a track signal spreads to its artist / genres / tags. */
  spread: { artist: 1.0, genre: 0.35, tag: 0.2 },
  /** Affinities are squashed with tanh(x / scale) into (-1, 1). */
  affinityScale: { artist: 4, genre: 6, tag: 6, track: 3 },
  /** Score components. */
  score: { artist: 1.6, genre: 0.8, tag: 0.4, track: 1.0, popularity: 0.5, mood: 1.0, onboardingGenre: 0.6, onboardingArtist: 1.2 },
  /** Mode shapes familiar vs new. */
  modes: {
    favorite: { familiarity: 1.4, novelty: -0.4, knownTrack: 0.8 },
    mix: { familiarity: 1.0, novelty: 0.3, knownTrack: 0.0 },
    discovery: { familiarity: 0.5, novelty: 1.4, knownTrack: -1.2 },
  } satisfies Record<WaveMode, { familiarity: number; novelty: number; knownTrack: number }>,
  /** Same artist may appear at most once within this many consecutive tracks. */
  artistWindow: 3,
  /** Recently played tracks (by count) never come back in the wave. */
  recentHistory: 60,
  /** Small deterministic jitter so the wave does not feel static. */
  jitter: 0.12,
} as const;

/** Mood = soft match over canonical genres and free tags (Jamendo vartags, mock tags). */
export const MOOD_KEYWORDS: Record<Exclude<Mood, 'any'>, string[]> = {
  energetic: ['energetic', 'happy', 'upbeat', 'dance', 'electronic', 'pop', 'rock', 'party', 'hiphop'],
  calm: ['calm', 'relaxing', 'chill', 'chillout', 'ambient', 'lounge', 'peaceful', 'classical', 'acoustic', 'jazz'],
  sad: ['sad', 'melancholic', 'dark', 'emotional', 'blues', 'romantic'],
  work: ['focus', 'instrumental', 'ambient', 'lofi', 'classical', 'calm', 'chillout', 'soundtrack'],
  sport: ['workout', 'energetic', 'dance', 'hiphop', 'rock', 'metal', 'electronic', 'motivational'],
};
