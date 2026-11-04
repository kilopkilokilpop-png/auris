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
import { GOOGLE_PRIVACY, YOUTUBE_TERMS } from './Legal';
import { BackButtonInline } from './Search';

export function Settings() {
  const p = useStore(session, (s) => s.profile);
  const caps = useStore(session, (s) => s.capabilities);
  const [busy, setBusy] = useState(false);
  // The switcher appears only when the connected sources really offer more than one quality.
  const qualityChoice = (caps?.qualities.filter((q) => q.available).length ?? 0) > 1;

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
      body: 'Удалим сразу: профиль, избранное, плейлисты, историю прослушиваний, настройки Резонанса и найденные через Слух песни. Это нельзя отменить. Ваш аккаунт и данные на YouTube это не затрагивает.',
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
            // Start over: the consent screen is shown again.
            setTimeout(() => location.reload(), 900);
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

      {qualityChoice ? (
        <>
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
        Бейджи FLAC и Hi-Res показываются только если источник отдаёт такой файл. Для YouTube качество не указывается.
      </p>
        </>
      ) : null}

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
        Воспроизведение
      </h2>
      <p className="note" style={{ marginTop: 10 }}>
        Видео YouTube играют только в официальном плеере YouTube, пока он открыт на экране: свернёте плеер или Telegram — воспроизведение остановится. Треки Jamendo продолжают играть в мини-плеере. Скачивания и офлайн-режима в AURIS нет.
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
        AURIS хранит ваш Telegram ID, лайки, прослушивания, плейлисты и найденные песни — только чтобы строить рекомендации. Записи для Слуха удаляются сразу после распознавания. Сведения о видео YouTube обновляются или удаляются не реже чем раз в 30 дней. Удаление стирает данные сразу; данные на YouTube и в аккаунте Google оно не затрагивает.
      </p>

      <h2 className="label" style={{ marginTop: 28 }}>
        Документы
      </h2>
      <div className="group glass" style={{ marginTop: 12 }}>
        <button type="button" className="group-item" onClick={() => go.push({ name: 'legal', page: 'terms' })}>
          <span className="grow">
            <b>Условия использования AURIS</b>
          </span>
        </button>
        <button type="button" className="group-item" onClick={() => go.push({ name: 'legal', page: 'privacy' })}>
          <span className="grow">
            <b>Политика конфиденциальности AURIS</b>
          </span>
        </button>
        <a className="group-item" href={YOUTUBE_TERMS} target="_blank" rel="noopener">
          <span className="grow">
            <b>Условия использования YouTube ↗</b>
            <small>Пользуясь AURIS, вы соглашаетесь с ними</small>
          </span>
        </a>
        <a className="group-item" href={GOOGLE_PRIVACY} target="_blank" rel="noopener">
          <span className="grow">
            <b>Политика конфиденциальности Google ↗</b>
          </span>
        </a>
      </div>
      <p className="note center" style={{ marginTop: 24 }}>
        AURIS · Слышать каждую ноту
      </p>
    </main>
  );
}
