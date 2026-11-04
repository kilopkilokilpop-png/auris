import { useState } from 'react';
import { MOOD_LABELS, WAVE_MODE_LABELS, type Mood, type WaveMode } from '@auris/shared';
import { Cover } from '../components/Cover';
import { SOURCE_NAMES } from '../components/Source';
import { IconHeart, IconNext, IconPause, IconPlay, IconThumbDown } from '../components/Icons';
import { Segmented } from '../components/Segmented';
import { player } from '../lib/player';
import { go, openPlayer } from '../lib/router';
import { session, toggleLike } from '../lib/session';
import { useStore } from '../lib/store';
import { tg } from '../lib/telegram';
import { api } from '../lib/api';
import { toast } from '../lib/ui';

const MOODS = Object.keys(MOOD_LABELS) as Mood[];
const MODES = Object.keys(WAVE_MODE_LABELS) as WaveMode[];

const isWaveQueue = (t: unknown) => Boolean(t);

export function Wave() {
  const profile = useStore(session, (s) => s.profile);
  const [mood, setMood] = useState<Mood>(profile?.settings.waveMood ?? 'any');
  const [mode, setMode] = useState<WaveMode>(profile?.settings.waveMode ?? 'mix');
  const [starting, setStarting] = useState(false);
  const isWave = useStore(player.store, (s) => s.context?.kind === 'wave');
  const playing = useStore(player.store, (s) => s.playing && s.context?.kind === 'wave');
  const track = useStore(player.store, (s) => (s.context?.kind === 'wave' ? s.queue[s.index] : undefined));
  const reasons = useStore(player.store, (s) => (track ? s.reasons[track.id] : undefined));
  const queue = useStore(player.store, (s) => s.queue);
  const index = useStore(player.store, (s) => s.index);
  const upNext = isWaveQueue(track) ? queue.slice(index + 1, index + 4) : [];
  const liked = useStore(session, (s) => (track ? s.liked.has(track.id) : false));
  const error = useStore(player.store, (s) => (s.context?.kind === 'wave' ? s.error : null));

  const start = async () => {
    if (!profile?.onboarded) {
      go.push({ name: 'onboarding' });
      return;
    }
    if (isWave && track) return player.toggle();
    setStarting(true);
    try {
      await player.startWave(mood, mode);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setStarting(false);
    }
  };
  const change = (m: Mood, md: WaveMode) => {
    setMood(m);
    setMode(md);
    tg.haptic.select();
    if (isWave) void player.refreshWave({ mood: m, mode: md });
    else void api.settings({ waveMood: m, waveMode: md }).catch(() => {});
  };

  const caption = starting
    ? { t: 'Подбираем музыку…', s: 'Смотрим, что вам нравится' }
    : playing
      ? { t: 'Резонанс играет', s: 'Лайки и пропуски сразу меняют очередь' }
      : isWave
        ? { t: 'На паузе', s: 'Нажмите, чтобы продолжить' }
        : { t: 'Нажмите, чтобы начать', s: 'Резонанс подберёт музыку сам' };

  return (
    <main className="screen" aria-label="Резонанс">
      <h1 className="h-display">Резонанс</h1>
      <p className="sub" style={{ fontSize: 15, lineHeight: 1.4, maxWidth: 320 }}>
        Бесконечный поток под ваш вкус. Чем больше слушаете — тем точнее совпадает.
      </p>

      <div className="orb-stage" style={{ height: 316, marginTop: -6 }}>
        <span className={`ring ${playing ? 'pulse d3' : ''}`} style={{ width: 262, height: 262 }} aria-hidden="true" />
        <span className={`ring ${playing ? 'pulse d2' : ''}`} style={{ width: 216, height: 216 }} aria-hidden="true" />
        {playing ? <span className="ring pulse" style={{ width: 172, height: 172 }} aria-hidden="true" /> : null}
        <button type="button" className="orb wave" onClick={() => void start()} aria-label={playing ? 'Пауза' : 'Запустить Резонанс'} aria-busy={starting || undefined}>
          {playing ? <IconPause /> : <IconPlay />}
        </button>
      </div>
      <div className="orb-caption tight" aria-live="polite" style={{ marginTop: -14 }}>
        <strong>{caption.t}</strong>
        <span>{caption.s}</span>
      </div>
      {error ? (
        <p className="notice" role="alert">
          {error}
        </p>
      ) : null}

      {track ? (
        <div className="wave-now glass">
          <button type="button" className="mini-open" onClick={() => openPlayer()} aria-label={`Открыть плеер: ${track.title}`}>
            <Cover src={track.coverUrl} className="sm" />
            <span className="row-text">
              <span className="row-title" style={{ display: 'block', fontSize: 14 }}>
                {track.title}
              </span>
              <span className="row-sub" style={{ display: 'block', fontSize: 12 }}>
                <span className="source-badge">{SOURCE_NAMES[track.provider] ?? track.provider}</span>
                {track.artist.name}
                {track.playback.kind === 'preview' ? ' · превью 30 с' : ''}
              </span>
              {reasons?.length ? <span className="reasons" style={{ display: 'block' }}>{reasons[0]}</span> : null}
            </span>
          </button>
          <div className="feedback">
            <button type="button" className="icon-btn" aria-label="Не нравится" onClick={() => void player.dislikeCurrent()}>
              <IconThumbDown />
            </button>
            <button type="button" className="icon-btn" aria-pressed={liked} aria-label={liked ? 'Убрать из избранного' : 'Нравится'} onClick={() => void toggleLike(track)}>
              <IconHeart filled={liked} />
            </button>
            <button type="button" className="icon-btn" aria-label="Следующий" onClick={() => player.next()}>
              <IconNext />
            </button>
          </div>
        </div>
      ) : null}

      {upNext.length ? (
        <section aria-label="Дальше в Резонансе" style={{ marginTop: 14 }}>
          <h2 className="label">Дальше</h2>
          <ul className="list" style={{ marginTop: 4 }}>
            {upNext.map((t) => (
              <li key={t.id} className="row up-next">
                <Cover src={t.coverUrl} className="sm" />
                <span className="row-text">
                  <span className="row-title" style={{ display: 'block', fontSize: 14 }}>
                    {t.title}
                  </span>
                  <span className="row-sub" style={{ display: 'block', fontSize: 12 }}>
                    <span className="source-badge">{SOURCE_NAMES[t.provider] ?? t.provider}</span>
                    {t.artist.name}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <h2 className="label" style={{ marginTop: 22 }}>
        Настроение
      </h2>
      <div className="chips" role="radiogroup" aria-label="Настроение" style={{ marginTop: 12, rowGap: 6 }}>
        {MOODS.map((m) => (
          <button key={m} type="button" role="radio" className="chip" aria-checked={m === mood} onClick={() => change(m, mode)}>
            {MOOD_LABELS[m]}
          </button>
        ))}
      </div>

      <h2 className="label" style={{ marginTop: 20 }}>
        Знакомое или новое
      </h2>
      <div style={{ marginTop: 12 }}>
        <Segmented label="Знакомое или новое" value={mode} onChange={(v) => change(mood, v)} options={MODES.map((m) => ({ value: m, label: WAVE_MODE_LABELS[m] }))} />
      </div>
    </main>
  );
}
