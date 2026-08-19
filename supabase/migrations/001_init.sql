-- 001_init.sql
-- NavigAble initial schema: accessibility obstacle reports.
--
-- Run this in the Supabase SQL editor. It is idempotent enough to re-run on a
-- fresh project, but it is not a down migration: dropping the enums or the
-- table is a manual step.

-- PostGIS. Supabase installs extensions into the "extensions" schema. If a
-- project already has PostGIS in "public", the IF NOT EXISTS short-circuits and
-- the schema clause is ignored, so both layouts work. Putting both schemas on
-- the search path lets the geography type and the ST_ functions resolve
-- unqualified below, including inside the generated column expression.
create schema if not exists extensions;
create extension if not exists postgis with schema extensions;
set search_path = public, extensions;

-- Enums ---------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'permanence_t') then
    create type permanence_t as enum ('permanent', 'temporary');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'report_source_t') then
    create type report_source_t as enum ('user', 'mapillary');
  end if;
end $$;

-- Table ---------------------------------------------------------------------

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),

  -- Location. lat/lng are the source of truth; geom is derived.
  lat double precision not null,
  lng double precision not null,
  heading double precision,

  photo_url text not null,
  source report_source_t not null default 'user',

  obstacle_types text[] not null default '{}',

  -- Per-profile severity. 0 = no impact, 1 = minor inconvenience,
  -- 2 = difficult and possibly unsafe, 3 = impassable.
  sev_wheelchair smallint not null default 0,
  sev_blind smallint not null default 0,
  sev_low_vision smallint not null default 0,
  sev_walker smallint not null default 0,

  permanence permanence_t not null default 'permanent',

  ai_description text,
  ai_confidence real,

  confirmations int not null default 0,
  disputes int not null default 0,

  reporter_id text,

  created_at timestamptz not null default now(),
  expires_at timestamptz,

  geom geography(Point, 4326) generated always as (
    ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
  ) stored,

  constraint reports_sev_wheelchair_range check (sev_wheelchair between 0 and 3),
  constraint reports_sev_blind_range check (sev_blind between 0 and 3),
  constraint reports_sev_low_vision_range check (sev_low_vision between 0 and 3),
  constraint reports_sev_walker_range check (sev_walker between 0 and 3)
);

-- Indexes -------------------------------------------------------------------

-- Radius and viewport queries against geom.
create index if not exists reports_geom_idx
  on public.reports using gist (geom);

-- Expiry sweeps and the "still live" filter in the read policy.
create index if not exists reports_expires_at_idx
  on public.reports (expires_at);

-- Row level security --------------------------------------------------------

alter table public.reports enable row level security;

-- Anyone may read reports that have not expired. There is deliberately no
-- insert, update, or delete policy: the service role bypasses RLS, so writes
-- are only possible through a server-side client holding
-- SUPABASE_SERVICE_ROLE_KEY.
drop policy if exists reports_public_read on public.reports;
create policy reports_public_read
  on public.reports
  for select
  to anon, authenticated
  using (expires_at is null or expires_at > now());

-- Belt and braces: strip the default table grants from the browser-facing
-- roles so a future permissive policy cannot accidentally open up writes.
revoke insert, update, delete, truncate on public.reports from anon, authenticated;
grant select on public.reports to anon, authenticated;
