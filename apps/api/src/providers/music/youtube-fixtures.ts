import type { YtFetch, YtVideo } from './YouTubeProvider.js';

/**
 * DEVELOPMENT ONLY (refused when NODE_ENV=production): lets `pnpm dev` show the YouTube section
 * without an API key. Metadata of a few public, embeddable official videos (titles/channels as
 * YouTube shows them, checked via oEmbed 2026-11-04); playback still goes through the real
 * official IFrame player.
 */
const v = (id: string, title: string, channelId: string, channelTitle: string, duration: string, madeForKids = false): YtVideo => ({
  id,
  snippet: { title, channelId, channelTitle, liveBroadcastContent: 'none', thumbnails: { high: { url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, width: 480, height: 360 } } },
  contentDetails: { duration },
  status: { uploadStatus: 'processed', privacyStatus: 'public', embeddable: true, madeForKids },
});

export const YT_FIXTURES: YtVideo[] = [
  v('dQw4w9WgXcQ', 'Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)', 'UCuAXFkgsw1L7xaCfnd5JJOw', 'Rick Astley', 'PT3M33S'),
  v('fJ9rUzIMcZQ', 'Queen – Bohemian Rhapsody (Official Video Remastered)', 'UCiMhD4jzUqG-IgPzUmmytRQ', 'Queen Official', 'PT5M59S'),
  v('9bZkp7q19f0', 'PSY - GANGNAM STYLE(강남스타일) M/V', 'UCrDkAvwZum-UTjHmzDI2iIw', 'officialpsy', 'PT4M13S'),
];

export const fixtureFetch: YtFetch = async (url) => {
  const u = new URL(url);
  const byId = new Map(YT_FIXTURES.map((x) => [x.id, x]));
  if (u.pathname.endsWith('/search')) {
    const channel = u.searchParams.get('channelId');
    const words = (u.searchParams.get('q') ?? '').toLowerCase().split(/\s+/).filter((w) => w.length > 1 && w !== 'музыка');
    const hit = (x: YtVideo) => !words.length || words.some((w) => `${x.snippet!.title} ${x.snippet!.channelTitle}`.toLowerCase().includes(w));
    const list = channel ? YT_FIXTURES.filter((x) => x.snippet!.channelId === channel) : YT_FIXTURES.filter(hit);
    return { status: 200, body: { items: list.map((x) => ({ id: { kind: 'youtube#video', videoId: x.id } })) } };
  }
  if (u.pathname.endsWith('/videos')) {
    if (u.searchParams.get('chart')) return { status: 200, body: { items: YT_FIXTURES } };
    const ids = (u.searchParams.get('id') ?? '').split(',');
    return { status: 200, body: { items: ids.map((id) => byId.get(id)).filter(Boolean) } };
  }
  if (u.pathname.endsWith('/channels')) {
    const c = YT_FIXTURES.find((x) => x.snippet!.channelId === u.searchParams.get('id'));
    return { status: 200, body: { items: c ? [{ id: c.snippet!.channelId, snippet: { title: c.snippet!.channelTitle } }] : [] } };
  }
  return { status: 404, body: {} };
};
