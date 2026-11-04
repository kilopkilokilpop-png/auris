import type { CatalogCapabilities, QualityTier, Track, UserProfile } from '@auris/shared';
import { api } from './api';
import { player } from './player';
import { Store } from './store';
import { tg } from './telegram';
import { toast } from './ui';

interface SessionState {
  profile: UserProfile | null;
  capabilities: CatalogCapabilities | null;
  liked: Set<string>;
  likedVersion: number;
}
export const session = new Store<SessionState>({ profile: null, capabilities: null, liked: new Set(), likedVersion: 0 });

export async function loadSession() {
  const me = await api.me();
  if (!me.termsAccepted) {
    // Nothing else is reachable before the terms + privacy policy are accepted.
    session.set({ profile: me });
    return me;
  }
  const [profile, likes, capabilities, config] = await Promise.all([
    Promise.resolve(me),
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

/** Consent screen: accept AURIS terms (incl. YouTube ToS) + privacy policy (incl. Google Privacy Policy). */
export async function acceptTerms() {
  await api.acceptTerms();
  tg.haptic.success();
  return loadSession();
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
