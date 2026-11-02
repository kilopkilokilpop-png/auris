// Fresh API for Playwright: wipes the e2e data dir, builds shared, starts the API with MockProvider.
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
fs.rmSync('.data/e2e/pglite', { recursive: true, force: true });
execSync('pnpm --filter @auris/shared build', { stdio: 'inherit' });
const p = spawn('pnpm', ['--filter', '@auris/api', 'exec', 'tsx', 'src/index.ts'], { stdio: 'inherit', env: process.env });
process.on('SIGTERM', () => p.kill('SIGTERM'));
process.on('SIGINT', () => p.kill('SIGINT'));
p.on('exit', (c) => process.exit(c ?? 0));
