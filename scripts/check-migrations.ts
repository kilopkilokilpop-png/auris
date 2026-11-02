/** pnpm check:migrations — names are ordered and unique, and all migrations apply cleanly (twice) to a fresh Postgres (PGlite). */
import { createPgliteDb } from '../apps/api/src/db/db.ts';
import { listMigrations, migrate } from '../apps/api/src/db/migrate.ts';

const dir = 'db/migrations';
const list = listMigrations(dir);
const nums = list.map((m) => m.name.slice(0, 4));
if (new Set(nums).size !== nums.length) throw new Error('Duplicate migration numbers');
nums.forEach((n, i) => {
  if (Number(n) !== i + 1) throw new Error(`Migration numbering gap at ${n}`);
});
const db = await createPgliteDb();
const applied = await migrate(db, dir);
const again = await migrate(db, dir);
if (again.length) throw new Error('Migrations re-applied on second run');
const tables = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public'`);
await db.close();
console.log(`migrations OK: ${applied.length} applied, ${tables.rows[0]!.n} tables`);
