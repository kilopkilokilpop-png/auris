import { player } from '../lib/player';
import { useStore } from '../lib/store';
import { Cover } from './Cover';
import { IconNext, IconPause, IconPlay } from './Icons';

export function MiniPlayer() {
  const track = useStore(player.store, (s) => s.queue[s.index]);
  const playing = useStore(player.store, (s) => s.playing);
  const loading = useStore(player.store, (s) => s.loading);
  const progress = useStore(player.store, (s) => (s.duration ? s.position / s.duration : 0));
  const kind = useStore(player.store, (s) => s.streamKind);
  if (!track) return null;
  return (
    <div className="mini glass" role="region" aria-label="Сейчас играет">
      <button type="button" className="mini-open" onClick={() => player.expand(true)} aria-label={`Открыть плеер: ${track.title}`}>
        <Cover src={track.coverUrl} className="sm" />
        <span className="row-text">
          <span className="row-title" style={{ fontSize: 14 }}>
            {track.title}
          </span>
          <span className="row-sub" style={{ display: 'block', fontSize: 12 }}>
            {kind === 'preview' ? <span className="pill" style={{ marginRight: 6 }}>ПРЕВЬЮ 30 С</span> : null}
            {track.artist.name}
          </span>
        </span>
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
  );
}
