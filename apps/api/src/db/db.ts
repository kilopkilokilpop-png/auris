import fs from 'node:fs';
import path from 'node:path';

export interface QueryResult<R> {
  rows: R[];
}
export interface Db {
  query<R = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<R>>;
  /** Runs a multi-statement script (migrations). */
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  readonly kind: 'postgres' | 'pglite';
}

/**
 * DATABASE_URL may list several candidates separated by commas (e.g. Supabase pooler hosts
 * aws-0-… and aws-1-…): the first one that answers `SELECT 1` is used.
 */
export async function createPostgresDb(urls: string): Promise<Db> {
  const list = urls.split(',').map((u) => u.trim()).filter(Boolean);
  let last: unknown;
  for (const url of list) {
    try {
      const db = await connectPostgres(url);
      await Promise.race([db.query('SELECT 1'), new Promise((_, rej) => setTimeout(() => rej(new Error('connect timeout')), 15_000))]);
      return db;
    } catch (e) {
      last = e;
      if (list.length > 1) console.warn(`[db] candidate failed (${new URL(url).hostname}): ${(e as Error).message}`);
    }
  }
  throw last instanceof Error ? last : new Error('No database URL');
}

async function connectPostgres(url: string): Promise<Db> {
  const pg = await import('pg');
  const Pool = pg.default.Pool;
  // BIGINT -> number (Telegram ids fit in 2^53).
  pg.default.types.setTypeParser(20, (v: string) => Number(v));
  // TLS for hosted Postgres (Supabase pooler etc.). sslmode in the URL is stripped so this setting wins.
  const u = new URL(url);
  const wantSsl = /^(require|verify-ca|verify-full|prefer)$/.test(u.searchParams.get('sslmode') ?? '') || /supabase\.(co|com)$/.test(u.hostname);
  u.searchParams.delete('sslmode');
  const pool = new Pool({
    connectionString: u.toString(),
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    ssl: wantSsl ? { rejectUnauthorized: false } : undefined,
  });
  const wrap = (q: { query: (s: string, p?: unknown[]) => Promise<{ rows: unknown[] }> }): Omit<Db, 'transaction' | 'close' | 'kind'> => ({
    async query<R>(sql: string, params?: unknown[]) {
      const r = await q.query(sql, params);
      return { rows: r.rows as R[] };
    },
    async exec(sql: string) {
      await q.query(sql);
    },
  });
  const db: Db = {
    kind: 'postgres',
    ...wrap(pool),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const tx: Db = { ...wrap(client), kind: 'postgres', transaction: (f) => f(tx), close: async () => {} };
        const out = await fn(tx);
        await client.query('COMMIT');
        return out;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
  return db;
}

/** Embedded Postgres (WASM). `dir` undefined = in-memory (tests). */
export async function createPgliteDb(dir?: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  if (dir) fs.mkdirSync(path.dirname(dir), { recursive: true });
  const pg = dir ? await PGlite.create(dir) : await PGlite.create();
  const mk = (q: { query: typeof pg.query; exec: typeof pg.exec }): Omit<Db, 'transaction' | 'close' | 'kind'> => ({
    async query<R>(sql: string, params?: unknown[]) {
      const r = await q.query<R>(sql, params as unknown[]);
      return { rows: r.rows.map(normalizeRow) as R[] };
    },
    async exec(sql: string) {
      await q.exec(sql);
    },
  });
  const db: Db = {
    kind: 'pglite',
    ...mk(pg),
    async transaction(fn) {
      return pg.transaction(async (t) => {
        const tx: Db = { ...mk(t as unknown as typeof pg), kind: 'pglite', transaction: (f) => f(tx), close: async () => {} };
        return fn(tx);
      });
    },
    close: () => pg.close(),
  };
  return db;
}

/** PGlite returns BIGINT as bigint; normalise to number like the pg path. */
function normalizeRow<R>(row: R): R {
  if (row && typeof row === 'object') {
    for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
      if (typeof v === 'bigint') (row as Record<string, unknown>)[k] = Number(v);
    }
  }
  return row;
}
