import { loadEnv } from '../config/load.js';
import { createPgliteDb, createPostgresDb } from './db.js';
import path from 'node:path';
import { migrate } from './migrate.js';
import { MIGRATIONS_DIR } from './index.js';

const env = loadEnv();
const db = env.DATABASE_URL ? await createPostgresDb(env.DATABASE_URL) : await createPgliteDb(path.join(env.DATA_DIR, 'pglite'));
const done = await migrate(db, MIGRATIONS_DIR);
console.log(done.length ? `Applied: ${done.join(', ')}` : 'Database is up to date');
await db.close();
