import type { Track } from '@auris/shared';
import { Cover } from '../components/Cover';
import { IconHeart, IconPlay } from '../components/Icons';
import { Empty, ErrorState, SkeletonRows } from '../components/States';
import { TrackList } from '../components/TrackRow';
import { api } from '../lib/api';
import { player } from '../lib/player';
import { useQuery } from '../lib/store';
import { tg } from '../lib/telegram';
import { toast } from '../lib/ui';
import { BackButtonInline } from './Search';

function Header({ title, sub, cover, round, tracks, context, onSave }: { title: string; sub?: string; cover?: string; round?: boolean; tracks: Track[]; context: string; onSave?: () => void }) {
  const playable = tracks.filter((t) => t.playback.kind !== 'none');
  return (
    <>
      <div className="back-row">
        <BackButtonInline />
      </div>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <Cover src={cover} className={round ? 'round' : ''} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1 className="h2" style={{ fontSize: 22, fontWeight: 800 }}>
            {title}
          </h1>
          {sub ? <p className="sub" style={{ marginTop: 2 }}>{sub}</p> : null}
        </div>
      </div>
      <div className="btn-row" style={{ justifyContent: 'flex-start' }}>
        <button type="button" className="btn primary" disabled={!playable.length} onClick={() => player.playList(playable, 0, { label: context, kind: 'list' })}>
          <IconPlay style={{ width: 18, height: 18 }} /> Слушать
        </button>
        {onSave ? (
          <button type="button" className="btn ghost" onClick={onSave}>
            <IconHeart style={{ width: 18, height: 18 }} /> Сохранить
          </button>
        ) : null}
      </div>
    </>
  );
}

function Body({ loading, error, reload, tracks, context }: { loading: boolean; error?: Error; reload: () => void; tracks?: Track[]; context: string }) {
  if (loading && !tracks) return <SkeletonRows n={6} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!tracks?.length) return <Empty title="Треков нет">Источник не вернул ни одного трека.</Empty>;
  return <TrackList tracks={tracks} context={context} />;
}

export function AlbumScreen({ id }: { id: string }) {
  const q = useQuery(`album:${id}`, () => api.album(id));
  const save = async () => {
    await api.likeAlbum(id);
    tg.haptic.success();
    toast('Альбом сохранён в профиле');
  };
  return (
    <main className="screen overlay" aria-label="Альбом">
      {q.data ? <Header title={q.data.title} sub={q.data.artist.name} cover={q.data.coverUrl} tracks={q.data.tracks ?? []} context={q.data.title} onSave={() => void save()} /> : <div className="back-row"><BackButtonInline /></div>}
      <div style={{ marginTop: 16 }}>
        <Body loading={q.loading} error={q.error} reload={q.reload} tracks={q.data?.tracks} context={q.data?.title ?? 'Альбом'} />
      </div>
    </main>
  );
}

export function ArtistScreen({ id }: { id: string }) {
  const q = useQuery(`artist:${id}`, () => api.artist(id));
  return (
    <main className="screen overlay" aria-label="Артист">
      {q.data ? <Header title={q.data.artist.name} sub="Популярные треки" cover={q.data.artist.pictureUrl} round tracks={q.data.tracks} context={q.data.artist.name} /> : <div className="back-row"><BackButtonInline /></div>}
      <div style={{ marginTop: 16 }}>
        <Body loading={q.loading} error={q.error} reload={q.reload} tracks={q.data?.tracks} context={q.data?.artist.name ?? 'Артист'} />
      </div>
    </main>
  );
}

export function PlaylistScreen({ id, title }: { id: string; title: string }) {
  const q = useQuery(`pl:${id}`, () => api.playlist(id));
  return (
    <main className="screen overlay" aria-label="Плейлист">
      <Header title={q.data?.title ?? title} sub="Плейлист" cover={q.data?.tracks[0]?.coverUrl} tracks={q.data?.tracks ?? []} context={q.data?.title ?? title} />
      <div style={{ marginTop: 16 }}>
        <Body loading={q.loading} error={q.error} reload={q.reload} tracks={q.data?.tracks} context={title} />
      </div>
    </main>
  );
}
