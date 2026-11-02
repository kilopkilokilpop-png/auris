import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SearchQuerySchema, TrackIdSchema, type CatalogCapabilities, type QualityTier } from '@auris/shared';
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

export function registerCatalogRoutes(app: FastifyInstance, s: Services) {
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
