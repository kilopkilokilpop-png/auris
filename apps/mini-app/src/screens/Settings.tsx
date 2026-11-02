import { useState } from 'react';
import { QUALITY_LABELS } from '@auris/shared';
import { Segmented } from '../components/Segmented';
import { api } from '../lib/api';
import { player } from '../lib/player';
import { go } from '../lib/router';
import { refreshProfile, session, setQuality } from '../lib/session';
import { useStore } from '../lib/store';
import { tg } from '../lib/telegram';
import { openSheet, toast } from '../lib/ui';
import { BackButtonInline } from './Search';

export function Settings() {
  const p = useStore(session, (s) => s.profile);
  const caps = useStore(session, (s) => s.capabilities);
  const [busy, setBusy] = useState(false);

  const reset = () =>
    openSheet({
      kind: 'info',
      title: 'Сбросить рекомендации?',
      body: 'История прослушиваний, пропуски, дизлайки и выбор жанров будут удалены. Избранное и плейлисты останутся.',
      action: {
        label: 'Сбросить',
        run: async () => {
          await api.resetRecommendations();
          tg.haptic.success();
          await refreshProfile();
          toast('Рекомендации сброшены');
        },
      },
    });
  const erase = () =>
    openSheet({
      kind: 'info',
      title: 'Удалить все данные?',
      body: 'Удалим профиль, избранное, плейлисты, историю, найденные через Слух треки и историю скачиваний. Это нельзя отменить.',
      action: {
        label: 'Удалить навсегда',
        run: async () => {
          setBusy(true);
          try {
            await api.deleteMe();
            player.stop();
            tg.haptic.success();
            session.set({ liked: new Set() });
            toast('Данные удалены');
            go.back();
            await refreshProfile();
          } finally {
            setBusy(false);
          }
        },
      },
    });

  return (
    <main className="screen overlay" aria-label="Настройки">
      <div className="back-row">
        <BackButtonInline />
        <h1 className="h-display">Настройки</h1>
      </div>

      <h2 className="label" style={{ marginTop: 8 }}>
        Качество звука
      </h2>
      <div style={{ marginTop: 12 }}>
        <Segmented
          label="Качество звука"
          value={p?.settings.quality ?? 'standard'}
          onChange={(v) => void setQuality(v)}
          onDisabled={(o) => toast(o.disabledReason ?? 'Недоступно')}
          options={(['standard', 'hifi', 'hires'] as const).map((t) => {
            const c = caps?.qualities.find((x) => x.tier === t);
            return { value: t, label: QUALITY_LABELS[t], disabled: c ? !c.available : false, disabledReason: c?.reason };
          })}
        />
      </div>
      <p className="note" style={{ marginTop: 10 }}>
        Бейджи FLAC и Hi-Res показываются только если источник отдаёт такой файл. Для превью качество не указывается.
      </p>

      <h2 className="label" style={{ marginTop: 28 }}>
        Источники музыки
      </h2>
      <div className="group glass" style={{ marginTop: 12 }}>
        {caps?.providers.map((pr) => (
          <div className="group-item" key={pr.id}>
            <div className="grow">
              <b>{pr.name}</b>
              <small>{pr.notice}</small>
            </div>
          </div>
        ))}
      </div>

      <h2 className="label" style={{ marginTop: 28 }}>
        Фоновое воспроизведение
      </h2>
      <p className="note" style={{ marginTop: 10 }}>
        Mini App работает внутри Telegram. Когда вы сворачиваете Telegram или блокируете экран, система может приостановить звук — это зависит от устройства и версии Telegram. Для музыки офлайн скачайте разрешённые треки в Telegram.
      </p>

      <h2 className="label" style={{ marginTop: 28 }}>
        Данные
      </h2>
      <div className="group glass" style={{ marginTop: 12 }}>
        <button type="button" className="group-item" onClick={reset}>
          <span className="grow">
            <b>Сбросить рекомендации</b>
            <small>Резонанс начнёт с чистого листа</small>
          </span>
        </button>
        <button type="button" className="group-item" onClick={erase} disabled={busy}>
          <span className="grow">
            <b>Удалить все мои данные</b>
            <small>Полное удаление профиля из AURIS</small>
          </span>
        </button>
      </div>
      <p className="note" style={{ marginTop: 16 }}>
        AURIS хранит ваш Telegram ID, лайки, прослушивания, плейлисты и найденные песни, чтобы улучшать рекомендации. Записи для Слуха удаляются сразу после распознавания. О скачиваниях хранится только факт: трек, время и источник.
      </p>
      <p className="note center" style={{ marginTop: 24 }}>
        AURIS · Слышать каждую ноту
      </p>
    </main>
  );
}
