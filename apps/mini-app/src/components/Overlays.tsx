import { useEffect, useState } from 'react';
import type { Playlist, Track } from '@auris/shared';
import { api } from '../lib/api';
import { player } from '../lib/player';
import { go } from '../lib/router';
import { downloadExplanation, downloadToTelegram, session, toggleLike } from '../lib/session';
import { useStore } from '../lib/store';
import { closeSheet, openSheet, toast, ui } from '../lib/ui';
import { tg } from '../lib/telegram';
import { Cover } from './Cover';
import { IconAlbum, IconDownload, IconHeart, IconInfo, IconPlay, IconPlus, IconThumbDown, IconUser } from './Icons';

export function ToastHost() {
  const t = useStore(ui, (s) => s.toast);
  if (!t) return null;
  return (
    <div className="toast" role="status" aria-live="polite" key={t.id}>
      <span>{t.text}</span>
      {t.action ? (
        <button type="button" className="btn" onClick={t.action.run}>
          {t.action.label}
        </button>
      ) : null}
    </div>
  );
}

export function SheetHost() {
  const sheet = useStore(ui, (s) => s.sheet);
  useEffect(() => {
    if (!sheet) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeSheet();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheet]);
  if (!sheet) return null;
  return (
    <>
      <div className="scrim" onClick={closeSheet} aria-hidden="true" />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={sheet.kind === 'info' ? sheet.title : 'Действия с треком'}>
        {sheet.kind === 'track' ? <TrackSheet track={sheet.track} /> : null}
        {sheet.kind === 'playlist-pick' ? <PlaylistPick track={sheet.track} /> : null}
        {sheet.kind === 'info' ? (
          <div className="sheet-body">
            <h2 className="h2">{sheet.title}</h2>
            <div className="sheet-body" style={{ padding: '8px 0 0' }}>
              {typeof sheet.body === 'string' ? <p>{sheet.body}</p> : sheet.body}
            </div>
            <div className="btn-row" style={{ justifyContent: 'stretch' }}>
              {sheet.action ? (
                <button
                  type="button"
                  className="btn primary block"
                  onClick={() => {
                    sheet.action!.run();
                    closeSheet();
                  }}
                >
                  {sheet.action.label}
                </button>
              ) : null}
              <button type="button" className="btn ghost block" onClick={closeSheet} autoFocus>
                Понятно
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}

function SheetItem({ icon, label, hint, onClick, disabled }: { icon: React.ReactNode; label: string; hint?: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="sheet-item" onClick={onClick} aria-disabled={disabled || undefined}>
      {icon}
      <span>
        {label}
        {hint ? <small>{hint}</small> : null}
      </span>
    </button>
  );
}

export function TrackSheet({ track }: { track: Track }) {
  const liked = useStore(session, (s) => s.liked.has(track.id));
  const isCurrent = useStore(player.store, (s) => s.queue[s.index]?.id === track.id);
  const run = (fn: () => void) => () => {
    closeSheet();
    fn();
  };
  return (
    <>
      <div className="sheet-head">
        <Cover src={track.coverUrl} />
        <span className="row-text">
          <span className="row-title" style={{ display: 'block' }}>
            {track.title}
          </span>
          <span className="row-sub" style={{ display: 'block' }}>
            {track.artist.name}
          </span>
        </span>
      </div>
      {!isCurrent && track.playback.kind !== 'none' ? (
        <SheetItem icon={<IconPlay />} label={track.playback.kind === 'preview' ? 'Слушать превью 30 с' : 'Слушать'} onClick={run(() => player.playList([track], 0, { label: 'Трек', kind: 'list' }))} />
      ) : null}
      <SheetItem icon={<IconHeart filled={liked} />} label={liked ? 'Убрать из избранного' : 'В избранное'} onClick={run(() => void toggleLike(track))} />
      <SheetItem icon={<IconPlus />} label="Добавить в плейлист" onClick={() => openSheet({ kind: 'playlist-pick', track })} />
      <SheetItem
        icon={<IconDownload />}
        label="Скачать в Telegram"
        hint={track.downloadable ? 'Бот пришлёт файл в чат' : downloadExplanation(track)}
        disabled={!track.downloadable}
        onClick={run(() => void downloadToTelegram(track))}
      />
      {isCurrent ? <SheetItem icon={<IconThumbDown />} label="Не нравится" hint="Пропустить и реже предлагать похожее" onClick={run(() => void player.dislikeCurrent())} /> : null}
      {track.album ? <SheetItem icon={<IconAlbum />} label="Открыть альбом" onClick={run(() => go.push({ name: 'album', id: track.album!.id }))} /> : null}
      <SheetItem icon={<IconUser />} label={`Артист: ${track.artist.name}`} onClick={run(() => go.push({ name: 'artist', id: track.artist.id }))} />
      <SheetItem
        icon={<IconInfo />}
        label="Источник и лицензия"
        hint={track.license.name}
        onClick={() =>
          openSheet({
            kind: 'info',
            title: 'Источник и лицензия',
            body: (
              <>
                <p>Лицензия: {track.license.name}</p>
                {track.license.attribution ? <p>Авторы: {track.license.attribution}</p> : null}
                <p>{track.playback.kind === 'preview' ? 'Доступно только 30-секундное превью — полную версию этот источник не предоставляет.' : track.playback.kind === 'full' ? 'Полная версия трека.' : 'Воспроизведение недоступно.'}</p>
                {track.license.sourceUrl ? (
                  <p>
                    <a href={track.license.sourceUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--text)' }}>
                      Страница трека у источника
                    </a>
                  </p>
                ) : null}
              </>
            ),
          })
        }
      />
    </>
  );
}

function PlaylistPick({ track }: { track: Track }) {
  const [lists, setLists] = useState<Playlist[] | null>(null);
  const [title, setTitle] = useState('');
  useEffect(() => {
    void api.playlists().then((r) => setLists(r.playlists), () => setLists([]));
  }, []);
  const add = async (id: string, name: string) => {
    await api.addToPlaylist(id, track.id);
    tg.haptic.success();
    closeSheet();
    toast(`Добавлено в «${name}»`);
  };
  const create = async () => {
    const name = title.trim();
    if (!name) return;
    const r = await api.createPlaylist(name);
    await add(r.id, name);
  };
  return (
    <div className="sheet-body">
      <h2 className="h2">В плейлист</h2>
      <form
        className="search-box glass"
        style={{ marginTop: 12 }}
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <label className="sr-only" htmlFor="pl-name">
          Название нового плейлиста
        </label>
        <input id="pl-name" placeholder="Новый плейлист" value={title} maxLength={64} onChange={(e) => setTitle(e.target.value)} />
        <button type="submit" className="icon-btn" aria-label="Создать плейлист" disabled={!title.trim()}>
          <IconPlus />
        </button>
      </form>
      {lists === null ? <p>Загрузка…</p> : null}
      {lists?.map((p) => (
        <button key={p.id} type="button" className="sheet-item" onClick={() => void add(p.id, p.title)}>
          <Cover src={p.coverUrl} className="sm" />
          <span>
            {p.title}
            <small>{p.trackCount} тр.</small>
          </span>
        </button>
      ))}
    </div>
  );
}
