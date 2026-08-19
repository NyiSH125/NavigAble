# NavigAble

Accessibility obstacle map. Users photograph obstacles, a vision model classifies them per
disability profile, and routing avoids them.

## Setup

```bash
npm install
cp .env.example .env.local   # then fill in the keys
npm run dev
```

## Stack

- Next.js 15 (App Router), TypeScript, Tailwind CSS 4
- Supabase (Postgres, storage, auth)
- MapLibre GL
- Gemini for vision classification, called only from `app/api` routes

## Map notes

`public/maplibre/` is generated, not committed. `scripts/copy-maplibre-worker.mjs`
copies MapLibre's worker bundle there from `node_modules` on `predev` and
`prebuild`, and `components/Map.tsx` points `setWorkerUrl` at it.

This is a workaround, not a preference. MapLibre 6 starts its worker with
`new Worker(url, { type: "module" })` and under Next that URL resolves to the app
root, so the browser is handed HTML, rejects it on MIME grounds, and the worker
never starts. The visible result is a map that creates its canvas and then never
loads a style, with no error that names the cause. Serving the worker from
`public/` sidesteps the resolution. Reproduced under both Turbopack and webpack,
so it is not specific to the bundler.

Tiles come from OpenFreeMap, which needs no key. The style is
`https://tiles.openfreemap.org/styles/dark`.

## Storage

Report photos live in a Supabase Storage bucket named `reports`.

Create it once per project, in the dashboard under Storage:

1. Storage, then "New bucket"
2. Name it exactly `reports`
3. Turn **Public bucket** on

The bucket has to be public because `photo_url` is stored as a plain URL and the
detail panel loads it directly in an `img` tag. Nothing sensitive belongs in
there: treat every uploaded photo as world readable, and strip EXIF location
from uploads when the reporting flow is built, since the report already carries
its own coordinates.

Uploads are written by the service role from server code only. Browsers never
hold the service role key, so a public bucket is readable but not writable from
the client.

Before launch, strip EXIF from uploads. Photos submitted through the app keep
whatever metadata the camera wrote, including GPS, and the report already carries
its own coordinates so the embedded copy is redundant risk.

User submissions land under `user/` in the bucket. Seeded example rows are written
to `seed-fake/` and can be
removed with `npx tsx scripts/seed-fake.ts --reset`.

## Environment

| Key | Scope | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | server | Vision classification |
| `GEMINI_MODEL_ID` | server | Flash model id, defaults to the current one |
| `NEXT_PUBLIC_SUPABASE_URL` | public | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | Browser client, RLS enforced |
| `SUPABASE_SERVICE_ROLE_KEY` | server | Admin client, bypasses RLS |
| `ORS_API_KEY` | server | Routing |
| `MAPILLARY_TOKEN` | server | Street-level imagery |
| `NEXT_PUBLIC_DEFAULT_CENTER` | public | Starting map centre, `lng,lat` |
| `NEXT_PUBLIC_DEFAULT_ZOOM` | public | Starting map zoom, 0 to 22 |

Project conventions live in [CLAUDE.md](CLAUDE.md).
