/**
 * pnpm smoke — live check of the configured providers against the real upstream APIs.
 * Uses keys from .env. Not part of `pnpm test` (needs network + keys).
 *   MUSIC_PROVIDERS=deezer DEEZER_ENABLED_NONCOMMERCIAL=true pnpm smoke
 */
import fs from 'node:fs';
import { loadEnv } from '../apps/api/src/config/load.ts';
import { createMusicProvider } from '../apps/api/src/providers/music/registry.ts';
import { createRecognition } from '../apps/api/src/providers/recognition/registry.ts';
import { normalizeForRecognition } from '../apps/api/src/lib/ffmpeg.ts';

const env = loadEnv();
const music = createMusicProvider(env);
let failed = false;
const step = async (name: string, fn: () => Promise<string>) => {
  try {
    console.log(`✓ ${name}: ${await fn()}`);
  } catch (e) {
    failed = true;
    console.log(`✗ ${name}: ${(e as Error).message}`);
  }
};

for (const p of music.providers) {
  console.log(`\n== ${p.info.name} (${p.info.id})`);
  const q = process.env.SMOKE_QUERY ?? 'daft punk';
  let firstId = '';
  await step('search', async () => {
    const r = await p.search(q, { type: 'all', limit: 5 });
    firstId = r.tracks[0]?.id ?? '';
    return `${r.tracks.length} tracks, ${r.artists.length} artists, ${r.albums.length} albums; first: ${r.tracks[0]?.artist.name} — ${r.tracks[0]?.title} [${r.tracks[0]?.playback.kind} ${r.tracks[0]?.playback.playableSec}s]`;
  });
  await step('chart', async () => {
    const c = await p.getChart(5);
    firstId ||= c[0]?.id ?? '';
    return c.map((t) => `${t.artist.name} — ${t.title}`).join(' | ');
  });
  await step('editorial', async () => {
    const a = await p.getEditorial();
    return a ? `${a.artist.name} — ${a.title} (${a.tracks?.length ?? 0} tracks)` : 'none';
  });
  await step('genres', async () => `${(await p.getGenres()).length} genres`);
  await step('stream', async () => {
    const s = await p.getStream(firstId, 'standard');
    if (!s) throw new Error('no stream');
    if (s.filePath) return `local file ${s.kind}`;
    const r = await fetch(s.url, { headers: { range: 'bytes=0-4095' } });
    const b = Buffer.from(await r.arrayBuffer());
    return `${s.kind} ${s.playableSec}s, HTTP ${r.status}, ${r.headers.get('content-type')}, ${b.length} bytes, mp3=${b.subarray(0, 3).toString() === 'ID3' || b[0] === 0xff}`;
  });
  await step('download decision', async () => {
    const d = await p.getDownload(firstId);
    return d.allowed ? `allowed, cache file_id=${d.cacheFileId}` : `denied (${d.code}): ${d.reason}`;
  });
  await step('match by ISRC/title', async () => {
    const t = await p.match({ title: 'Harder, Better, Faster, Stronger', artist: 'Daft Punk', isrc: 'GBDUW0000059' });
    return t ? `${t.id} ${t.artist.name} — ${t.title}` : 'no match';
  });
}

const sample = process.env.SMOKE_AUDIO;
if (sample && fs.existsSync(sample)) {
  const rec = createRecognition(env);
  console.log(`\n== Recognition (${rec.name})`);
  await step('recognize', async () => {
    const r = await rec.recognize(await normalizeForRecognition(env.FFMPEG_PATH, fs.readFileSync(sample)), 'audio/mpeg');
    return r.status === 'found' ? `${r.match.artist} — ${r.match.title} (isrc ${r.match.isrc ?? '-'})` : 'not found';
  });
}
process.exit(failed ? 1 : 0);
