/**
 * Rights revoked for a track (e.g. takedown or the artist disabled downloads):
 *   pnpm --filter @auris/api revoke jamendo:123456
 * Deletes the cached Telegram file_id so the file is never re-sent. The provider check in
 * getDownload() already refuses new downloads; this purges what we kept.
 */
import { loadEnv } from '../config/load.js';
import { openDb } from '../db/index.js';

const id = process.argv[2];
if (!id) {
  console.error('usage: revoke <trackId>');
  process.exit(1);
}
const db = await openDb(loadEnv());
await db.query('DELETE FROM telegram_file_cache WHERE track_id=$1', [id]);
console.log(`file_id cache cleared for ${id}`);
await db.close();
