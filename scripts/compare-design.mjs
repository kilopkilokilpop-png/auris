// Compares Playwright screenshots (390x844 @2x) with design/*.png (780x1688):
// writes screenshots/compare/<name>.png = [design | ours | diff] and prints the mismatch share.
// Mockups contain placeholders ([Название трека]); ours shows real data, so text areas always differ.
import fs from 'node:fs';
import path from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const pairs = [
  ['home', 'home'],
  ['wave', 'wave'],
  ['hear', 'hear'],
  ['profile', 'profile'],
  ['player', 'player'],
];
const outDir = 'screenshots/compare';
fs.mkdirSync(outDir, { recursive: true });
const rows = [];
for (const [design, shot] of pairs) {
  const dPath = path.join('design', `${design}.png`);
  const sPath = path.join('screenshots', `${shot}.png`);
  if (!fs.existsSync(dPath) || !fs.existsSync(sPath)) {
    rows.push(`${design}: missing ${fs.existsSync(dPath) ? sPath : dPath}`);
    continue;
  }
  const a = PNG.sync.read(fs.readFileSync(dPath));
  const b = PNG.sync.read(fs.readFileSync(sPath));
  const w = Math.min(a.width, b.width);
  const h = Math.min(a.height, b.height);
  const crop = (img) => {
    const o = new PNG({ width: w, height: h });
    for (let y = 0; y < h; y++) img.data.copy(o.data, y * w * 4, y * img.width * 4, y * img.width * 4 + w * 4);
    return o;
  };
  const A = crop(a);
  const B = crop(b);
  const diff = new PNG({ width: w, height: h });
  const n = pixelmatch(A.data, B.data, diff.data, w, h, { threshold: 0.2, alpha: 0.3 });
  const sheet = new PNG({ width: w * 3 + 40, height: h });
  sheet.data.fill(255);
  for (const [i, img] of [A, B, diff].entries()) PNG.bitblt(img, sheet, 0, 0, w, h, i * (w + 20), 0);
  fs.writeFileSync(path.join(outDir, `${design}.png`), PNG.sync.write(sheet));
  rows.push(`${design.padEnd(8)} ${((n / (w * h)) * 100).toFixed(1).padStart(5)}% pixels differ  (design ${a.width}x${a.height}, ours ${b.width}x${b.height})`);
}
console.log(rows.join('\n'));
fs.writeFileSync(path.join(outDir, 'report.txt'), rows.join('\n') + '\n');
