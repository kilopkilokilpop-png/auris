import type { Mood, QualityTier, Track, WaveMode } from '@auris/shared';
import { api, ApiFailure } from './api';
import { Store } from './store';
import { tg } from './telegram';

export type Repeat = 'off' | 'all' | 'one';
export interface PlayContext {
  label: string;
  kind: 'list' | 'wave';
  wave?: { mood: Mood; mode: WaveMode };
}
export interface PlayerState {
  queue: Track[];
  index: number;
  /** Reasons from Резонанс, keyed by track id */
  reasons: Record<string, string[]>;
  context: PlayContext | null;
  playing: boolean;
  loading: boolean;
  position: number;
  duration: number;
  buffered: number;
  shuffle: boolean;
  repeat: Repeat;
  qualityLine: string;
  streamKind: 'full' | 'preview' | null;
  error: string | null;
  expanded: boolean;
}

const initial: PlayerState = {
  queue: [],
  index: -1,
  reasons: {},
  context: null,
  playing: false,
  loading: false,
  position: 0,
  duration: 0,
  buffered: 0,
  shuffle: false,
  repeat: 'off',
  qualityLine: '',
  streamKind: null,
  error: null,
  expanded: false,
};

// 0.1 s of silence — used to unlock the <audio> element synchronously inside a user gesture (iOS).
const SILENCE = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
const WAVE_PREFETCH_AT = 3;

/**
 * One global player for the whole app. The <audio> element lives outside React, so navigation
 * never interrupts playback. Playback starts only from user actions (autoplay policies).
 */
class Player {
  readonly store = new Store<PlayerState>(initial);
  private audio: HTMLAudioElement;
  private quality: QualityTier = 'standard';
  private unlocked = false;
  private listened = 0;
  private lastTime = 0;
  private reported = new Set<string>();
  private loadSeq = 0;
  private waveLoading = false;
  private history: string[] = [];

  constructor() {
    this.audio = typeof Audio !== 'undefined' ? new Audio() : ({} as HTMLAudioElement);
    if (typeof document === 'undefined') return;
    this.audio.preload = 'auto';
    this.audio.setAttribute('playsinline', '');
    this.audio.setAttribute('aria-hidden', 'true');
    document.body.appendChild(this.audio);
    const a = this.audio;
    a.addEventListener('play', () => a.src !== SILENCE && this.store.set({ playing: true }));
    a.addEventListener('pause', () => a.src !== SILENCE && this.store.set({ playing: false }));
    a.addEventListener('waiting', () => this.store.set({ loading: true }));
    a.addEventListener('playing', () => this.store.set({ loading: false, error: null }));
    a.addEventListener('loadedmetadata', () => this.store.set({ duration: Number.isFinite(a.duration) ? a.duration : this.current?.playback.playableSec ?? 0 }));
    a.addEventListener('timeupdate', () => {
      const t = a.currentTime;
      const d = t - this.lastTime;
      if (d > 0 && d < 2) this.listened += d;
      this.lastTime = t;
      const buffered = a.buffered.length ? a.buffered.end(a.buffered.length - 1) : 0;
      this.store.set({ position: t, buffered });
      this.updatePositionState();
    });
    a.addEventListener('ended', () => this.onEnded());
    a.addEventListener('error', () => {
      if (a.src === SILENCE || !this.current) return;
      this.store.set({ error: 'Не удалось воспроизвести трек', loading: false, playing: false });
    });
    this.setupMediaSession();
  }

  get state() {
    return this.store.get();
  }
  get current(): Track | undefined {
    const s = this.store.get();
    return s.queue[s.index];
  }

  setQuality(q: QualityTier) {
    const changed = q !== this.quality;
    this.quality = q;
    if (changed && this.current && this.state.playing) void this.load(this.state.index, true, this.audio.currentTime);
  }

  /** Must be called synchronously from a click/tap handler. */
  /** Must be called synchronously from a click/tap handler (iOS autoplay rules). */
  prime() {
    this.unlock();
  }
  private unlock() {
    if (this.unlocked) return;
    try {
      this.audio.src = SILENCE;
      const p = this.audio.play();
      void p?.then(() => (this.unlocked = true)).catch(() => {});
    } catch {
      /* ignore */
    }
  }

  playList(tracks: Track[], start: number, context: PlayContext) {
    const playable = tracks.filter((t) => t.playback.kind !== 'none');
    if (!playable.length) return;
    const startTrack = tracks[start];
    const idx = Math.max(0, startTrack ? playable.findIndex((t) => t.id === startTrack.id) : 0);
    this.unlock();
    this.finishCurrent('skip');
    this.store.set({ queue: playable, index: idx, context, reasons: {} });
    tg.haptic.tap();
    void this.load(idx, true);
  }

  /** Резонанс: start (or restart) the endless wave. */
  async startWave(mood: Mood, mode: WaveMode) {
    this.unlock();
    this.finishCurrent('skip');
    tg.haptic.medium();
    this.store.set({ context: { label: 'Резонанс', kind: 'wave', wave: { mood, mode } }, loading: true, error: null });
    try {
      const r = await api.waveNext({ mood, mode, exclude: this.history.slice(-50), recentArtists: [], count: 6 });
      if (!r.items.length) throw new ApiFailure('NOT_FOUND', 'Нечего предложить — попробуйте другое настроение', 404);
      this.store.set({
        queue: r.items.map((i) => i.track),
        index: 0,
        reasons: Object.fromEntries(r.items.map((i) => [i.track.id, i.reasons])),
      });
      await this.load(0, true);
    } catch (e) {
      this.store.set({ loading: false, error: (e as Error).message });
      throw e;
    }
  }

  /** Mood/mode changed or a like/dislike: rebuild what comes next, keep the current track. */
  async refreshWave(next?: { mood: Mood; mode: WaveMode }) {
    const s = this.state;
    if (s.context?.kind !== 'wave') return;
    const wave = next ?? s.context.wave!;
    if (next) this.store.set({ context: { ...s.context, wave } });
    const head = s.queue.slice(0, s.index + 1);
    try {
      const r = await api.waveNext({
        ...wave,
        exclude: [...new Set([...this.history.slice(-50), ...head.map((t) => t.id)])],
        recentArtists: head.slice(-2).map((t) => t.artist.id),
        count: 5,
      });
      const cur = this.state;
      this.store.set({
        queue: [...cur.queue.slice(0, cur.index + 1), ...r.items.map((i) => i.track)],
        reasons: { ...cur.reasons, ...Object.fromEntries(r.items.map((i) => [i.track.id, i.reasons])) },
      });
    } catch {
      /* keep the old queue */
    }
  }

  private async extendWave() {
    const s = this.state;
    if (s.context?.kind !== 'wave' || this.waveLoading) return;
    if (s.queue.length - s.index - 1 >= WAVE_PREFETCH_AT) return;
    this.waveLoading = true;
    try {
      const r = await api.waveNext({
        ...s.context.wave!,
        exclude: [...new Set([...this.history.slice(-50), ...s.queue.map((t) => t.id)])],
        recentArtists: s.queue.slice(-2).map((t) => t.artist.id),
        count: 5,
      });
      const cur = this.state;
      this.store.set({
        queue: [...cur.queue, ...r.items.map((i) => i.track)],
        reasons: { ...cur.reasons, ...Object.fromEntries(r.items.map((i) => [i.track.id, i.reasons])) },
      });
    } catch {
      /* retry on next track */
    } finally {
      this.waveLoading = false;
    }
  }

  private async load(index: number, autoplay: boolean, seekTo = 0) {
    const track = this.state.queue[index];
    if (!track) return;
    const seq = ++this.loadSeq;
    this.listened = 0;
    this.lastTime = seekTo;
    this.store.set({ index, loading: true, error: null, position: seekTo, duration: track.playback.playableSec, buffered: 0, streamKind: track.playback.kind === 'none' ? null : track.playback.kind });
    this.setMetadata(track);
    try {
      const info = await api.streamUrl(track.id, this.quality);
      if (seq !== this.loadSeq) return;
      this.store.set({ qualityLine: info.qualityLine, streamKind: info.kind });
      this.audio.src = info.url;
      if (seekTo) this.audio.currentTime = seekTo;
      if (autoplay) {
        await this.audio.play();
        if (!this.reported.has(`${track.id}:${index}`)) {
          this.reported.add(`${track.id}:${index}`);
          void api.event(track.id, 'play_start', { context: this.state.context?.kind });
          this.history.push(track.id);
        }
      }
    } catch (e) {
      if (seq !== this.loadSeq) return;
      const msg = e instanceof ApiFailure ? e.message : 'Нажмите ▶, чтобы продолжить';
      this.store.set({ loading: false, playing: false, error: msg });
    }
    void this.extendWave();
  }

  /** Reports how the current track ended for recommendations. */
  private finishCurrent(how: 'skip' | 'complete') {
    const t = this.current;
    if (!t || this.audio.src === SILENCE || !this.audio.src) return;
    const pos = this.audio.currentTime || 0;
    if (how === 'complete') void api.event(t.id, 'play_complete', { listenedSec: Math.round(this.listened), positionSec: pos });
    else if (pos > 1) void api.event(t.id, 'skip', { positionSec: Math.round(pos), listenedSec: Math.round(this.listened) });
    this.listened = 0;
  }

  private onEnded() {
    // The silent unlock clip also fires "ended" — never treat it as a finished track.
    if (this.audio.src === SILENCE) return;
    const s = this.state;
    if (!this.current) return;
    this.finishCurrent('complete');
    if (s.repeat === 'one') {
      void api.event(this.current.id, 'repeat');
      this.audio.currentTime = 0;
      void this.audio.play();
      return;
    }
    this.advance(1, false);
  }

  private advance(dir: 1 | -1, user: boolean) {
    const s = this.state;
    let i = s.index + dir;
    if (s.shuffle && dir === 1 && s.context?.kind !== 'wave' && s.queue.length > 1) {
      do i = Math.floor(Math.random() * s.queue.length);
      while (i === s.index);
    }
    if (i >= s.queue.length) {
      if (s.repeat === 'all') i = 0;
      else {
        this.store.set({ playing: false, position: 0 });
        return;
      }
    }
    if (i < 0) i = 0;
    if (user) tg.haptic.select();
    void this.load(i, true);
  }

  toggle() {
    if (!this.current) return;
    tg.haptic.tap();
    if (this.audio.paused) {
      if (!this.audio.src || this.audio.src === SILENCE || this.state.error) {
        this.unlock();
        void this.load(this.state.index, true, this.state.position);
      } else void this.audio.play().catch(() => this.store.set({ error: 'Нажмите ▶ ещё раз' }));
    } else this.audio.pause();
  }
  next() {
    this.unlock();
    this.finishCurrent('skip');
    this.advance(1, true);
  }
  prev() {
    this.unlock();
    if (this.audio.currentTime > 3) {
      this.audio.currentTime = 0;
      if (this.current) void api.event(this.current.id, 'repeat');
      return;
    }
    this.advance(-1, true);
  }
  seek(sec: number) {
    if (!Number.isFinite(sec)) return;
    this.audio.currentTime = Math.max(0, Math.min(sec, this.state.duration || sec));
    this.store.set({ position: this.audio.currentTime });
  }
  toggleShuffle() {
    tg.haptic.select();
    this.store.set((s) => ({ shuffle: !s.shuffle }));
  }
  cycleRepeat() {
    tg.haptic.select();
    this.store.set((s) => ({ repeat: s.repeat === 'off' ? 'all' : s.repeat === 'all' ? 'one' : 'off' }));
  }
  /** Dislike: skip right away and rebuild the wave. */
  async dislikeCurrent() {
    const t = this.current;
    if (!t) return;
    tg.haptic.warning();
    await api.dislike(t.id).catch(() => {});
    this.advance(1, false);
    void this.refreshWave();
  }
  expand(v: boolean) {
    this.store.set({ expanded: v });
  }
  stop() {
    this.audio.pause();
    this.store.set({ ...initial });
  }

  // ---------- Media Session ----------
  private setupMediaSession() {
    const ms = navigator.mediaSession;
    if (!ms) return;
    const h = (a: MediaSessionAction, fn: MediaSessionActionHandler) => {
      try {
        ms.setActionHandler(a, fn);
      } catch {
        /* unsupported action */
      }
    };
    h('play', () => void this.audio.play());
    h('pause', () => this.audio.pause());
    h('nexttrack', () => this.next());
    h('previoustrack', () => this.prev());
    h('seekto', (d) => d.seekTime !== undefined && this.seek(d.seekTime));
    h('seekbackward', (d) => this.seek(this.audio.currentTime - (d.seekOffset ?? 10)));
    h('seekforward', (d) => this.seek(this.audio.currentTime + (d.seekOffset ?? 10)));
  }
  private setMetadata(t: Track) {
    const ms = navigator.mediaSession;
    if (!ms || typeof MediaMetadata === 'undefined') return;
    const src = t.coverUrl ? new URL(t.coverUrl, location.href).toString() : undefined;
    ms.metadata = new MediaMetadata({
      title: t.title,
      artist: t.artist.name,
      album: t.playback.kind === 'preview' ? `${t.album?.title ?? ''} · превью 30 с`.trim() : (t.album?.title ?? 'AURIS'),
      artwork: src ? [{ src, sizes: '600x600', type: 'image/jpeg' }] : [],
    });
  }
  private updatePositionState() {
    const ms = navigator.mediaSession;
    const d = this.audio.duration;
    if (!ms?.setPositionState || !Number.isFinite(d) || d <= 0) return;
    try {
      ms.setPositionState({ duration: d, position: Math.min(this.audio.currentTime, d), playbackRate: this.audio.playbackRate || 1 });
    } catch {
      /* ignore */
    }
  }
}

export const player = new Player();
