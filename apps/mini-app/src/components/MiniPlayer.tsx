import { useState } from 'react';
import { player } from '../lib/player';
import { openPlayer } from '../lib/router';
import { session, toggleLike } from '../lib/session';
import { useStore } from '../lib/store';
import { Cover } from './Cover';
import { IconHeart, IconNext, IconPause, IconPlay, IconVolume } from './Icons';
import { VolumeControl } from './Volume';

/** Like, volume, play/pause and next — without opening the full player. */
export function MiniPlayer() {
  const track = useStore(player.store, (s) => s.queue[s.index]);
  const playing = useStore(player.store, (s) => s.playing);
  const loading = useStore(player.store, (s) => s.loading);
  const progress = useStore(player.store, (s) => (s.duration ? s.position / s.duration : 0));
  const kind = useStore(player.store, (s) => s.streamKind);
  const volume = useStore(player.store, (s) => s.volume);
  const liked = useStore(session, (s) => (track ? s.liked.has(track.id) : false));
  const [showVolume, setShowVolume] = useState(false);
  if (!track) return null;
  return (
    <>
      {showVolume ? (
        <div className="mini-volume glass" role="dialog" aria-label="Громкость">
          <VolumeControl compact />
        </div>
      ) : null}
      <div className="mini glass" role="region" aria-label="Сейчас играет">
        <button type="button" className="mini-open" onClick={() => openPlayer()} aria-label={`Открыть плеер: ${track.title}`}>
          <Cover src={track.coverUrl} className="sm now-cover" />
          <span className="row-text">
            <span className="row-title" style={{ fontSize: 14 }}>
              {track.title}
            </span>
            <span className="row-sub" style={{ fontSize: 12 }}>
              {kind === 'preview' ? <span className="pill" style={{ marginRight: 6 }}>30 С</span> : null}
              {track.artist.name}
            </span>
          </span>
        </button>
        <button type="button" className="icon-btn" aria-pressed={liked} aria-label={liked ? 'Убрать из избранного' : 'В избранное'} onClick={() => void toggleLike(track)}>
          <IconHeart filled={liked} key={liked ? 'on' : 'off'} className={`icon ${liked ? 'liked' : ''}`} />
        </button>
        <button type="button" className="icon-btn" aria-pressed={showVolume} aria-expanded={showVolume} aria-label="Громкость" onClick={() => setShowVolume((v) => !v)}>
          <IconVolume level={volume} />
        </button>
        <button type="button" className="icon-btn" onClick={() => player.toggle()} aria-label={playing ? 'Пауза' : 'Играть'} aria-busy={loading || undefined}>
          {playing ? <IconPause /> : <IconPlay />}
        </button>
        <button type="button" className="icon-btn" onClick={() => player.next()} aria-label="Следующий трек">
          <IconNext />
        </button>
        <span className="mini-progress" aria-hidden="true">
          <i style={{ transform: `scaleX(${progress})` }} />
        </span>
      </div>
    </>
  );
}
