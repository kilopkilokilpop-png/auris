import { useState } from 'react';
import { plural } from '@auris/shared';
import { Cover } from '../components/Cover';
import { IconGear } from '../components/Icons';
import { Segmented } from '../components/Segmented';
import { Empty, ErrorState, SkeletonRows } from '../components/States';
import { TrackList } from '../components/TrackRow';
import { api } from '../lib/api';
import { player } from '../lib/player';
import { go } from '../lib/router';
import { session } from '../lib/session';
import { useQuery, useStore } from '../lib/store';

type TabId = 'tracks' | 'albums' | 'playlists' | 'hear';

function fmtHours(h: number) {
  return h < 10 ? String(h).replace('.', ',') : String(Math.round(h));
}

export function Profile() {
  const p = useStore(session, (s) => s.profile);
  const likedVersion = useStore(session, (s) => s.likedVersion);
  const [tab, setTab] = useState<TabId>('tracks');
  const tracks = useQuery(tab === 'tracks' ? `liked:${likedVersion}` : null, () => api.liked());
  const albums = useQuery(tab === 'albums' ? 'albums' : null, () => api.likedAlbums());
  const lists = useQuery(tab === 'playlists' ? 'playlists' : null, () => api.playlists());
  const hear = useQuery(tab === 'hear' ? 'hear' : null, () => api.recognitions());
  const name = p ? [p.firstName, p.lastName].filter(Boolean).join(' ') : '';
  const initial = (p?.firstName || 'A').slice(0, 1).toUpperCase();

  return (
    <main className="screen" aria-label="Профиль">
      <div className="page-head">
        <h1 className="h-display">Профиль</h1>
        <button type="button" className="icon-btn glass" aria-label="Настройки" onClick={() => go.push({ name: 'settings' })}>
          <IconGear />
        </button>
      </div>

      <section className="user-card glass" aria-label="Пользователь">
        <span className="avatar-lg" aria-hidden="true">
          {p?.photoUrl ? <img src={p.photoUrl} alt="" /> : initial}
        </span>
        <div style={{ minWidth: 0 }}>
          <h2 className="user-name">{name || 'Слушатель'}</h2>
          {p?.isMaster ? <span className="master">AURIS MASTER</span> : p?.username ? <p className="muted" style={{ margin: '4px 0 0', fontSize: 14 }}>@{p.username}</p> : null}
        </div>
      </section>

      <div className="stats">
        <div className="stat glass">
          <b>{p?.stats.liked ?? '—'}</b>
          <span>в избранном</span>
        </div>
        <div className="stat glass">
          <b>{p?.stats.playlists ?? '—'}</b>
          <span>{p ? plural(p.stats.playlists, ['плейлист', 'плейлиста', 'плейлистов']) : 'плейлистов'}</span>
        </div>
        <div className="stat glass">
          <b>{p ? `${fmtHours(p.stats.listenedHours)} ч` : '—'}</b>
          <span>прослушано</span>
        </div>
      </div>

      <h2 className="h2" style={{ marginTop: 22, fontSize: 19 }}>
        Избранное
      </h2>
      <div style={{ marginTop: 12 }}>
        <Segmented
          compact
          label="Раздел избранного"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'tracks', label: 'Треки' },
            { value: 'albums', label: 'Альбомы' },
            { value: 'playlists', label: 'Плейлисты' },
            { value: 'hear', label: 'Слух' },
          ]}
        />
      </div>

      <div style={{ marginTop: 14 }}>
        {tab === 'tracks' ? (
          tracks.loading && !tracks.data ? (
            <SkeletonRows />
          ) : tracks.error ? (
            <ErrorState error={tracks.error} onRetry={tracks.reload} />
          ) : tracks.data?.tracks.length ? (
            <TrackList tracks={tracks.data.tracks} context="Избранное" trailing="heart" />
          ) : (
            <Empty title="Здесь будут любимые треки" action={<button type="button" className="btn primary" onClick={() => go.push({ name: 'search' })}>Найти музыку</button>}>
              Нажмите ♥ в плеере или в поиске.
            </Empty>
          )
        ) : null}
        {tab === 'albums' ? (
          albums.loading ? (
            <SkeletonRows />
          ) : albums.error ? (
            <ErrorState error={albums.error} onRetry={albums.reload} />
          ) : albums.data?.albums.length ? (
            <ul className="list">
              {albums.data.albums.map((a) => (
                <li key={a.id} className="row">
                  <button type="button" className="row-main" onClick={() => go.push({ name: 'album', id: a.id })}>
                    <Cover src={a.coverUrl} />
                    <span className="row-text">
                      <span className="row-title" style={{ display: 'block' }}>{a.title}</span>
                      <span className="row-sub" style={{ display: 'block' }}>{a.artist.name}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="Нет сохранённых альбомов">Откройте альбом и нажмите «Сохранить».</Empty>
          )
        ) : null}
        {tab === 'playlists' ? (
          lists.loading ? (
            <SkeletonRows />
          ) : lists.error ? (
            <ErrorState error={lists.error} onRetry={lists.reload} />
          ) : lists.data?.playlists.length ? (
            <ul className="list">
              {lists.data.playlists.map((pl) => (
                <li key={pl.id} className="row">
                  <button type="button" className="row-main" onClick={() => go.push({ name: 'playlist', id: pl.id, title: pl.title })}>
                    <Cover src={pl.coverUrl} />
                    <span className="row-text">
                      <span className="row-title" style={{ display: 'block' }}>{pl.title}</span>
                      <span className="row-sub" style={{ display: 'block' }}>
                        {pl.trackCount} {plural(pl.trackCount, ['трек', 'трека', 'треков'])}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="Плейлистов пока нет">В меню «…» у любого трека выберите «Добавить в плейлист».</Empty>
          )
        ) : null}
        {tab === 'hear' ? (
          hear.loading ? (
            <SkeletonRows />
          ) : hear.error ? (
            <ErrorState error={hear.error} onRetry={hear.reload} />
          ) : hear.data?.items.length ? (
            <ul className="list">
              {hear.data.items.map((r) => (
                <li key={r.id} className="row">
                  <button
                    type="button"
                    className="row-main"
                    onClick={() => (r.track && r.track.playback.kind !== 'none' ? player.playList([r.track], 0, { label: 'Слух', kind: 'list' }) : go.tab('hear'))}
                  >
                    <Cover src={r.coverUrl ?? r.track?.coverUrl} />
                    <span className="row-text">
                      <span className="row-title" style={{ display: 'block' }}>{r.title}</span>
                      <span className="row-sub" style={{ display: 'block' }}>
                        {r.artist}
                        {r.track ? '' : ' · нет в каталоге'}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="Ничего не найдено через Слух">Распознанные песни сохраняются здесь.</Empty>
          )
        ) : null}
      </div>
    </main>
  );
}
