import type { CatalogCapabilities, QualityTier, Track, UserProfile } from '@auris/shared';
import { api, ApiFailure } from './api';
import { player } from './player';
import { Store } from './store';
import { tg } from './telegram';
import { openSheet, toast } from './ui';

interface SessionState {
  profile: UserProfile | null;
  capabilities: CatalogCapabilities | null;
  liked: Set<string>;
  likedVersion: number;
}
export const session = new Store<SessionState>({ profile: null, capabilities: null, liked: new Set(), likedVersion: 0 });

export async function loadSession() {
  const [profile, likes, capabilities, config] = await Promise.all([
    api.me(),
    api.likedIds().catch(() => ({ ids: [] })),
    api.capabilities().catch(() => null),
    api.publicConfig().catch(() => ({ botUsername: null })),
  ]);
  tg.setBotUsername(config.botUsername);
  // A saved tier the current sources cannot deliver (e.g. Hi-Res after a provider change) falls back honestly.
  const tiers = capabilities?.qualities ?? [];
  const current = tiers.find((q) => q.tier === profile.settings.quality);
  if (current && !current.available) {
    const best = [...tiers].reverse().find((q) => q.available)?.tier ?? 'standard';
    profile.settings = { ...profile.settings, quality: best };
    void api.settings({ quality: best }).catch(() => {});
  }
  session.set({ profile, liked: new Set(likes.ids), capabilities });
  player.setQuality(profile.settings.quality);
  return profile;
}

export function refreshProfile() {
  return api.me().then((profile) => session.set({ profile })).catch(() => {});
}

export async function setQuality(q: QualityTier) {
  const cap = session.get().capabilities?.qualities.find((x) => x.tier === q);
  if (cap && !cap.available) {
    tg.haptic.warning();
    toast(cap.reason ?? 'Этот режим качества недоступен для подключённых источников');
    return;
  }
  tg.haptic.select();
  const prev = session.get().profile;
  if (prev) session.set({ profile: { ...prev, settings: { ...prev.settings, quality: q } } });
  player.setQuality(q);
  await api.settings({ quality: q }).catch(() => prev && session.set({ profile: prev }));
}

export async function toggleLike(track: Track) {
  const liked = new Set(session.get().liked);
  const was = liked.has(track.id);
  if (was) liked.delete(track.id);
  else liked.add(track.id);
  session.set((s) => ({ liked, likedVersion: s.likedVersion + 1 }));
  if (was) tg.haptic.tap();
  else tg.haptic.success();
  try {
    await (was ? api.unlike(track.id) : api.like(track.id));
    // Резонанс reacts immediately, without restarting.
    if (player.state.context?.kind === 'wave') void player.refreshWave();
    void refreshProfile();
  } catch {
    const back = new Set(session.get().liked);
    if (was) back.add(track.id);
    else back.delete(track.id);
    session.set((s) => ({ liked: back, likedVersion: s.likedVersion + 1 }));
    toast('Не удалось обновить избранное');
  }
}

/** "Скачать в Telegram": the server decides; we only explain the outcome. */
export async function downloadToTelegram(track: Track) {
  if (!track.downloadable) {
    tg.haptic.warning();
    openSheet({ kind: 'info', title: 'Скачивание недоступно', body: downloadExplanation(track) });
    return;
  }
  toast('Отправляем в чат с ботом…');
  try {
    await api.download(track.id);
    tg.haptic.success();
    toast('Готово — трек в чате с ботом. Открываю Telegram…');
    // Take the user straight to the chat where the audio file just arrived.
    setTimeout(() => tg.openBot(tg.botUsername ? `https://t.me/${tg.botUsername}` : undefined), 600);
  } catch (e) {
    tg.haptic.error();
    if (e instanceof ApiFailure && e.code === 'BOT_NOT_STARTED') {
      openSheet({
        kind: 'info',
        title: 'Запустите бота',
        body: 'Telegram не разрешает ботам писать первыми. Откройте чат с ботом AURIS и нажмите «Запустить», затем повторите скачивание.',
        action: { label: 'Открыть бота', run: () => tg.openBot(e.botLink) },
      });
    } else if (e instanceof ApiFailure && e.code === 'DOWNLOAD_FORBIDDEN') {
      openSheet({ kind: 'info', title: 'Скачивание недоступно', body: e.message });
    } else {
      toast(e instanceof Error ? e.message : 'Не удалось отправить файл');
    }
  }
}

export function downloadExplanation(t: Track): string {
  if (t.provider === 'deezer') return 'Deezer разрешает только 30-секундные превью внутри приложения. Скачивание и отправка файлов запрещены условиями Deezer API.';
  return t.downloadNote ?? 'Правообладатель не разрешил скачивание этого трека. Его можно слушать в AURIS.';
}
