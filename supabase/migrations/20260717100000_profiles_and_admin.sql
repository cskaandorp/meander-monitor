-- An admin role.
--
-- Until now "authenticated" meant "admin" — fine while the only accounts were
-- ours. Volunteers are about to get accounts so they can upload, and they must
-- not inherit CMS rights. This adds the distinction; the next migration applies
-- it to the CMS policies.
--
-- Every auth.users row gets a profile via trigger, defaulting to is_admin=false.
-- Existing accounts are backfilled as admins — right now that's only us.

create table profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  is_admin   boolean not null default false,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

/*
 * SECURITY DEFINER so this reads profiles with RLS bypassed. That is what stops
 * the policies below from recursing: "read profiles" would otherwise call
 * is_admin(), which reads profiles, which calls is_admin()...
 * search_path is pinned because SECURITY DEFINER runs as the owner.
 */
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false)
$$;

create policy "Users can read their own profile"
  on profiles for select
  to authenticated
  using (id = auth.uid() or public.is_admin());

create policy "Admins can manage profiles"
  on profiles for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Keep profiles in step with auth.users. GoTrue writes to auth.users directly,
-- so a trigger is the only way to catch every account (including admin-created
-- ones, which never touch our app code).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill: everyone who already has an account is an admin (that's us).
insert into profiles (id, email, is_admin)
select id, email, true from auth.users
on conflict (id) do update set is_admin = true;
