import { useEffect, useState } from 'react';
import { LogoMark } from '../components/Icons';
import { ErrorState, SkeletonRows } from '../components/States';
import { acceptTerms } from '../lib/session';
import { BackButtonInline } from './Search';

export const YOUTUBE_TERMS = 'https://www.youtube.com/t/terms';
export const GOOGLE_PRIVACY = 'https://policies.google.com/privacy';

/** Renders /terms.html or /privacy.html (static files we ship — the same pages the bot links to). */
function LegalText({ page }: { page: 'terms' | 'privacy' }) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    setError(null);
    fetch(`/${page}.html`)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error('Документ недоступен'))))
      .then((t) => {
        const main = new DOMParser().parseFromString(t, 'text/html').getElementById('legal');
        if (alive) setHtml(main?.innerHTML ?? '');
      })
      .catch((e: Error) => alive && setError(e));
    return () => {
      alive = false;
    };
  }, [page, n]);
  if (error) return <ErrorState error={error} onRetry={() => setN((x) => x + 1)} />;
  if (html === null) return <SkeletonRows n={6} />;
  // Our own static file from the same origin.
  return <article className="legal" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function Legal({ page }: { page: 'terms' | 'privacy' }) {
  return (
    <main className="screen overlay" aria-label={page === 'terms' ? 'Условия использования' : 'Политика конфиденциальности'}>
      <div className="back-row">
        <BackButtonInline />
      </div>
      <LegalText page={page} />
    </main>
  );
}

/** Shown before anything else until the current terms are accepted (YouTube Developer Policies III.A). */
export function Consent({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState<'terms' | 'privacy' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (open) {
    return (
      <main className="screen consent" aria-label={open === 'terms' ? 'Условия использования' : 'Политика конфиденциальности'}>
        <div className="back-row">
          <button type="button" className="btn ghost" onClick={() => setOpen(null)}>
            ← Назад
          </button>
        </div>
        <LegalText page={open} />
      </main>
    );
  }
  return (
    <main className="screen consent" aria-label="Условия использования">
      <div className="consent-hero">
        <LogoMark size={56} />
        <p className="brand-word">AURIS</p>
        <p className="muted">Слышать каждую ноту</p>
      </div>
      <h1 className="h2" style={{ fontSize: 24 }}>
        Перед началом
      </h1>
      <p className="muted">AURIS ищет музыку на YouTube и Jamendo, подбирает «Резонанс» по вашим действиям и узнаёт песни вокруг.</p>
      <ul className="consent-list">
        <li>
          Видео YouTube играют только в официальном плеере YouTube, пока он на экране. Пользуясь AURIS, вы соглашаетесь с{' '}
          <a href={YOUTUBE_TERMS} target="_blank" rel="noopener">
            Условиями использования YouTube
          </a>
          .
        </li>
        <li>
          AURIS использует YouTube API Services. Данные YouTube обрабатываются по{' '}
          <a href={GOOGLE_PRIVACY} target="_blank" rel="noopener">
            Политике конфиденциальности Google
          </a>
          .
        </li>
        <li>Мы храним только ваши действия в AURIS. Всё можно удалить в настройках в любой момент.</li>
      </ul>
      <div className="consent-links">
        <button type="button" className="text-btn" onClick={() => setOpen('terms')}>
          Условия использования AURIS
        </button>
        <button type="button" className="text-btn" onClick={() => setOpen('privacy')}>
          Политика конфиденциальности AURIS
        </button>
      </div>
      {error ? (
        <p className="notice" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        className="btn primary block"
        aria-busy={busy || undefined}
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          acceptTerms()
            .then(onDone)
            .catch((e: Error) => setError(e.message))
            .finally(() => setBusy(false));
        }}
      >
        Принимаю и продолжаю
      </button>
      <p className="note center">Нажимая кнопку, вы принимаете Условия использования и Политику конфиденциальности AURIS, а также Условия использования YouTube.</p>
    </main>
  );
}
