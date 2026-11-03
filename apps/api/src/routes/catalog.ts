import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SearchQuerySchema, TrackIdSchema, type CatalogCapabilities, type Collection, type QualityTier, type Track } from '@auris/shared';
import { MOOD_KEYWORDS } from '../reco/weights.js';
import { isCompilation } from '../providers/music/AudiusProvider.js';
import { userId, type Services } from '../app.js';
import { AppError } from '../lib/errors.js';

const IdParam = z.object({ id: TrackIdSchema });
const TIERS: QualityTier[] = ['standard', 'hifi', 'hires'];

export function capabilities(s: Services): CatalogCapabilities {
  const infos = s.music.providers.map((p) => p.info);
  const best = Math.max(...infos.map((i) => TIERS.indexOf(i.maxTier)));
  const summary = (tier: QualityTier) => infos.map((i) => i.tiers?.[tier]).find(Boolean);
  return {
    providers: infos.map((i) => ({ id: i.id, name: i.name, fullStreams: i.fullStreams, previewsOnly: i.previewsOnly, downloads: i.downloads, notice: i.notice })),
    qualities: TIERS.map((tier, idx) => ({
      tier,
      available: idx <= best,
      summary: idx <= best ? summary(tier) : undefined,
      reason: idx <= best ? undefined : tier === 'hires' ? 'Подключённые источники не дают Hi-Res (24 бит)' : 'Подключённые источники не дают звук без потерь',
    })),
  };
}

/** Curated playlists: moods via provider tags, genres via provider genre charts. */
export const COLLECTIONS: (Collection & { kind: 'mood' | 'genre' | 'lang' | 'query'; key: string })[] = [
  // Russian youth music: searches in both sources, keeps Cyrillic titles/artists only.
  { id: 'ru-rap', kind: 'query', key: 'рэп|трэп|фонк|русский рэп|хип-хоп|drill', title: 'Русский рэп и трэп', subtitle: 'Новые артисты' },
  { id: 'lang-ru', kind: 'lang', key: 'ru', title: 'Русское', subtitle: 'Песни на русском' },
  { id: 'mood-energetic', kind: 'mood', key: 'energetic', title: 'Бодрое утро', subtitle: 'Энергия с первых нот' },
  { id: 'mood-calm', kind: 'mood', key: 'calm', title: 'Спокойствие', subtitle: 'Тихо, мягко, без спешки' },
  { id: 'mood-work', kind: 'mood', key: 'work', title: 'Фокус', subtitle: 'Для работы и учёбы' },
  { id: 'mood-sport', kind: 'mood', key: 'sport', title: 'Тренировка', subtitle: 'Держит темп' },
  { id: 'mood-sad', kind: 'mood', key: 'sad', title: 'Под дождь', subtitle: 'Меланхолия и нежность' },
  { id: 'genre-electronic', kind: 'genre', key: 'electronic', title: 'Электроника', subtitle: 'Синтезаторы и биты' },
  { id: 'genre-rock', kind: 'genre', key: 'rock', title: 'Рок', subtitle: 'Гитары громче' },
  { id: 'genre-hiphop', kind: 'genre', key: 'hiphop', title: 'Хип-хоп', subtitle: 'Ритм и слово' },
  { id: 'genre-jazz', kind: 'genre', key: 'jazz', title: 'Джаз', subtitle: 'Вечер у пластинки' },
  { id: 'genre-ambient', kind: 'genre', key: 'ambient', title: 'Эмбиент', subtitle: 'Пространство и воздух' },
];

/** Full-length first, previews after, unplayable dropped. */
const playableFirst = (tracks: Track[]) =>
  tracks.filter((t) => t.playback.kind !== 'none').sort((a, b) => Number(b.playback.kind === 'full') - Number(a.playback.kind === 'full'));

export function registerCatalogRoutes(app: FastifyInstance, s: Services) {
  // Language collections only when a connected source knows lyrics language.
  const hasLang = () => s.music.providers.some((p) => p.getLanguageTracks);
  app.get('/api/collections', async () => ({
    collections: COLLECTIONS.filter((c) => c.kind !== 'lang' || hasLang()).map(({ id, title, subtitle }) => ({ id, title, subtitle })),
  }));
  const cyrillicSearch = async (queries: string[]) => {
    const lists = await Promise.all(queries.map((q) => s.music.search(q, { type: 'track', limit: 30 }).then((r) => r.tracks).catch(() => [] as Track[])));
    const seen = new Set<string>();
    return lists
      .flat()
      .filter((t) => /[Ѐ-ӿ]/.test(`${t.title} ${t.artist.name}`) && !isCompilation(t.title, t.durationSec) && !seen.has(t.id) && Boolean(seen.add(t.id)))
      .sort((a, b) => b.popularity - a.popularity);
  };
  app.get('/api/collections/:cid', async (req) => {
    const { cid } = z.object({ cid: z.string().max(40) }).parse(req.params);
    const c = COLLECTIONS.find((x) => x.id === cid);
    if (!c) throw new AppError('NOT_FOUND', 'Подборка не найдена', 404);
    const raw =
      c.kind === 'mood'
        ? await s.music.getTagTracks(MOOD_KEYWORDS[c.key as keyof typeof MOOD_KEYWORDS].slice(0, 3), 30).catch(() => [])
        : c.kind === 'lang'
          ? await s.music.getLanguageTracks(c.key, 40).catch(() => [])
          : c.kind === 'query'
            ? await cyrillicSearch(c.key.split('|'))
            : await s.music.getGenreTracks(c.key, 30).catch(() => []);
    const tracks = playableFirst(raw).slice(0, 30);
    void s.store.saveSnapshots(tracks).catch(() => {});
    return { id: c.id, title: c.title, subtitle: c.subtitle, tracks };
  });

  app.get('/api/catalog/capabilities', async () => capabilities(s));

  app.get('/api/home', async (req) => {
    const uid = userId(req);
    const [editorial, recentIds] = await Promise.all([s.music.getEditorial().catch(() => null), s.store.recentlyPlayed(uid, 8)]);
    const recent = await s.catalog.hydrate(recentIds);
    return { editorial, recent, capabilities: capabilities(s) };
  });

  app.get('/api/search', async (req) => {
    const uid = userId(req);
    const q = SearchQuerySchema.parse(req.query);
    const r = await s.music.search(q.q, { type: q.type, limit: 20 });
    if (q.q.length >= 2) await s.store.addRecentSearch(uid, q.q);
    void s.store.saveSnapshots(r.tracks).catch(() => {});
    return r;
  });
  app.get('/api/search/recent', async (req) => ({ queries: await s.store.recentSearches(userId(req)) }));
  app.delete('/api/search/recent', async (req) => {
    await s.store.clearRecentSearches(userId(req));
    return { ok: true };
  });

  app.get('/api/charts', async () => {
    const [tracks, artists] = await Promise.all([s.music.getChart(20), s.music.getChartArtists(10).catch(() => [])]);
    return { tracks, artists };
  });

  app.get('/api/tracks/:id', async (req) => {
    const t = await s.music.getTrack(IdParam.parse(req.params).id);
    if (!t) throw new AppError('NOT_FOUND', 'Трек не найден', 404);
    return t;
  });
  app.get('/api/albums/:id', async (req) => {
    const a = await s.music.getAlbum(IdParam.parse(req.params).id);
    if (!a) throw new AppError('NOT_FOUND', 'Альбом не найден', 404);
    return a;
  });
  app.get('/api/artists/:id', async (req) => {
    const { id } = IdParam.parse(req.params);
    const [artist, tracks] = await Promise.all([s.music.getArtist(id), s.music.getArtistTopTracks(id, 20).catch(() => [])]);
    if (!artist) throw new AppError('NOT_FOUND', 'Артист не найден', 404);
    return { artist, tracks };
  });
}
