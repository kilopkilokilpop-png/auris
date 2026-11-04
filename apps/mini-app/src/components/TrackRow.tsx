import type { Track } from '@auris/shared';
import { trackBadge } from '@auris/shared';
import { session } from '../lib/session';
import { useStore } from '../lib/store';
import { player } from '../lib/player';
import { openSheet } from '../lib/ui';
import { toggleLike } from '../lib/session';
import { Cover } from './Cover';
import { IconClose, IconHeart, IconMore } from './Icons';

export type RowTrailing = 'badge' | 'heart' | 'more';

const SOURCE_SHORT: Partial<Record<Track['provider'], string>> = { youtube: 'YouTube', jamendo: 'Jamendo', audius: 'Audius', deezer: 'Deezer' };

export function TrackRow({ track, onPlay, trailing = 'more', sub, onRemove, showSource }: { track: Track; onPlay: () => void; trailing?: RowTrailing; sub?: string; onRemove?: () => void; showSource?: boolean }) {
  const tier = useStore(session, (s) => s.profile?.settings.quality ?? 'standard');
  const liked = useStore(session, (s) => s.liked.has(track.id));
  const current = useStore(player.store, (s) => s.queue[s.index]?.id === track.id);
  const badge = trackBadge(track, tier);
  const unavailable = track.playback.kind === 'none';
  return (
    <li className={`row ${current ? 'is-current' : ''}`}>
      <button
        type="button"
        className="row-main"
        onClick={onPlay}
        aria-disabled={unavailable || undefined}
        aria-label={`${track.title}, ${track.artist.name}${badge.description ? `, ${badge.description}` : ''}`}
      >
        <Cover src={track.coverUrl} />
        <span className="row-text">
          <span className="row-title">{track.title}</span>
          <span className="row-sub" style={{ display: 'block' }}>
            {showSource && SOURCE_SHORT[track.provider] ? <span className="source-badge">{SOURCE_SHORT[track.provider]}</span> : null}
            {sub ?? track.artist.name}
          </span>
        </span>
        {trailing === 'badge' && badge.label ? <span className={`badge-q ${badge.kind === 'preview' ? 'preview' : ''}`}>{badge.label}</span> : null}
      </button>
      {trailing === 'heart' ? (
        <button type="button" className="icon-btn" aria-pressed={liked} aria-label={liked ? 'Убрать из избранного' : 'В избранное'} onClick={() => void toggleLike(track)}>
          <IconHeart filled={liked} />
        </button>
      ) : null}
      {trailing === 'more' ? (
        <>
          {badge.kind === 'preview' ? <span className="badge-q preview">{badge.label}</span> : null}
          <button type="button" className="icon-btn" aria-label={`Действия: ${track.title}`} onClick={() => openSheet({ kind: 'track', track })}>
            <IconMore />
          </button>
        </>
      ) : null}
      {onRemove ? (
        <button type="button" className="icon-btn" aria-label={`Убрать из плейлиста: ${track.title}`} onClick={onRemove}>
          <IconClose />
        </button>
      ) : null}
    </li>
  );
}

export function TrackList({ tracks, context, trailing, sub, onRemove, showSource = true }: { tracks: Track[]; context: string; trailing?: RowTrailing; sub?: (t: Track) => string | undefined; onRemove?: (t: Track) => (() => void) | undefined; showSource?: boolean }) {
  return (
    <ul className="list">
      {tracks.map((t, i) => (
        <TrackRow
          key={t.id}
          track={t}
          trailing={trailing}
          sub={sub?.(t)}
          onRemove={onRemove?.(t)}
          showSource={showSource}
          onPlay={() => (t.playback.kind === 'none' ? openSheet({ kind: 'info', title: 'Нельзя послушать', body: t.playback.note ?? 'Источник не даёт воспроизвести этот трек.' }) : player.playList(tracks, i, { label: context, kind: 'list' }))}
        />
      ))}
    </ul>
  );
}
