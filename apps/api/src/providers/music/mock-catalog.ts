/**
 * Local demo catalogue. All artists, titles and audio are original to AURIS:
 * the audio is synthesised on first use by ffmpeg (see MockProvider) and released as CC0.
 */
export interface MockArtist {
  id: string;
  name: string;
  genres: string[];
  related: string[];
}
export interface MockAlbum {
  id: string;
  title: string;
  artist: string;
  year: number;
}
export interface MockTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  genres: string[];
  tags: string[];
  popularity: number;
  /** Synth parameters */
  root: number;
  bpm: number;
  minor: boolean;
  /** Real variants we render: always mp3; hifi = FLAC 16/44.1, hires = FLAC 24/96 */
  variants: ('hifi' | 'hires')[];
}

export const MOCK_GENRES = [
  { id: 'electronic', name: 'Электроника' },
  { id: 'ambient', name: 'Эмбиент' },
  { id: 'indie', name: 'Инди' },
  { id: 'jazz', name: 'Джаз' },
  { id: 'hiphop', name: 'Хип-хоп' },
  { id: 'rock', name: 'Рок' },
  { id: 'classical', name: 'Классика' },
  { id: 'lofi', name: 'Lo-fi' },
];

export const MOCK_ARTISTS: MockArtist[] = [
  { id: 'a1', name: 'Северный Шум', genres: ['electronic', 'ambient'], related: ['a2', 'a9'] },
  { id: 'a2', name: 'Lumen Field', genres: ['ambient', 'classical'], related: ['a1', 'a7'] },
  { id: 'a3', name: 'Тёплый Ламповый', genres: ['lofi', 'hiphop'], related: ['a5', 'a8'] },
  { id: 'a4', name: 'Koda Brass', genres: ['jazz'], related: ['a8', 'a7'] },
  { id: 'a5', name: 'Мира Вольт', genres: ['hiphop', 'electronic'], related: ['a3', 'a6'] },
  { id: 'a6', name: 'Ferrum Coast', genres: ['rock', 'indie'], related: ['a10', 'a5'] },
  { id: 'a7', name: 'Ансамбль Тишины', genres: ['classical', 'ambient'], related: ['a2', 'a4'] },
  { id: 'a8', name: 'Velvet Static', genres: ['lofi', 'jazz'], related: ['a3', 'a4'] },
  { id: 'a9', name: 'Pulse Arcade', genres: ['electronic'], related: ['a1', 'a5'] },
  { id: 'a10', name: 'Город Стекла', genres: ['indie', 'rock'], related: ['a6', 'a2'] },
];

export const MOCK_ALBUMS: MockAlbum[] = [
  { id: 'al1', title: 'Полярный свет', artist: 'a1', year: 2025 },
  { id: 'al2', title: 'Slow Horizons', artist: 'a2', year: 2024 },
  { id: 'al3', title: 'Плёнка', artist: 'a3', year: 2025 },
  { id: 'al4', title: 'After Hours Brass', artist: 'a4', year: 2023 },
  { id: 'al5', title: 'Напряжение', artist: 'a5', year: 2026 },
  { id: 'al6', title: 'Rust & Salt', artist: 'a6', year: 2024 },
  { id: 'al7', title: 'Пустые залы', artist: 'a7', year: 2026 },
  { id: 'al8', title: 'Dust on Vinyl', artist: 'a8', year: 2025 },
  { id: 'al9', title: 'Insert Coin', artist: 'a9', year: 2026 },
  { id: 'al10', title: 'Прозрачные стены', artist: 'a10', year: 2025 },
];

let n = 0;
const t = (
  title: string,
  artist: string,
  album: string,
  tags: string[],
  popularity: number,
  root: number,
  bpm: number,
  minor: boolean,
  variants: ('hifi' | 'hires')[] = [],
): MockTrack => {
  const a = MOCK_ARTISTS.find((x) => x.id === artist)!;
  return { id: `t${++n}`, title, artist, album, genres: a.genres, tags, popularity, root, bpm, minor, variants };
};

export const MOCK_TRACKS: MockTrack[] = [
  t('Магнитное поле', 'a1', 'al1', ['calm', 'focus', 'chill'], 0.82, 220, 96, true, ['hifi', 'hires']),
  t('Ледяной гул', 'a1', 'al1', ['dark', 'focus'], 0.61, 196, 88, true, ['hires']),
  t('Северное сияние', 'a1', 'al1', ['calm', 'happy'], 0.7, 262, 100, false, ['hifi']),
  t('Morning Fog', 'a2', 'al2', ['calm', 'sad', 'focus'], 0.66, 174, 70, true, ['hifi', 'hires']),
  t('Glass Meadow', 'a2', 'al2', ['calm', 'happy'], 0.58, 247, 76, false, ['hires']),
  t('Тихий час', 'a3', 'al3', ['chill', 'focus', 'calm'], 0.9, 233, 82, true, ['hifi']),
  t('Кассета 1998', 'a3', 'al3', ['chill', 'sad'], 0.74, 208, 78, true),
  t('Чай остыл', 'a3', 'al3', ['chill', 'happy'], 0.69, 277, 84, false),
  t('Late Train', 'a4', 'al4', ['calm', 'chill'], 0.55, 185, 112, true, ['hifi']),
  t('Copper Lights', 'a4', 'al4', ['happy', 'energetic'], 0.6, 294, 126, false, ['hifi', 'hires']),
  t('Ток', 'a5', 'al5', ['energetic', 'workout', 'dark'], 0.88, 110, 140, true),
  t('Высокое напряжение', 'a5', 'al5', ['energetic', 'workout'], 0.79, 123, 146, true),
  t('Ночной район', 'a5', 'al5', ['dark', 'sad'], 0.64, 139, 92, true),
  t('Rust', 'a6', 'al6', ['energetic', 'workout'], 0.77, 165, 150, true),
  t('Salt Wind', 'a6', 'al6', ['sad', 'calm'], 0.52, 147, 98, true, ['hifi']),
  t('Пустой зал', 'a7', 'al7', ['calm', 'sad', 'focus'], 0.48, 131, 60, true, ['hires']),
  t('Этюд для стекла', 'a7', 'al7', ['calm', 'focus'], 0.57, 262, 66, false, ['hifi', 'hires']),
  t('Dust', 'a8', 'al8', ['chill', 'sad'], 0.71, 196, 80, true),
  t('Blue Hour Loop', 'a8', 'al8', ['chill', 'focus', 'calm'], 0.76, 220, 86, false),
  t('Insert Coin', 'a9', 'al9', ['energetic', 'happy', 'workout'], 0.84, 330, 132, false),
  t('Boss Level', 'a9', 'al9', ['energetic', 'workout', 'dark'], 0.73, 147, 138, true),
  t('Прозрачные стены', 'a10', 'al10', ['sad', 'calm'], 0.68, 175, 104, true, ['hifi']),
  t('Окна напротив', 'a10', 'al10', ['happy', 'energetic'], 0.62, 220, 122, false),
  t('Сквозняк', 'a10', 'al10', ['energetic', 'workout'], 0.59, 196, 136, true),
];

/** Rendered length of each demo track, seconds. Short on purpose: small files, quick demo. */
export const MOCK_DURATION_SEC = 45;
