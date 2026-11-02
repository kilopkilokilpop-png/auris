import { useEffect, useRef, useState } from 'react';
import type { Recognition } from '@auris/shared';
import { Cover } from '../components/Cover';
import { IconDownload, IconHeart, IconPlay, IconSend, LogoMark } from '../components/Icons';
import { Empty, ErrorState, SkeletonRows } from '../components/States';
import { api, ApiFailure } from '../lib/api';
import { player } from '../lib/player';
import { downloadExplanation, downloadToTelegram, session, toggleLike } from '../lib/session';
import { useQuery, useStore } from '../lib/store';
import { tg } from '../lib/telegram';
import { canRecord, recordClip, type RecordError } from '../lib/recorder';

const SECONDS = 9;

type Phase =
  | { k: 'idle' }
  | { k: 'recording'; left: number }
  | { k: 'thinking' }
  | { k: 'result'; r: Recognition }
  | { k: 'error'; title: string; text: string; bot?: boolean };

function when(iso: string): string {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return 'сегодня';
  if (days === 1) return 'вчера';
  if (days < 7) return `${days} дн. назад`;
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

export function Hear() {
  const [phase, setPhase] = useState<Phase>({ k: 'idle' });
  const [level, setLevel] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const history = useQuery('recognitions', () => api.recognitions());
  const liked = useStore(session, (s) => s.liked);
  useEffect(() => () => abort.current?.abort(), []);

  const errorFor = (e: unknown): Phase => {
    const kind = (e as { kind?: RecordError }).kind;
    if (kind === 'denied') return { k: 'error', title: 'Нет доступа к микрофону', text: 'Разрешите микрофон для Telegram в настройках телефона — или отправьте голосовое сообщение боту, он тоже распознаёт.', bot: true };
    if (kind === 'unsupported') return { k: 'error', title: 'Запись здесь недоступна', text: 'Этот клиент Telegram не даёт Mini App доступ к микрофону. Отправьте боту голосовое или аудиофайл — он распознает песню.', bot: true };
    if (kind === 'no-device') return { k: 'error', title: 'Микрофон не найден', text: 'Подключите микрофон или отправьте голосовое боту.', bot: true };
    if (e instanceof ApiFailure) {
      if (e.code === 'RECOGNITION_NOT_FOUND') return { k: 'error', title: 'Не удалось распознать', text: 'Поднесите телефон ближе к источнику звука и попробуйте ещё раз.' };
      if (e.code === 'RECOGNITION_UNAVAILABLE') return { k: 'error', title: 'Сервис недоступен', text: 'Распознавание временно не работает. Попробуйте позже или отправьте голосовое боту.', bot: true };
      if (e.code === 'RATE_LIMITED') return { k: 'error', title: 'Слишком часто', text: e.message };
      return { k: 'error', title: 'Ошибка', text: e.message };
    }
    return { k: 'error', title: 'Запись не удалась', text: 'Попробуйте ещё раз.' };
  };

  const start = async () => {
    if (phase.k === 'recording' || phase.k === 'thinking') {
      abort.current?.abort();
      return;
    }
    tg.haptic.medium();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setPhase({ k: 'recording', left: SECONDS });
    const t0 = Date.now();
    const iv = setInterval(() => setPhase((p) => (p.k === 'recording' ? { k: 'recording', left: Math.max(0, SECONDS - Math.floor((Date.now() - t0) / 1000)) } : p)), 250);
    try {
      const clip = await recordClip(SECONDS, setLevel, ctrl.signal);
      clearInterval(iv);
      if (ctrl.signal.aborted && Date.now() - t0 < 3000) {
        setPhase({ k: 'idle' });
        return;
      }
      setPhase({ k: 'thinking' });
      tg.haptic.tap();
      // The clip lives only in memory and is dropped after upload.
      const r = await api.recognize(clip.blob, clip.filename);
      tg.haptic.success();
      setPhase({ k: 'result', r });
      history.reload();
    } catch (e) {
      clearInterval(iv);
      tg.haptic.error();
      setPhase(errorFor(e));
    } finally {
      setLevel(0);
    }
  };

  const recording = phase.k === 'recording';
  const thinking = phase.k === 'thinking';
  const caption =
    phase.k === 'recording'
      ? { t: 'Слушаю…', s: `Ещё ${phase.left} с — держите телефон ближе к звуку` }
      : thinking
        ? { t: 'Ищем совпадение…', s: 'Обычно это пара секунд' }
        : phase.k === 'error'
          ? { t: phase.title, s: phase.text }
          : { t: 'Нажмите, и Auris послушает', s: 'Распознаём песню за несколько секунд' };

  return (
    <main className="screen pinned-foot" aria-label="Слух">
      <h1 className="h-display">Слух</h1>
      <p className="sub" style={{ fontSize: 15 }}>
        Узнайте, что сейчас играет вокруг
      </p>

      {phase.k === 'result' ? (
        <ResultCard r={phase.r} onAgain={() => setPhase({ k: 'idle' })} liked={!!phase.r.track && liked.has(phase.r.track.id)} />
      ) : (
        <>
          <div className="orb-stage" style={{ height: 336, marginTop: 6 }}>
            {recording ? (
              <>
                <span className="rec-level" style={{ width: 200, height: 200, transform: `scale(${1.08 + level * 0.5})`, opacity: 0.5 }} aria-hidden="true" />
                <span className="ring pulse" style={{ width: 200, height: 200 }} aria-hidden="true" />
                <span className="ring pulse d2" style={{ width: 200, height: 200 }} aria-hidden="true" />
              </>
            ) : null}
            {thinking ? <span className="ring pulse" style={{ width: 200, height: 200 }} aria-hidden="true" /> : null}
            <button
              type="button"
              className="orb hear"
              onClick={() => void start()}
              aria-label={recording ? 'Остановить запись' : thinking ? 'Распознаём' : 'Распознать песню'}
              aria-busy={thinking || undefined}
              disabled={thinking}
            >
              <span style={{ transform: recording ? `scale(${1 + level * 0.12})` : undefined, transition: 'transform 90ms linear', display: 'grid' }}>
                <LogoMark size={76} />
              </span>
            </button>
          </div>
          <div className="orb-caption" aria-live="polite" style={{ marginTop: 6 }}>
            <strong>{caption.t}</strong>
            <span className={recording ? 'countdown' : undefined}>{caption.s}</span>
          </div>
          {phase.k === 'error' && phase.bot ? (
            <div className="btn-row">
              <button type="button" className="btn ghost" onClick={() => tg.openBot(tg.botUsername ? `https://t.me/${tg.botUsername}` : undefined) || undefined}>
                <IconSend style={{ width: 18, height: 18 }} /> Отправить голосовое боту
              </button>
            </div>
          ) : null}
          {!canRecord() && phase.k === 'idle' ? <p className="notice">Если запись не начнётся, отправьте боту голосовое сообщение или аудиофайл — это работает в любом клиенте Telegram.</p> : null}
        </>
      )}

      <section className="section foot" aria-labelledby="found-h">
        <h2 className="label" id="found-h" style={{ marginBottom: 10 }}>
          Недавно найденные
        </h2>
        {history.loading && !history.data ? <SkeletonRows n={1} /> : null}
        {history.error ? <ErrorState error={history.error} onRetry={history.reload} /> : null}
        {history.data && !history.data.items.length ? <Empty title="Пока ничего">Найденные песни — из Mini App и из голосовых боту — появятся здесь.</Empty> : null}
        <ul className="list">
          {history.data?.items.slice(0, 8).map((r) => (
            <li key={r.id} className="row">
              <button
                type="button"
                className="row-main"
                onClick={() => (r.track && r.track.playback.kind !== 'none' ? player.playList([r.track], 0, { label: 'Слух', kind: 'list' }) : setPhase({ k: 'result', r }))}
                aria-label={`${r.title}, ${r.artist}`}
              >
                <Cover src={r.coverUrl ?? r.track?.coverUrl} className="sm" />
                <span className="row-text">
                  <span className="row-title" style={{ display: 'block', fontSize: 14 }}>
                    {r.title}
                  </span>
                  <span className="row-sub" style={{ display: 'block', fontSize: 13 }}>
                    {r.artist} · {when(r.createdAt)}
                    {r.source === 'bot' ? ' · из бота' : ''}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function ResultCard({ r, onAgain, liked }: { r: Recognition; onAgain: () => void; liked: boolean }) {
  const t = r.track;
  const playable = t && t.playback.kind !== 'none';
  return (
    <section style={{ marginTop: 28 }} aria-live="polite" aria-label="Результат">
      <div className="result-card glass">
        <Cover src={r.coverUrl ?? t?.coverUrl} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <p className="label">Найдено</p>
          <h2 className="h2" style={{ marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {r.title}
          </h2>
          <p className="muted" style={{ margin: '2px 0 0', fontSize: 14 }}>
            {r.artist}
            {r.album ? ` · ${r.album}` : ''}
          </p>
        </div>
      </div>
      {r.unavailableReason ? <p className="notice">{r.unavailableReason}</p> : null}
      <div className="actions">
        {playable ? (
          <button type="button" className="btn primary block" onClick={() => player.playList([t], 0, { label: 'Слух', kind: 'list' })}>
            <IconPlay style={{ width: 18, height: 18 }} /> {t.playback.kind === 'preview' ? 'Слушать превью 30 с' : 'Слушать'}
          </button>
        ) : null}
        {t ? (
          <button type="button" className="btn ghost block" aria-pressed={liked} onClick={() => void toggleLike(t)}>
            <IconHeart filled={liked} style={{ width: 18, height: 18 }} /> {liked ? 'В избранном' : 'В избранное'}
          </button>
        ) : null}
        {t ? (
          <button type="button" className="btn ghost block" aria-disabled={!t.downloadable || undefined} onClick={() => void downloadToTelegram(t)}>
            <IconDownload style={{ width: 18, height: 18 }} /> Скачать в Telegram
          </button>
        ) : null}
        {t && !t.downloadable ? <p className="note center" style={{ margin: 0 }}>{downloadExplanation(t)}</p> : null}
        <button type="button" className="btn ghost block" onClick={onAgain}>
          Распознать ещё
        </button>
      </div>
    </section>
  );
}
