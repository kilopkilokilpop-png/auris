import type { AudioQuality, QualityTier, Track } from './models.js';

const TIER_ORDER: QualityTier[] = ['standard', 'hifi', 'hires'];

/**
 * Classify a variant strictly from declared data.
 * Hi-Res requires a stated bit depth >= 24 AND lossless codec. Hi-Fi requires lossless.
 * Anything unknown is "standard".
 */
export function classifyQuality(q: Omit<AudioQuality, 'tier'>): QualityTier {
  if (!q.lossless) return 'standard';
  if ((q.bitDepth ?? 0) >= 24 && (q.sampleRateHz ?? 0) >= 44_100) return 'hires';
  return 'hifi';
}

/** Best real variant not exceeding the requested tier. */
export function pickVariant(qualities: AudioQuality[], requested: QualityTier): AudioQuality | undefined {
  const max = TIER_ORDER.indexOf(requested);
  const allowed = qualities
    .filter((q) => TIER_ORDER.indexOf(q.tier) <= max)
    .sort((a, b) => TIER_ORDER.indexOf(b.tier) - TIER_ORDER.indexOf(a.tier) || (b.bitrateKbps ?? 0) - (a.bitrateKbps ?? 0));
  return allowed[0] ?? [...qualities].sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier))[0];
}

export function formatKhz(hz: number): string {
  const k = hz / 1000;
  return Number.isInteger(k) ? String(k) : k.toFixed(1).replace('.', ',');
}

/** e.g. "24/96" — only when both values are declared. */
export function bitDepthLabel(q: AudioQuality): string | undefined {
  if (!q.bitDepth || !q.sampleRateHz) return undefined;
  return `${q.bitDepth}/${formatKhz(q.sampleRateHz)}`;
}

export type BadgeKind = 'hires' | 'flac' | 'lossless' | 'preview' | 'unavailable' | 'none';

export interface TrackBadge {
  kind: BadgeKind;
  /** Short visible label, uppercase in UI. */
  label: string;
  /** Accessible / tooltip description. */
  description: string;
}

/**
 * Badge for track lists. Uses only data on the track; never promotes lossy streams.
 * Previews win over quality — we never advertise quality on a 30-second clip.
 */
export function trackBadge(track: Track, tier: QualityTier = 'hires'): TrackBadge {
  if (track.playback.kind === 'none') {
    return { kind: 'unavailable', label: 'НЕТ', description: track.playback.note ?? 'Нельзя послушать в AURIS' };
  }
  if (track.playback.kind === 'preview') {
    return {
      kind: 'preview',
      label: `${Math.round(track.playback.playableSec)} С`,
      description: `Только превью ${Math.round(track.playback.playableSec)} секунд`,
    };
  }
  const v = pickVariant(track.playback.qualities, tier);
  if (!v) return { kind: 'none', label: '', description: '' };
  if (v.tier === 'hires') {
    return { kind: 'hires', label: 'HI-RES', description: `Hi-Res ${bitDepthLabel(v) ?? ''}`.trim() };
  }
  if (v.codec === 'flac') return { kind: 'flac', label: 'FLAC', description: 'FLAC без потерь' };
  if (v.lossless) return { kind: 'lossless', label: 'LOSSLESS', description: 'Без потерь' };
  return { kind: 'none', label: '', description: v.bitrateKbps ? `${v.codec.toUpperCase()} ${v.bitrateKbps} кбит/с` : '' };
}

/** Player line: "HI-RES · 24/96", "FLAC · 16/44,1", "MP3 · 320", "ПРЕВЬЮ · 30 С". */
export function playerQualityLine(track: Track, tier: QualityTier): string {
  if (track.playback.kind === 'preview') return `ПРЕВЬЮ · ${Math.round(track.playback.playableSec)} С`;
  if (track.playback.kind === 'none') return 'НЕДОСТУПНО';
  const v = pickVariant(track.playback.qualities, tier);
  if (!v) return '';
  const bd = bitDepthLabel(v);
  if (v.tier === 'hires') return bd ? `HI-RES · ${bd}` : 'HI-RES';
  if (v.codec === 'flac') return bd ? `FLAC · ${bd}` : 'FLAC';
  return v.bitrateKbps ? `${v.codec.toUpperCase()} · ${v.bitrateKbps}` : v.codec.toUpperCase();
}

export function maxTierOf(track: Track): QualityTier | undefined {
  let best = -1;
  for (const q of track.playback.qualities) best = Math.max(best, TIER_ORDER.indexOf(q.tier));
  return best >= 0 ? TIER_ORDER[best] : undefined;
}
