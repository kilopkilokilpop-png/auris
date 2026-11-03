import { dayPart, GREETINGS, QUALITY_LABELS, type Album, type QualityTier } from '@auris/shared';
import { bitDepthLabel } from '@auris/shared';
import { IconPlay, IconSearch, LogoMark } from '../components/Icons';
import { Segmented } from '../components/Segmented';
import { Empty, ErrorState, SkeletonRows } from '../components/States';
import { TrackList } from '../components/TrackRow';
import { api } from '../lib/api';
import { player } from '../lib/player';
import { go } from '../lib/router';
import { session, setQuality } from '../lib/session';
import { useQuery, useStore } from '../lib/store';
import { toast } from '../lib/ui';

/** Badge for the editorial card from real data of the album's tracks. */
function albumBadge(a: Album): string | null {
  const tracks = a.tracks ?? [];
  if (!tracks.length) return null;
  if (tracks.every((t) => t.playback.kind === 'preview')) return 'ПРЕВЬЮ · 30 С';
  const qs = tracks.flatMap((t) => t.playback.qualities);
  const hires = qs.find((q) => q.tier === 'hires' && q.bitDepth);
  if (hires) return `HI-RES · ${hires.bitDepth} БИТ`;
  const flac = qs.find((q) => q.codec === 'flac');
  if (flac) return flac.bitDepth ? `FLAC · ${bitDepthLabel(flac) ?? ''}`.trim() : 'FLAC';
  return null;
}

/** Monochrome tiles: same palette, different light angle per tile. */
function tileBg(i: number) {
  const light = [0x6a, 0x58, 0x7a, 0x4e, 0x64][i % 5]!.toString(16);
  const angle = [150, 200, 120, 240, 170][i % 5];
  return `radial-gradient(120% 80% at 20% 0%, rgb(255 255 255 / 0.18), transparent 60%), linear-gradient(${angle}deg, #${light}${light}${light} 0%, #232326 55%, #121214 100%)`;
}

function Collections() {
  const q = useQuery('collections', () => api.collections());
  if (q.error || (q.data && !q.data.collections.length)) return null;
  return (
    <section className="section" aria-labelledby="col-h">
      <div className="section-head">
        <h2 className="h2" id="col-h">
          Подборки
        </h2>
      </div>
      <div className="hscroll" style={{ paddingTop: 4, paddingBottom: 4 }}>
        {q.loading && !q.data
          ? Array.from({ length: 3 }, (_, i) => <span key={i} className="collection-tile skeleton" aria-hidden="true" />)
          : q.data?.collections.map((c, i) => (
              <button key={c.id} type="button" className="collection-tile" style={{ ['--tile-bg' as string]: tileBg(i) }} onClick={() => go.push({ name: 'collection', id: c.id, title: c.title })}>
                <strong>{c.title}</strong>
                <span>{c.subtitle}</span>
              </button>
            ))}
      </div>
    </section>
  );
}

export function Home() {
  const profile = useStore(session, (s) => s.profile);
  const caps = useStore(session, (s) => s.capabilities);
  const q = useQuery('home', () => api.home());
  const tier: QualityTier = profile?.settings.quality ?? 'standard';
  const tierCap = caps?.qualities.find((x) => x.tier === tier);
  const initial = (profile?.firstName || 'A').slice(0, 1).toUpperCase();
  const editorial = q.data?.editorial;
  const badge = editorial ? albumBadge(editorial) : null;

  return (
    <main className="screen" aria-label="Главная">
      <header className="topbar">
        <div className="brand" aria-label="AURIS">
          <LogoMark size={22} />
          <span className="brand-word" aria-hidden="true">
            AURIS
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="icon-btn glass" aria-label="Поиск" onClick={() => go.push({ name: 'search' })}>
            <IconSearch />
          </button>
          <button type="button" className="avatar-btn glass" aria-label="Профиль" onClick={() => go.tab('profile')}>
            {profile?.photoUrl ? <img src={profile.photoUrl} alt="" /> : initial}
          </button>
        </div>
      </header>

      <h1 className="h-display" style={{ marginTop: 20 }}>
        {GREETINGS[dayPart(new Date().getHours())]}
      </h1>
      <p className="sub" style={{ marginTop: 6 }}>
        Качество:{' '}
        <b style={{ color: 'var(--text)', fontWeight: 800 }}>
          {QUALITY_LABELS[tier]}
          {tierCap?.summary ? `, ${tierCap.summary}` : ''}
        </b>
      </p>

      <div style={{ marginTop: 22 }}>
        <Segmented
          label="Качество звука"
          value={tier}
          onChange={(v) => void setQuality(v)}
          onDisabled={(o) => toast(o.disabledReason ?? 'Недоступно')}
          options={(['standard', 'hifi', 'hires'] as const).map((t) => {
            const c = caps?.qualities.find((x) => x.tier === t);
            return { value: t, label: QUALITY_LABELS[t], disabled: c ? !c.available : false, disabledReason: c?.reason };
          })}
        />
      </div>

      {q.loading && !q.data ? (
        <div className="editorial glass" aria-busy="true">
          <div className="editorial-art skeleton" />
          <div className="editorial-foot">
            <span style={{ flex: 1 }}>
              <span className="skeleton" style={{ display: 'block', height: 12, width: '40%' }} />
              <span className="skeleton" style={{ display: 'block', height: 18, width: '70%', marginTop: 10 }} />
            </span>
          </div>
        </div>
      ) : q.error ? (
        <div style={{ marginTop: 24 }}>
          <ErrorState error={q.error} onRetry={q.reload} />
        </div>
      ) : editorial ? (
        <article className="editorial glass" aria-label={`Выбор редакции: ${editorial.title}`}>
          <button type="button" style={{ display: 'block', width: '100%' }} onClick={() => go.push({ name: 'album', id: editorial.id })} aria-label={`Открыть альбом ${editorial.title}`}>
            <div className="editorial-art">
              <div className="editorial-disc">{editorial.coverUrl ? <img src={editorial.coverUrl} alt="" onLoad={(e) => e.currentTarget.classList.add('loaded')} /> : null}</div>
              {badge ? <span className="editorial-badge">{badge}</span> : null}
            </div>
          </button>
          <div className="editorial-foot">
            <div style={{ flex: 1, minWidth: 0 }}>
              <p className="label">Выбор редакции</p>
              <h2 className="editorial-title">{editorial.title}</h2>
              <p className="muted" style={{ margin: 0, fontSize: 14 }}>
                {editorial.artist.name}
              </p>
            </div>
            <button
              type="button"
              className="play-fab"
              aria-label={`Слушать ${editorial.title}`}
              disabled={!editorial.tracks?.length}
              onClick={() => editorial.tracks && player.playList(editorial.tracks, 0, { label: 'Выбор редакции', kind: 'list' })}
            >
              <IconPlay />
            </button>
          </div>
        </article>
      ) : null}

      <section className="section" style={{ marginTop: 26 }} aria-labelledby="recent-h">
        <div className="section-head">
          <h2 className="h2" id="recent-h">
            Недавно
          </h2>
        </div>
        {q.loading && !q.data ? <SkeletonRows n={2} /> : null}
        {q.data && q.data.recent.length === 0 ? (
          <Empty
            title="Пока тихо"
            action={
              <button type="button" className="btn primary" onClick={() => go.push({ name: 'search' })}>
                Найти музыку
              </button>
            }
          >
            Здесь появятся треки, которые вы слушали.
          </Empty>
        ) : null}
        {q.data?.recent.length ? <TrackList tracks={q.data.recent.slice(0, 6)} context="Недавно" trailing="badge" /> : null}
      </section>
      <Collections />
      {caps?.providers.some((p) => p.previewsOnly) ? (
        <p className="notice">{caps.providers.find((p) => p.previewsOnly)?.notice}</p>
      ) : null}
      {caps?.providers.some((p) => p.id === 'mock') ? <p className="notice">{caps.providers.find((p) => p.id === 'mock')?.notice}</p> : null}
    </main>
  );
}
