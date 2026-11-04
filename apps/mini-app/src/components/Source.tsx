import type { Track } from '@auris/shared';

export const SOURCE_NAMES: Record<string, string> = { youtube: 'YouTube', audius: 'Audius', jamendo: 'Jamendo', deezer: 'Deezer', licensed: 'Лицензионный каталог', mock: 'Демо-каталог' };

/** Author (shown above), licence link and backlink to the source: required by Jamendo for every track. */
export function Attribution({ track }: { track: Track }) {
  if (track.provider === 'mock' || track.provider === 'youtube') return null;
  return (
    <p className="attribution">
      {track.license.sourceUrl ? (
        <a className="source-link" href={track.license.sourceUrl} target="_blank" rel="noopener">
          {SOURCE_NAMES[track.provider] ?? track.provider} ↗
        </a>
      ) : null}
      {track.license.url ? (
        <a className="source-link" href={track.license.url} target="_blank" rel="noopener">
          {track.license.name}
        </a>
      ) : (
        <span className="source-link">{track.license.name}</span>
      )}
    </p>
  );
}
