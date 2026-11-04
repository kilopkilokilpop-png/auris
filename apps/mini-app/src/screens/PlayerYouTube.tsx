import { useEffect, useRef } from 'react';
import { IconChevronDown, IconHeart, IconInfo, IconNext, IconPause, IconPlay, IconPlus, IconPrev, IconThumbDown } from '../components/Icons';
import { SOURCE_NAMES } from '../components/Source';
import { VolumeControl } from '../components/Volume';
import { YouTubeEmbed } from '../components/YouTubeEmbed';
import { player } from '../lib/player';
import { closePlayer } from '../lib/router';
import { session, toggleLike } from '../lib/session';
import { useStore } from '../lib/store';
import { openSheet } from '../lib/ui';

/**
 * Player for YouTube tracks. Differences from the design (YouTube rules win):
 *  - the official video player replaces the square cover;
 *  - no progress bar / volume / shuffle / repeat of our own (YouTube's controls are inside its player);
 *  - no "more" sheet over the player; adding to a playlist closes the player first;
 *  - no quality line or badges.
 */
export function YouTubePlayerScreen() {
  const s = useStore(player.store, (x) => x);
  const track = s.queue[s.index]!;
  const yt = track.youtube!;
  const liked = useStore(session, (x) => x.liked.has(track.id));
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => closeRef.current?.focus(), []);
  const next = s.queue[s.index + 1];
  const reasons = s.reasons[track.id];
  const kids = yt.madeForKids;

  return (
    <section className="player yt" role="dialog" aria-modal="true" aria-label="Плеер YouTube">
      <div className="player-top">
        <button ref={closeRef} type="button" className="icon-btn glass" aria-label="Свернуть плеер (YouTube остановится)" onClick={() => closePlayer()}>
          <IconChevronDown />
        </button>
        <div className="player-from">
          <p className="label">Играет из</p>
          <strong>{s.context?.label ?? 'AURIS'}</strong>
        </div>
        <span aria-hidden="true" />
      </div>

      {/* Official YouTube player in place of the cover. Nothing is drawn over it. */}
      <YouTubeEmbed key={kids ? 'kids' : 'yt'} track={track} />

      <div className="player-meta">
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* YouTube data exactly as returned by the API. */}
          <h1 className="player-title">{track.title}</h1>
          <p className="player-artist">{yt.channelTitle}</p>
          <p className="attribution">
            <a className="source-link" href={track.license.sourceUrl} target="_blank" rel="noopener">
              Источник: YouTube ↗
            </a>
            <a className="source-link" href={`https://www.youtube.com/channel/${yt.channelId}`} target="_blank" rel="noopener">
              Канал на YouTube ↗
            </a>
          </p>
        </div>
        {!kids && s.context?.kind === 'wave' ? (
          <button type="button" className="icon-btn" aria-label="Не нравится" onClick={() => void player.dislikeCurrent()}>
            <IconThumbDown />
          </button>
        ) : null}
        {!kids ? (
          <>
            <button
              type="button"
              className="icon-btn"
              aria-label="Добавить в плейлист (плеер свернётся)"
              onClick={() => {
                // Sheets and their backdrop must never cover the YouTube player: close it first (playback stops).
                closePlayer();
                openSheet({ kind: 'playlist-pick', track });
              }}
            >
              <IconPlus />
            </button>
            <button type="button" className="icon-btn" aria-pressed={liked} aria-label={liked ? 'Убрать из избранного AURIS' : 'В избранное AURIS'} onClick={() => void toggleLike(track)}>
              <IconHeart filled={liked} key={liked ? 'on' : 'off'} className={`icon ${liked ? 'liked' : ''}`} style={{ width: 26, height: 26 }} />
            </button>
          </>
        ) : null}
      </div>

      {kids ? (
        <p className="preview-note" role="note">
          <IconInfo style={{ width: 16, height: 16, marginTop: 1 }} />
          <span>Видео «Сделано для детей»: AURIS не сохраняет действия с ним и не использует его в рекомендациях.</span>
        </p>
      ) : null}
      {reasons?.length ? <p className="reasons">Почему этот трек: {reasons.join(' · ')}</p> : null}
      {/* Embed errors are shown right under the player by YouTubeEmbed. */}

      <div className="controls glass">
        <div className="transport yt-transport">
          <button type="button" className="icon-btn" aria-label="Предыдущий" onClick={() => player.prev()} disabled={s.index <= 0}>
            <IconPrev />
          </button>
          <button type="button" className="play-main" aria-label={s.playing ? 'Пауза' : 'Играть'} aria-busy={s.loading || undefined} onClick={() => player.toggle()}>
            {s.playing ? <IconPause /> : <IconPlay />}
          </button>
          <button type="button" className="icon-btn" aria-label="Следующий" onClick={() => player.next()} disabled={!next}>
            <IconNext />
          </button>
        </div>
        <VolumeControl />
        <p className="yt-hint">
          {s.context?.kind === 'wave' ? 'Резонанс включит следующий трек сам, пока плеер на экране.' : 'Видео играет, пока плеер открыт. Свернёте — воспроизведение остановится.'}
        </p>
        {next ? (
          <p className="next-up">
            Дальше: <b>{next.title}</b> · {SOURCE_NAMES[next.provider] ?? next.provider}
          </p>
        ) : null}
      </div>
    </section>
  );
}
