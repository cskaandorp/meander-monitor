-- CI-ONLY bootstrap. NOT applied in dev or prod.
--
-- Emulates the slice of the Supabase-managed environment that the
-- supabase/postgres image + GoTrue + storage-api provide in a real deployment,
-- so `migrate.sh` can replay EVERY migration from an empty Postgres and prove
-- the set applies cleanly (the migrations-check CI job).
--
-- Keep in sync when a migration starts depending on a NEW Supabase-provided
-- primitive. Today the migrations lean on exactly what's below:
--   * the standard API roles (anon / authenticated / service_role / authenticator)
--   * the `auth` schema + auth.uid()/role()/jwt()
--   * an `extensions` schema
--   * the `storage` schema with buckets + objects (the `web` bucket migration
--     inserts a bucket row and creates RLS policies on storage.objects)
--
-- Not here, deliberately: pgvector (unused) and the `supabase_realtime`
-- publication (nothing subscribes yet — add it back with the worker layer).

-- ── Roles ─────────────────────────────────────────────────────────────────
create role anon                nologin noinherit;
create role authenticated       nologin noinherit;
create role service_role        nologin noinherit bypassrls;
create role authenticator       noinherit login password 'postgres';
create role supabase_auth_admin noinherit login password 'postgres' createrole createdb;
grant anon, authenticated, service_role to authenticator;

-- ── Schemas ───────────────────────────────────────────────────────────────
create schema if not exists extensions;
create schema if not exists auth authorization supabase_auth_admin;
grant usage on schema auth   to postgres, anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

-- ── GoTrue-provided objects (auth.users + the JWT helpers RLS policies call)
create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text,
  raw_user_meta_data jsonb,
  created_at         timestamptz not null default now()
);
create or replace function auth.uid()  returns uuid  language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.role() returns text  language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
create or replace function auth.jwt()  returns jsonb language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;

-- ── storage-api-provided objects ──────────────────────────────────────────
-- A reduced storage.buckets/objects: only the columns our migrations touch,
-- plus RLS on objects so `create policy ... on storage.objects` applies. The
-- real storage-api owns far more (path_tokens, versions, triggers); this is
-- only enough to prove the bucket migration is replayable.
create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;

create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  owner              uuid,
  public             boolean default false,
  avif_autodetection boolean default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

create table if not exists storage.objects (
  id             uuid primary key default gen_random_uuid(),
  bucket_id      text references storage.buckets(id),
  name           text,
  owner          uuid,
  metadata       jsonb,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now(),
  last_accessed_at timestamptz default now()
);

alter table storage.objects enable row level security;
