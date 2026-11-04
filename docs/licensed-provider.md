# LicensedProvider — contract for a B2B catalogue

`apps/api/src/providers/music/LicensedProvider.ts` is a ready adapter that speaks the neutral REST
contract below. To plug in Tuned Global, 7digital or a similar vendor, put a thin translation layer
(a small service or a rewrite of `request()`) that exposes this contract. Nothing in the Mini App,
the recommender or the bot changes — only `.env`:

```
MUSIC_PROVIDERS=licensed            # or licensed,jamendo
LICENSED_API_URL=https://catalog.example.com
LICENSED_API_KEY=...
LICENSED_CACHE_FILE_ID=false        # true only when the contract allows re-sending a cached Telegram file
```

All requests carry `Authorization: Bearer <LICENSED_API_KEY>` and are made **server side only**.

## Types

```ts
Variant = { codec: 'mp3'|'aac'|'flac', bitrateKbps?, bitDepth?, sampleRateHz?, lossless: boolean }
Track = {
  id, title, artist: { id, name }, album?: { id, title, coverUrl? }, durationSec, isrc?,
  genres?: string[], moods?: string[], popularity?: 0..1,
  variants: Variant[],            // real deliverable files; Hi-Res is shown only if bitDepth >= 24 is declared
  rights: { stream: boolean, preview: boolean },
  previewSec?, licenseLabel?
}
```

## Endpoints

| Method | Path | Returns |
|---|---|---|
| GET | `/v1/search?q=&type=all\|track\|artist\|album&limit=` | `{ tracks: Track[], artists: {id,name,imageUrl?}[], albums: {id,title,artist,coverUrl?}[] }` |
| GET | `/v1/tracks/:id` | `Track` (rights evaluated for the end user's territory) |
| GET | `/v1/tracks?isrc=` | `Track[]` (used to match Слух results) |
| GET | `/v1/tracks/:id/stream?codec=&tier=` | `{ url, mime }` short-lived signed URL |
| GET | `/v1/albums/:id` | `{ id, title, artist, coverUrl?, tracks: Track[] }` |
| GET | `/v1/artists/:id` / `/top?limit=` / `/related?limit=` | artist / `Track[]` / artists |
| GET | `/v1/charts/tracks?limit=` / `/v1/charts/artists?limit=` | `Track[]` / artists |
| GET | `/v1/genres` / `/v1/genres/:id/tracks?limit=` | `{id,name}[]` / `Track[]` |

## Rules enforced by the adapter

* Playback `full` only with `rights.stream`; `preview` with `rights.preview` (shown as preview in UI); otherwise not playable.
  Any error while checking rights → deny.


This version of AURIS has **no downloads**: only `rights.stream` / `rights.preview` are used.
