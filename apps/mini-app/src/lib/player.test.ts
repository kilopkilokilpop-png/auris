import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '@auris/shared';

vi.mock('./api', () => ({
  api: { event: vi.fn(async () => ({ ok: true })), waveNext: vi.fn(async () => ({ items: [] })), streamUrl: vi.fn(async () => ({ url: '/x.mp3', kind: 'full', qualityLine: '' })), dislike: vi.fn(async () => ({})) },
  ApiFailure: class extends Error {},
}));

const { player } = await import('./player');
const { api } = await import('./api');

const yt = (id: string, kids = false): Track => ({
  id: `youtube:${id}`, provider: 'youtube', title: id, artist: { id: 'youtube:UCx', name: 'Канал' }, durationSec: 200, genres: [], tags: [], popularity: 0.5,
  playback: { kind: 'embed', playableSec: 200, qualities: [] }, license: { name: 'YouTube' },
  youtube: { videoId: id.padEnd(11, 'x').slice(0, 11), channelId: 'UCx', channelTitle: 'Канал', madeForKids: kids, fetchedAt: '' },
});
const jm = (id: string): Track => ({ ...yt(id), id: `jamendo:${id}`, provider: 'jamendo', playback: { kind: 'full', playableSec: 200, qualities: [] }, youtube: undefined });

describe('YouTube in the global player', () => {
  beforeEach(() => {
    player.stop();
    vi.mocked(api.event).mockClear();
  });

  it('a list does NOT autoplay the next track when a YouTube video ends', () => {
    player.playList([yt('a'), yt('b')], 0, { label: 'Поиск', kind: 'list' });
    expect(player.state).toMatchObject({ embed: true, expanded: true, index: 0 });
    player.onEmbedState('playing', 10, 200);
    player.onEmbedState('ended', 200, 200);
    expect(player.state.index).toBe(0);
  });

  it('Резонанс (switched on by the user) moves to the next track; the embed itself still checks visibility', () => {
    player.playList([yt('a'), yt('b')], 0, { label: 'Резонанс', kind: 'wave', wave: { mood: 'any', mode: 'mix' } });
    player.onEmbedState('playing', 10, 200);
    const before = player.state.embedWantsPlay;
    player.onEmbedState('ended', 200, 200);
    expect(player.state.index).toBe(1);
    expect(player.state.embedWantsPlay).toBeGreaterThanOrEqual(before);
  });

  it('collapsing the player stops YouTube: no mini-player, no background playback', () => {
    player.playList([yt('a')], 0, { label: 'Поиск', kind: 'list' });
    player.onEmbedState('playing', 5, 200);
    player.expand(false);
    expect(player.state).toMatchObject({ expanded: false, playing: false, embedWantsPlay: 0 });
  });

  it('collapsed: next skips YouTube tracks and keeps playing audio sources', () => {
    player.playList([jm('1'), yt('a'), jm('2')], 0, { label: 'Резонанс', kind: 'wave', wave: { mood: 'any', mode: 'mix' } });
    player.expand(false);
    player.next();
    expect(player.state.index).toBe(2);
  });

  it('Made for Kids: no AURIS events are sent', () => {
    player.playList([yt('k', true)], 0, { label: 'Поиск', kind: 'list' });
    player.onEmbedState('playing', 1, 200);
    player.onEmbedState('ended', 200, 200);
    expect(api.event).not.toHaveBeenCalled();
  });
});
