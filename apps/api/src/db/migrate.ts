import fs from 'node:fs';
import path from 'node:path';
import type { Db } from './db.js';

export const MIGRATION_NAME = /^(\d{4})_[a-z0-9_]+\.sql$/;

export function listMigrations(dir: string): { name: string; sql: string }[] {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  return files.map((name) => {
    if (!MIGRATION_NAME.test(name)) throw new Error(`Bad migration file name: ${name} (expected 0001_name.sql)`);
    return { name, sql: fs.readFileSync(path.join(dir, name), 'utf8') };
  });
}

export async function migrate(db: Db, dir: string): Promise<string[]> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const applied = new Set((await db.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  const done: string[] = [];
  for (const m of listMigrations(dir)) {
    if (applied.has(m.name)) continue;
    await db.transaction(async (tx) => {
      await tx.exec(m.sql);
      await tx.query('INSERT INTO schema_migrations (name) VALUES ($1)', [m.name]);
    });
    done.push(m.name);
  }
  return done;
}
