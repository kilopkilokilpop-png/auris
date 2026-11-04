import { useCallback, useEffect, useRef, useState } from 'react';
import type { Track } from '@auris/shared';
import { player } from '../lib/player';
import { useStore } from '../lib/store';
import { tg } from '../lib/telegram';
import { loadYouTubeApi, youTubeErrorText, type YTPlayer } from '../lib/youtube';

/** RMF: playback may start only when more than half of the player is on screen. */
const VISIBLE_TO_PLAY = 0.5;

/**
 * The official YouTube IFrame player, always visible, never covered (YouTube RMF):
 *  - ≥ 200×200 px (CSS min sizes), YouTube's own controls fully shown;
 *  - pauses when < 50 % visible, when the Mini App is minimised/hidden and on unmount;
 *  - starts only after a user action or inside the wave the user switched on, and only when > 50 % visible;
 *  - Made for Kids videos load from youtube-nocookie.com (privacy-enhanced, no tracking);
 *  - origin + widget_referrer identify AURIS; the page keeps a Referer (strict-origin-when-cross-origin).
 *    widget_referrer is origin + path only: inside Telegram the URL hash carries the signed initData, which must
 *    never leave AURIS (and the long URL makes YouTube refuse the embed).
 * Nothing is rendered above the iframe: AURIS controls live below it.
 */
export function YouTubeEmbed({ track }: { track: Track }) {
  const yt = track.youtube!;
  const box = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<YTPlayer | null>(null);
  const ready = useRef(false);
  const ratio = useRef(0);
  const pending = useRef(false);
  const loadedId = useRef<string | null>(null);
  const wants = useStore(player.store, (s) => s.embedWantsPlay);
  const [failed, setFailed] = useState<string | null>(null);

  // Refs only: stable across renders.
  const visible = useCallback(() => ratio.current > VISIBLE_TO_PLAY && document.visibilityState === 'visible', []);
  const tryStart = useCallback(() => {
    const p = instance.current;
    if (!p || !ready.current || !pending.current || !visible()) return;
    pending.current = false;
    p.playVideo();
  }, [visible]);

  // One IFrame player per mount (kids videos need the privacy-enhanced host).
  useEffect(() => {
    let dead = false;
    let poll: ReturnType<typeof setInterval> | undefined;
    loadYouTubeApi()
      .then((YT) => {
        if (dead || !host.current) return;
        instance.current = new YT.Player(host.current, {
          host: yt.madeForKids ? 'https://www.youtube-nocookie.com' : 'https://www.youtube.com',
          videoId: yt.videoId,
          width: '100%',
          height: '100%',
          playerVars: { playsinline: 1, rel: 0, enablejsapi: 1, origin: location.origin, widget_referrer: location.origin + location.pathname },
          events: {
            onReady: (e) => {
              ready.current = true;
              // Same volume as the rest of AURIS (official API; iOS keeps the hardware volume).
              e.target.setVolume(Math.round(player.state.volume * 100));
              loadedId.current = yt.videoId;
              tryStart();
            },
            onStateChange: (e) => {
              const p = e.target;
              const state = e.data === 1 ? 'playing' : e.data === 0 ? 'ended' : e.data === 3 ? 'buffering' : 'paused';
              // Not visible: anything that starts is paused at once and is not reported as playing.
              if ((state === 'playing' || state === 'buffering') && !visible()) {
                p.pauseVideo();
                player.onEmbedState('paused', p.getCurrentTime() || 0, p.getDuration() || 0);
                return;
              }
              if (state) player.onEmbedState(state, p.getCurrentTime() || 0, p.getDuration() || 0);
            },
            onError: (e) => {
              const text = youTubeErrorText(e.data);
              setFailed(text);
              player.onEmbedError(text);
            },
          },
        });
        player.attachEmbed({
          play: () => {
            pending.current = true;
            tryStart();
          },
          pause: () => instance.current?.pauseVideo(),
          setVolume: (v) => {
            const p = instance.current;
            if (!p || !ready.current) return;
            p.setVolume(Math.round(v * 100));
            if (v > 0) p.unMute();
            else p.mute();
          },
        });
        poll = setInterval(() => {
          const p = instance.current;
          if (!p || !ready.current) return;
          const st = p.getPlayerState();
          // A pause requested while buffering can be dropped by the player: keep enforcing it while not visible.
          if ((st === 1 || st === 3) && !visible()) {
            p.pauseVideo();
            player.onEmbedState('paused', p.getCurrentTime() || 0, p.getDuration() || 0);
            return;
          }
          // Mirror the player's real state (unstarted / cued / paused fire no event in some cases).
          if (st !== 0) player.onEmbedState(st === 1 ? 'playing' : st === 3 ? 'buffering' : 'paused', p.getCurrentTime() || 0, p.getDuration() || 0);
        }, 500);
      })
      .catch(() => {
        if (!dead) setFailed('YouTube сейчас недоступен. Проверьте соединение.');
      });
    return () => {
      dead = true;
      if (poll) clearInterval(poll);
      player.attachEmbed(null);
      try {
        instance.current?.destroy();
      } catch {
        /* already gone */
      }
      instance.current = null;
      ready.current = false;
    };
    // The player is rebuilt only when the host must change (kids <-> regular).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yt.madeForKids]);

  // Next / previous track: swap the video in the same official player.
  useEffect(() => {
    setFailed(null);
    const p = instance.current;
    if (!p || !ready.current || loadedId.current === yt.videoId) return;
    loadedId.current = yt.videoId;
    p.cueVideoById(yt.videoId);
  }, [yt.videoId]);

  // A user action (tap in a list, ▶, next) or the wave asked to play.
  useEffect(() => {
    if (!wants) return;
    pending.current = true;
    tryStart();
  }, [wants, yt.videoId, tryStart]);

  // Visibility: pause below 50 %, resume a pending start above it.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        ratio.current = e?.intersectionRatio ?? 0;
        if (!visible()) instance.current?.pauseVideo();
        else tryStart();
      },
      { threshold: [0, 0.25, 0.5, 0.51, 0.75, 1] },
    );
    io.observe(el);
    const off = tg.onHidden(() => instance.current?.pauseVideo());
    // Toasts move away from the top of the screen while a YouTube player is shown.
    document.documentElement.dataset.ytVisible = '1';
    return () => {
      io.disconnect();
      off();
      delete document.documentElement.dataset.ytVisible;
    };
  }, [tryStart, visible]);

  return (
    <div className="yt-wrap">
      <div ref={box} className="yt-frame" data-testid="youtube-player">
        <div ref={host} />
      </div>
      {failed ? (
        <p className="preview-note" role="alert">
          {failed}{' '}
          <a href={`https://www.youtube.com/watch?v=${yt.videoId}`} target="_blank" rel="noopener">
            Открыть на YouTube
          </a>
        </p>
      ) : null}
    </div>
  );
}
