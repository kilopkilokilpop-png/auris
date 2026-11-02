import { useEffect, useRef, useState } from 'react';
import { Cover } from '../components/Cover';
import { IconBack, IconClose, IconSearch } from '../components/Icons';
import { Empty, ErrorState, SkeletonRows } from '../components/States';
import { TrackList } from '../components/TrackRow';
import { api } from '../lib/api';
import { go } from '../lib/router';
import { useQuery } from '../lib/store';
import { tg } from '../lib/telegram';

export function BackButtonInline() {
  // Telegram shows its own BackButton in the header; the in-app one is for the browser.
  if (tg.mode === 'telegram') return null;
  return (
    <button type="button" className="icon-btn glass" aria-label="Назад" onClick={() => go.back()}>
      <IconBack />
    </button>
  );
}

export function Search() {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 350);
    return () => clearTimeout(t);
  }, [text]);
  const res = useQuery(q ? `s:${q}` : null, () => api.search(q));
  const recent = useQuery(q ? null : 'recent', () => api.recentSearches());
  const charts = useQuery('charts', () => api.charts());
  const empty = res.data && !res.data.tracks.length && !res.data.albums.length && !res.data.artists.length;

  return (
    <main className="screen overlay" aria-label="Поиск">
      <div className="back-row">
        <BackButtonInline />
        <h1 className="h-display">Поиск</h1>
      </div>
      <form
        role="search"
        className="search-box glass"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(text.trim());
          input.current?.blur();
        }}
      >
        <IconSearch />
        <label htmlFor="q" className="sr-only">
          Треки, артисты, альбомы
        </label>
        <input
          id="q"
          ref={input}
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          placeholder="Треки, артисты, альбомы"
          value={text}
          maxLength={120}
          onChange={(e) => setText(e.target.value)}
        />
        {text ? (
          <button type="button" className="icon-btn" aria-label="Очистить" onClick={() => (setText(''), input.current?.focus())}>
            <IconClose />
          </button>
        ) : null}
      </form>

      {!q ? (
        <>
          {recent.data?.queries.length ? (
            <section className="section" style={{ marginTop: 24 }} aria-labelledby="rq">
              <div className="section-head">
                <h2 className="h2" id="rq">
                  Недавние запросы
                </h2>
                <button type="button" className="text-btn" onClick={() => void api.clearRecentSearches().then(recent.reload)}>
                  Очистить
                </button>
              </div>
              <div className="chips">
                {recent.data.queries.map((x) => (
                  <button key={x} type="button" className="chip" onClick={() => (setText(x), setQ(x))}>
                    {x}
                  </button>
                ))}
              </div>
            </section>
          ) : null}
          <section className="section" aria-labelledby="ch">
            <div className="section-head">
              <h2 className="h2" id="ch">
                Популярное сейчас
              </h2>
            </div>
            {charts.loading ? <SkeletonRows n={5} /> : null}
            {charts.error ? <ErrorState error={charts.error} onRetry={charts.reload} /> : null}
            {charts.data ? <TrackList tracks={charts.data.tracks.slice(0, 12)} context="Чарт" /> : null}
          </section>
        </>
      ) : (
        <>
          {res.loading ? (
            <div style={{ marginTop: 20 }}>
              <SkeletonRows n={6} />
            </div>
          ) : null}
          {res.error ? (
            <div style={{ marginTop: 20 }}>
              <ErrorState error={res.error} onRetry={res.reload} />
            </div>
          ) : null}
          {empty ? (
            <div style={{ marginTop: 20 }}>
              <Empty title="Ничего не нашлось">Проверьте написание или попробуйте имя артиста.</Empty>
            </div>
          ) : null}
          {res.data?.artists.length ? (
            <section className="section" style={{ marginTop: 24 }} aria-label="Артисты">
              <h2 className="h2" style={{ marginBottom: 12 }}>
                Артисты
              </h2>
              <div className="hscroll">
                {res.data.artists.map((a) => (
                  <button key={a.id} type="button" className="tile" onClick={() => go.push({ name: 'artist', id: a.id })}>
                    <Cover src={a.pictureUrl} className="round" />
                    <span className="row-title" style={{ display: 'block', textAlign: 'center' }}>
                      {a.name}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}
          {res.data?.tracks.length ? (
            <section className="section" style={{ marginTop: 24 }} aria-label="Треки">
              <h2 className="h2" style={{ marginBottom: 4 }}>
                Треки
              </h2>
              <TrackList tracks={res.data.tracks} context={`Поиск: ${q}`} />
            </section>
          ) : null}
          {res.data?.albums.length ? (
            <section className="section" aria-label="Альбомы">
              <h2 className="h2" style={{ marginBottom: 12 }}>
                Альбомы
              </h2>
              <div className="hscroll">
                {res.data.albums.map((a) => (
                  <button key={a.id} type="button" className="tile" onClick={() => go.push({ name: 'album', id: a.id })}>
                    <Cover src={a.coverUrl} />
                    <span className="row-title" style={{ display: 'block' }}>
                      {a.title}
                    </span>
                    <span className="row-sub" style={{ display: 'block' }}>
                      {a.artist.name}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </main>
  );
}
