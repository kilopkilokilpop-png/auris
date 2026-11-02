import { useState } from 'react';
import { Cover } from '../components/Cover';
import { ErrorState, SkeletonRows } from '../components/States';
import { api } from '../lib/api';
import { player } from '../lib/player';
import { go } from '../lib/router';
import { session } from '../lib/session';
import { useQuery } from '../lib/store';
import { tg } from '../lib/telegram';
import { toast } from '../lib/ui';
import { BackButtonInline } from './Search';

/** First run of Резонанс: a few genres + exactly 3 artists, then start from charts + this choice. */
export function Onboarding() {
  const q = useQuery('onboarding', () => api.onboarding());
  const [step, setStep] = useState<'genres' | 'artists'>('genres');
  const [genres, setGenres] = useState<string[]>([]);
  const [artists, setArtists] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const toggle = (list: string[], v: string, set: (x: string[]) => void, max: number) => {
    tg.haptic.select();
    if (list.includes(v)) set(list.filter((x) => x !== v));
    else if (list.length < max) set([...list, v]);
    else toast(max === 3 ? 'Выберите ровно трёх артистов' : `Не больше ${max}`);
  };
  const finish = async () => {
    player.prime();
    setBusy(true);
    try {
      const profile = await api.submitOnboarding(genres, artists);
      session.set({ profile });
      go.back();
      go.tab('wave');
      await player.startWave(profile.settings.waveMood, profile.settings.waveMode);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="screen overlay" aria-label="Настройка Резонанса">
      <div className="back-row">
        <BackButtonInline />
        <p className="label">Шаг {step === 'genres' ? 1 : 2} из 2</p>
      </div>
      <h1 className="h-display">{step === 'genres' ? 'Что вы любите слушать?' : 'Три любимых артиста'}</h1>
      <p className="sub">{step === 'genres' ? 'Выберите один или несколько жанров. Это стартовая точка — дальше Резонанс учится на ваших лайках и пропусках.' : 'Выберите ровно трёх — с них начнётся ваша волна.'}</p>
      {q.loading ? <SkeletonRows n={4} /> : null}
      {q.error ? <ErrorState error={q.error} onRetry={q.reload} /> : null}
      {q.data && step === 'genres' ? (
        <div className="chips" style={{ marginTop: 20 }}>
          {q.data.genres.map((g) => (
            <button key={g.id} type="button" className="chip" aria-pressed={genres.includes(g.id)} onClick={() => toggle(genres, g.id, setGenres, 8)}>
              {g.name}
            </button>
          ))}
        </div>
      ) : null}
      {q.data && step === 'artists' ? (
        <ul className="list" style={{ marginTop: 12 }}>
          {q.data.artists.map((a) => (
            <li key={a.id}>
              <button type="button" className="row-main" aria-pressed={artists.includes(a.id)} onClick={() => toggle(artists, a.id, setArtists, 3)} style={{ width: '100%' }}>
                <Cover src={a.pictureUrl} className="round" />
                <span className="row-text row-title">{a.name}</span>
                <span className={`chip`} aria-hidden="true" aria-pressed={artists.includes(a.id)} style={{ minHeight: 30 }}>
                  {artists.includes(a.id) ? 'Выбран' : 'Выбрать'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div style={{ position: 'sticky', bottom: 0, paddingTop: 16 }}>
        {step === 'genres' ? (
          <button type="button" className="btn primary block" disabled={!genres.length} onClick={() => setStep('artists')}>
            Дальше
          </button>
        ) : (
          <button type="button" className="btn primary block" disabled={artists.length !== 3 || busy} onClick={() => void finish()}>
            {busy ? 'Запускаем…' : `Запустить Резонанс (${artists.length}/3)`}
          </button>
        )}
      </div>
    </main>
  );
}
