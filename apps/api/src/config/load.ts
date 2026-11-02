import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseEnv, type Env } from './env.js';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Monorepo root (apps/api/src/config -> ../../../..) */
export const REPO_ROOT = path.resolve(here, '../../../..');

let cached: Env | undefined;
export function loadEnv(): Env {
  if (cached) return cached;
  config({ path: path.join(REPO_ROOT, '.env'), quiet: true });
  cached = parseEnv(process.env);
  if (!path.isAbsolute(cached.DATA_DIR)) cached.DATA_DIR = path.join(REPO_ROOT, cached.DATA_DIR);
  return cached;
}
