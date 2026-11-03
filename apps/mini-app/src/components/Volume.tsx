import { player } from '../lib/player';
import { useStore } from '../lib/store';
import { IconMinus, IconPlus, IconVolume } from './Icons';

/** − [slider] +  ; on iOS (read-only volume) an honest hint instead. */
export function VolumeControl({ compact }: { compact?: boolean }) {
  const volume = useStore(player.store, (s) => s.volume);
  const supported = useStore(player.store, (s) => s.volumeSupported);
  if (!supported) {
    return (
      <p className="note center" style={{ margin: compact ? '4px 0' : '14px 0 0' }}>
        <IconVolume style={{ width: 16, height: 16, verticalAlign: '-3px', marginRight: 6 }} />
        На iPhone громкость меняется кнопками телефона
      </p>
    );
  }
  const pct = Math.round(volume * 100);
  return (
    <div className={`volume ${compact ? 'compact' : ''}`} role="group" aria-label="Громкость">
      <button type="button" className="icon-btn" aria-label="Тише" onClick={() => player.stepVolume(-1)} disabled={volume <= 0}>
        <IconMinus />
      </button>
      <div className="volume-track">
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={pct}
          aria-label="Громкость"
          aria-valuetext={`${pct}%`}
          onChange={(e) => player.setVolume(Number(e.target.value) / 100)}
        />
      </div>
      <button type="button" className="icon-btn" aria-label="Громче" onClick={() => player.stepVolume(1)} disabled={volume >= 1}>
        <IconPlus />
      </button>
    </div>
  );
}
