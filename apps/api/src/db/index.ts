import path from 'node:path';
import type { Env } from '../config/env.js';
import { REPO_ROOT } from '../config/load.js';
import { createPgliteDb, createPostgresDb, type Db } from './db.js';
import { migrate } from './migrate.js';

export const MIGRATIONS_DIR = path.join(REPO_ROOT, 'db', 'migrations');

export async function openDb(env: Env): Promise<Db> {
  const db = env.DATABASE_URL
    ? await createPostgresDb(env.DATABASE_URL)
    : await createPgliteDb(path.join(env.DATA_DIR, 'pglite'));
  await migrate(db, MIGRATIONS_DIR);
  return db;
}
export type { Db };
