import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { plural, type Track } from '@auris/shared';
import { Cover } from '../components/Cover';
import { IconHeart, IconMore, IconPlay, IconPlus } from '../components/Icons';
import { Empty, ErrorState, SkeletonRows } from '../components/States';
import { TrackList } from '../components/TrackRow';
import { api } from '../lib/api';
import { player } from '../lib/player';
import { go } from '../lib/router';
import { refreshProfile, session } from '../lib/session';
import { useQuery, useStore } from '../lib/store';
import { tg } from '../lib/telegram';
import { openSheet, toast } from '../lib/ui';
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

function Initials({ name }: { name: string }) {
  return (
    <span className="member" title={name} aria-hidden="true">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Shared playlist: everyone in it can add tracks and invite; the owner can delete it. */
export function PlaylistScreen({ id, title }: { id: string; title: string }) {
  const q = useQuery(`pl:${id}`, () => api.playlist(id));
  const me = useStore(session, (s) => s.profile?.id);
  const p = q.data;
  const invite = async () => {
    try {
      const { link } = await api.invite(id);
      const res = await tg.share(link, `Присоединяйся к моему плейлисту «${p?.title ?? title}» в AURIS`);
      if (res === 'copied') toast('Ссылка-приглашение скопирована');
      if (res === 'failed') toast(link);
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const remove = (t: Track) => {
    if (!p || !(p.role === 'owner' || p.addedBy[t.id] === me)) return undefined;
    return async () => {
      tg.haptic.tap();
      await api.removeFromPlaylist(id, t.id).catch((e: Error) => toast(e.message));
      q.reload();
    };
  };
  const del = () =>
    openSheet({
      kind: 'info',
      title: p?.role === 'owner' ? 'Удалить плейлист?' : 'Выйти из плейлиста?',
      body: p?.role === 'owner' ? 'Плейлист исчезнет у всех участников.' : 'Плейлист останется у остальных, вы сможете вернуться по ссылке.',
      action: {
        label: p?.role === 'owner' ? 'Удалить' : 'Выйти',
        run: async () => {
          await api.deletePlaylist(id);
          tg.haptic.success();
          toast(p?.role === 'owner' ? 'Плейлист удалён' : 'Вы вышли из плейлиста');
          void refreshProfile();
          go.back();
        },
      },
    });
  const others = (p?.members.length ?? 1) - 1;
  return (
    <main className="screen overlay" aria-label="Плейлист">
      <Header
        title={p?.title ?? title}
        sub={p ? (others > 0 ? `Совместный · ${p.members.length} ${plural(p.members.length, ['участник', 'участника', 'участников'])}` : 'Ваш плейлист') : 'Плейлист'}
        cover={p?.tracks[0]?.coverUrl}
        tracks={p?.tracks ?? []}
        context={p?.title ?? title}
      />
      {p ? (
        <>
          <div className="btn-row" style={{ justifyContent: 'flex-start', marginTop: 8 }}>
            <button type="button" className="btn ghost" onClick={() => void invite()}>
              <IconPlus style={{ width: 18, height: 18 }} /> Пригласить друзей
            </button>
            <button type="button" className="icon-btn glass" aria-label={p.role === 'owner' ? 'Ещё: удалить плейлист' : 'Ещё: выйти из плейлиста'} onClick={del}>
              <IconMore />
            </button>
          </div>
          <div className="members" aria-label="Участники">
            {p.members.map((m) => (
              <span key={m.id} className="member-chip">
                <Initials name={m.name} />
                {m.id === me ? 'Вы' : m.name}
                {m.role === 'owner' ? <small> · владелец</small> : null}
              </span>
            ))}
          </div>
        </>
      ) : null}
      <div style={{ marginTop: 16 }}>
        {q.loading && !p ? <SkeletonRows n={5} /> : null}
        {q.error ? <ErrorState error={q.error} onRetry={q.reload} /> : null}
        {p && !p.tracks.length ? (
          <Empty title="Пока пусто">Добавляйте треки через «…» → «Добавить в плейлист». Пригласите друзей — они тоже смогут добавлять.</Empty>
        ) : null}
        {p?.tracks.length ? (
          <TrackList
            tracks={p.tracks}
            context={p.title}
            sub={(t) => {
              const by = p.addedBy[t.id];
              const who = by && by !== me ? p.members.find((m) => m.id === by)?.name : undefined;
              return who ? `${t.artist.name} · добавил(а) ${who}` : undefined;
            }}
            onRemove={remove}
          />
        ) : null}
      </div>
    </main>
  );
}

/** Curated collection (mood / genre). */
export function CollectionScreen({ id, title }: { id: string; title: string }) {
  const q = useQuery(`col:${id}`, () => api.collection(id));
  // Endless list: further pages are appended as the user scrolls to the bottom.
  const [more, setMore] = useState<Track[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [busy, setBusy] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const tracks = useMemo(() => {
    const seen = new Set<string>();
    return [...(q.data?.tracks ?? []), ...more].filter((t) => !seen.has(t.id) && Boolean(seen.add(t.id)));
  }, [q.data, more]);
  const canMore = Boolean(q.data) && (q.data?.hasMore ?? false) && hasMore;
  const loadMore = useCallback(async () => {
    if (busy || !canMore) return;
    setBusy(true);
    try {
      const r = await api.collection(id, page + 1);
      setPage(r.page);
      setMore((m) => [...m, ...r.tracks]);
      setHasMore(r.hasMore);
    } catch {
      setHasMore(false);
    } finally {
      setBusy(false);
    }
  }, [busy, canMore, id, page]);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !canMore) return;
    const io = new IntersectionObserver((e) => e[0]?.isIntersecting && void loadMore(), { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore, canMore]);
  const ctx = q.data?.title ?? title;
  return (
    <main className="screen overlay" aria-label="Подборка">
      <Header title={ctx} sub={q.data ? `${q.data.subtitle} · ${tracks.length}${canMore ? '+' : ''} ${plural(tracks.length, ['трек', 'трека', 'треков'])}` : 'Подборка AURIS'} cover={tracks[0]?.coverUrl} tracks={tracks} context={ctx} />
      <div style={{ marginTop: 16 }}>
        <Body loading={q.loading} error={q.error} reload={q.reload} tracks={q.data ? tracks : undefined} context={ctx} />
        {canMore ? (
          <div ref={sentinel} style={{ marginTop: 8 }}>
            {busy ? <SkeletonRows n={3} /> : <button type="button" className="btn ghost" style={{ width: '100%' }} onClick={() => void loadMore()}>Показать ещё</button>}
          </div>
        ) : null}
      </div>
    </main>
  );
}
