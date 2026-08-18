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
- Anthropic SDK for vision classification, called only from `app/api` routes

## Environment

| Key | Scope | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | server | Vision classification |
| `NEXT_PUBLIC_SUPABASE_URL` | public | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | Browser client, RLS enforced |
| `SUPABASE_SERVICE_ROLE_KEY` | server | Admin client, bypasses RLS |
| `ORS_API_KEY` | server | Routing |
| `MAPILLARY_TOKEN` | server | Street-level imagery |

Project conventions live in [CLAUDE.md](CLAUDE.md).
