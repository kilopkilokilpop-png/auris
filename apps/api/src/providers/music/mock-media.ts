import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { MOCK_DURATION_SEC, type MockTrack } from './mock-catalog.js';

const run = promisify(execFile);
export type MockVariant = 'mp3' | 'hifi' | 'hires';

const inflight = new Map<string, Promise<string>>();

/** Deterministic little synth tune; arpeggio over a minor/major seventh chord + kick. */
function expression(t: MockTrack): string {
  const b = (t.bpm / 60).toFixed(4);
  const third = t.minor ? 3 : 4;
  const seventh = t.minor ? 10 : 11;
  const step = `floor(mod(t*${b},4))`;
  const semi = `(${third}*eq(${step},1)+7*eq(${step},2)+${seventh}*eq(${step},3))`;
  const lead = `0.20*sin(2*PI*${t.root}*pow(2,${semi}/12)*t)*exp(-2.5*mod(t*${b},1))`;
  const pad = `0.07*sin(2*PI*${t.root / 2}*t)+0.05*sin(2*PI*${(t.root * 3) / 4}*t)`;
  const kick = `0.33*exp(-28*mod(t,${(60 / t.bpm).toFixed(4)}))*sin(2*PI*52*t)`;
  const fade = `min(1,t/2)*min(1,(${MOCK_DURATION_SEC}-t)/3)`;
  return `(${lead}+${pad}+${kick})*${fade}`;
}

async function once(key: string, out: string, make: () => Promise<void>): Promise<string> {
  if (fs.existsSync(out)) return out;
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = (async () => {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await make();
    return out;
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export class MockMedia {
  constructor(
    private readonly dir: string,
    private readonly ffmpeg: string,
  ) {}

  audioPath(t: MockTrack, v: MockVariant): string {
    return path.join(this.dir, 'audio', `${t.id}.${v}.${v === 'mp3' ? 'mp3' : 'flac'}`);
  }

  async ensureAudio(t: MockTrack, v: MockVariant): Promise<string> {
    const out = this.audioPath(t, v);
    return once(out, out, async () => {
      const e = expression(t);
      const rate = v === 'hires' ? 96000 : 44100;
      const codec =
        v === 'mp3'
          ? ['-c:a', 'libmp3lame', '-b:a', '192k']
          : v === 'hifi'
            ? ['-c:a', 'flac', '-sample_fmt', 's16']
            : ['-c:a', 'flac', '-sample_fmt', 's32', '-bits_per_raw_sample', '24'];
      const tmp = `${out}.${process.pid}-${Math.random().toString(36).slice(2)}.tmp${path.extname(out)}`;
      await run(this.ffmpeg, [
        '-y', '-loglevel', 'error',
        '-f', 'lavfi', '-i', `aevalsrc=exprs='${e}|${e}':s=${rate}:d=${MOCK_DURATION_SEC}`,
        ...codec,
        '-metadata', `title=${t.title}`,
        '-metadata', 'comment=AURIS demo audio, CC0',
        tmp,
      ]);
      fs.renameSync(tmp, out);
    });
  }

  /** SVG cover in the AURIS look: graphite gradient, soft top light, the logo mark. */
  coverSvg(seed: number): string {
    const light = 0x5a + ((seed * 37) % 0x70);
    const mid = 0x2a + ((seed * 13) % 0x14);
    const hex = (v: number) => `#${v.toString(16).padStart(2, '0').repeat(3)}`;
    const angles = [[0, 0, 1, 1], [1, 0, 0, 1], [0.5, 0, 0.5, 1], [0, 0.2, 1, 0.8]];
    const [x1, y1, x2, y2] = angles[seed % angles.length]!;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" width="600" height="600">
<defs><linearGradient id="g" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"><stop offset="0" stop-color="${hex(light)}"/><stop offset=".45" stop-color="${hex(mid)}"/><stop offset="1" stop-color="#141416"/></linearGradient>
<radialGradient id="h" cx=".25" cy=".1" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
<rect width="600" height="600" fill="url(#g)"/><rect width="600" height="600" fill="url(#h)"/>
<g transform="translate(222 222) scale(5)" fill="none" stroke-linecap="round" stroke-width="2.6"><circle cx="7.5" cy="16" r="3" fill="#F5F5F7" stroke="none"/><path d="M13 10.5a7.6 7.6 0 0 1 0 11" stroke="#F5F5F7"/><path d="M17.6 6.6a13 13 0 0 1 0 18.8" stroke="#C2C2C7"/><path d="M22.2 2.8a18.4 18.4 0 0 1 0 26.4" stroke="#88888E"/></g></svg>`;
  }

  async ensureCover(id: string, seed: number, format: 'svg' | 'jpg'): Promise<string> {
    const svg = path.join(this.dir, 'covers', `${id}.svg`);
    if (!fs.existsSync(svg)) {
      fs.mkdirSync(path.dirname(svg), { recursive: true });
      const tmp = `${svg}.${process.pid}-${Math.random().toString(36).slice(2)}.tmp`;
      fs.writeFileSync(tmp, this.coverSvg(seed));
      fs.renameSync(tmp, svg);
    }
    if (format === 'svg') return svg;
    const out = path.join(this.dir, 'covers', `${id}.jpg`);
    return once(out, out, async () => {
      const tmp = `${out}.${process.pid}-${Math.random().toString(36).slice(2)}.tmp.jpg`;
      try {
        // Needs ffmpeg built with librsvg; otherwise fall back to a plain gradient.
        await run(this.ffmpeg, ['-y', '-loglevel', 'error', '-i', svg, '-frames:v', '1', '-q:v', '4', tmp]);
      } catch {
        const light = 0x5a + ((seed * 37) % 0x70);
        const hex = (v: number) => `0x${v.toString(16).padStart(2, '0').repeat(3)}`;
        await run(this.ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `gradients=s=600x600:c0=${hex(light)}:c1=0x141416:x0=0:y0=0:x1=600:y1=600:nb_colors=2:type=linear`, '-frames:v', '1', '-q:v', '4', tmp]);
      }
      fs.renameSync(tmp, out);
    });
  }
}
