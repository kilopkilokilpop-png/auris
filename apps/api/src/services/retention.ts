import type { YouTubeProvider } from '../providers/music/YouTubeProvider.js';
import type { Store } from './store.js';

/**
 * YouTube API Developer Policies III.E.4: non-authorized API data may be stored for at most 30 days
 * and must be kept consistent with YouTube. Every run:
 *  1. snapshots older than `maxAgeDays` are re-fetched (videos.list, 1 unit per 50 ids);
 *  2. videos that are gone (deleted, private, no longer embeddable, blocked in the region) are removed
 *     from snapshots, likes, playlists, history and Слух matches;
 *  3. ids referenced by user data without any snapshot are refreshed the same way.
 * If the quota is exhausted, data that cannot be refreshed is DELETED once it reaches the limit.
 */
export class YouTubeRetention {
  constructor(
    private readonly yt: YouTubeProvider,
    private readonly store: Store,
    private readonly maxAgeDays: number,
  ) {}

  async run(): Promise<{ refreshed: number; removed: number }> {
    let refreshed = 0;
    let removed = 0;
    const stale = [...new Set([...(await this.store.staleSnapshotIds('youtube', this.maxAgeDays, 1000)), ...(await this.store.referencedWithoutSnapshot('youtube', 1000))])];
    for (let i = 0; i < stale.length; i += 50) {
      const chunk = stale.slice(i, i + 50);
      try {
        const r = await this.yt.refresh(chunk);
        await this.store.saveSnapshots(r.fresh);
        await this.store.forgetTracks(r.gone);
        refreshed += r.fresh.length;
        removed += r.gone.length;
      } catch {
        // Could not refresh (quota / network): over-age data must not stay.
        const hard = new Set(await this.store.staleSnapshotIds('youtube', 30, 5000));
        const drop = chunk.filter((id) => hard.has(id));
        await this.store.forgetTracks(drop);
        removed += drop.length;
      }
    }
    return { refreshed, removed };
  }

  /** Runs now and then every `everyHours`. Returns a stop function. */
  start(everyHours = 12, log?: (msg: string, extra?: object) => void): () => void {
    const tick = () =>
      void this.run()
        .then((r) => log?.('youtube retention', r))
        .catch((e: Error) => log?.('youtube retention failed', { err: e.message }));
    const first = setTimeout(tick, 30_000);
    const timer = setInterval(tick, everyHours * 3600_000);
    timer.unref?.();
    first.unref?.();
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }
}
