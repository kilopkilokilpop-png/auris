import type { Track } from '@auris/shared';
import type { CompositeProvider } from '../providers/music/registry.js';
import type { Store } from './store.js';

/** Resolves track ids to Track objects: provider first (fresh rights), snapshot as fallback. */
export class Catalog {
  constructor(
    readonly music: CompositeProvider,
    private readonly store: Store,
  ) {}

  async hydrate(ids: string[]): Promise<Track[]> {
    const snaps = await this.store.snapshots(ids);
    const out = await Promise.all(
      ids.map(async (id) => {
        const fresh = await this.music.getTrack(id).catch(() => null);
        return fresh ?? snaps.get(id) ?? null;
      }),
    );
    const tracks = out
      .filter((t): t is Track => !!t)
      .map((t) =>
        this.music.owns(t.id)
          ? t
          : { ...t, playback: { kind: 'none' as const, playableSec: 0, qualities: [], note: 'Источник этого трека больше не подключён' }, downloadable: false, downloadNote: 'Источник больше не подключён' },
      );
    void this.store.saveSnapshots(tracks).catch(() => {});
    return tracks;
  }
}
