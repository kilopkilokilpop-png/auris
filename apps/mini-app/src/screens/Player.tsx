import { useEffect, useRef } from 'react';
import { formatDuration } from '@auris/shared';
import { IconChevronDown, IconDownload, IconHeart, IconInfo, IconMore, IconNext, IconPause, IconPlay, IconPrev, IconRepeat, IconShuffle, IconThumbDown, LogoMark } from '../components/Icons';
import { VolumeControl } from '../components/Volume';
import { closePlayer } from '../lib/router';
import { player } from '../lib/player';
import { downloadToTelegram, session, toggleLike } from '../lib/session';
import { useStore } from '../lib/store';
import { openSheet } from '../lib/ui';

const SOURCE_NAMES: Record<string, string> = { audius: 'Audius', jamendo: 'Jamendo', deezer: 'Deezer', licensed: 'Лицензионный каталог' };

export function Player() {
  const s = useStore(player.store, (x) => x);
  const track = s.queue[s.index];
  const liked = useStore(session, (x) => (track ? x.liked.has(track.id) : false));
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => closeRef.current?.focus(), []);
  if (!track) return null;
  const duration = s.duration || track.playback.playableSec;
  const pct = duration ? Math.min(100, (s.position / duration) * 100) : 0;
  const bufPct = duration ? Math.min(100, (s.buffered / duration) * 100) : 0;
  const isPreview = s.streamKind === 'preview' || track.playback.kind === 'preview';
  const reasons = s.reasons[track.id];

  return (
    <section className="player" role="dialog" aria-modal="true" aria-label="Плеер">
      <div className="player-top">
        <button ref={closeRef} type="button" className="icon-btn glass" aria-label="Свернуть плеер" onClick={() => closePlayer()}>
          <IconChevronDown />
        </button>
        <div className="player-from">
          <p className="label">Играет из</p>
          <strong>{s.context?.label ?? 'AURIS'}</strong>
        </div>
        <button type="button" className="icon-btn glass" aria-label="Ещё" onClick={() => openSheet({ kind: 'track', track })}>
          <IconMore />
        </button>
      </div>

      <div className="player-art now-cover">
        {track.coverUrl ? <img key={track.coverUrl} src={track.coverUrl} alt={`Обложка: ${track.title}`} onLoad={(e) => e.currentTarget.classList.add('loaded')} /> : <LogoMark size={140} />}
      </div>

      <div className="player-meta">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 className="player-title">{track.title}</h1>
          <p className="player-artist">{track.artist.name}</p>
          {/* Attribution: source platform + backlink to the track page (Audius / Jamendo require it). */}
          {track.license.sourceUrl && track.provider !== 'mock' ? (
            <a className="source-link" href={track.license.sourceUrl} target="_blank" rel="noreferrer">
              {SOURCE_NAMES[track.provider] ?? track.provider} ↗
            </a>
          ) : null}
        </div>
        {s.context?.kind === 'wave' ? (
          <button type="button" className="icon-btn" aria-label="Не нравится" onClick={() => void player.dislikeCurrent()}>
            <IconThumbDown />
          </button>
        ) : null}
        <button
          type="button"
          className="icon-btn"
          aria-label="Скачать в Telegram"
          aria-disabled={!track.downloadable || undefined}
          onClick={() => void downloadToTelegram(track)}
          style={{ opacity: track.downloadable ? 1 : 0.45 }}
        >
          <IconDownload />
        </button>
        <button type="button" className="icon-btn" aria-pressed={liked} aria-label={liked ? 'Убрать из избранного' : 'В избранное'} onClick={() => void toggleLike(track)}>
          <IconHeart filled={liked} key={liked ? 'on' : 'off'} className={`icon ${liked ? 'liked' : ''}`} style={{ width: 26, height: 26 }} />
        </button>
      </div>

      {isPreview ? (
        <p className="preview-note" role="note">
          <IconInfo style={{ width: 16, height: 16, marginTop: 1 }} />
          <span>Это 30-секундное превью. Полную версию источник ({track.provider === 'deezer' ? 'Deezer' : 'каталог'}) в AURIS не даёт.</span>
        </p>
      ) : null}
      {reasons?.length ? <p className="reasons">Почему этот трек: {reasons.join(' · ')}</p> : null}
      {s.error ? (
        <p className="preview-note" role="alert">
          {s.error}
        </p>
      ) : null}

      <div className="controls glass">
        <div className="progress">
          <div className="progress-track">
            <div className="progress-buffer" style={{ width: `${bufPct}%` }} />
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(1, Math.floor(duration))}
            step={1}
            value={Math.floor(s.position)}
            aria-label="Позиция"
            aria-valuetext={`${formatDuration(s.position)} из ${formatDuration(duration)}`}
            onChange={(e) => player.seek(Number(e.target.value))}
          />
        </div>
        <div className="times">
          <span>{formatDuration(s.position)}</span>
          <span className="q">{s.qualityLine}</span>
          <span>{formatDuration(duration)}</span>
        </div>
        <div className="transport">
          <button type="button" className="icon-btn" aria-label="Перемешать" aria-pressed={s.shuffle} onClick={() => player.toggleShuffle()} disabled={s.context?.kind === 'wave'}>
            <IconShuffle />
          </button>
          <button type="button" className="icon-btn" aria-label="Предыдущий" onClick={() => player.prev()}>
            <IconPrev />
          </button>
          <button type="button" className="play-main" aria-label={s.playing ? 'Пауза' : 'Играть'} aria-busy={s.loading || undefined} onClick={() => player.toggle()}>
            {s.playing ? <IconPause /> : <IconPlay />}
          </button>
          <button type="button" className="icon-btn" aria-label="Следующий" onClick={() => player.next()}>
            <IconNext />
          </button>
          <button
            type="button"
            className="icon-btn"
            style={{ position: 'relative' }}
            aria-label={s.repeat === 'one' ? 'Повтор трека' : s.repeat === 'all' ? 'Повтор очереди' : 'Повтор выключен'}
            aria-pressed={s.repeat !== 'off'}
            onClick={() => player.cycleRepeat()}
          >
            <IconRepeat />
            {s.repeat === 'one' ? <span className="repeat-one">1</span> : null}
          </button>
        </div>
        <VolumeControl />
      </div>
    </section>
  );
}
