-- Garimpo · access control
-- Accounts live in Supabase Auth (email + password). Each account gets a
-- profile with its plan, status and the modules it may use, and every login,
-- app start, logout and module use is recorded in access_log.
--
-- Modules: downloads, converter, dj, qobuz.
-- Status: pending (waiting for approval), active, blocked.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text,
  plan text not null default 'free',
  status text not null default 'pending' check (status in ('pending', 'active', 'blocked')),
  modules text[] not null default array['downloads']::text[],
  expires_at timestamptz,
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.access_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  event text not null check (event in ('login', 'logout', 'app_open', 'module')),
  module text,
  app_version text,
  platform text,
  arch text,
  os_release text,
  created_at timestamptz not null default now()
);
create index if not exists access_log_user_time on public.access_log (user_id, created_at desc);

-- Plans as data, so the site can sell them later.
create table if not exists public.plans (
  id text primary key,
  name text not null,
  modules text[] not null,
  price_cents integer not null default 0,
  currency text not null default 'BRL',
  active boolean not null default true
);
insert into public.plans (id, name, modules, price_cents) values
  ('free', 'Garimpo', array['downloads'], 0),
  ('pro', 'Garimpo Pro', array['downloads', 'converter', 'qobuz'], 0),
  ('dj', 'Garimpo DJ', array['downloads', 'converter', 'qobuz', 'dj'], 0)
on conflict (id) do nothing;

-- New account -> profile (pending until an admin approves).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false)
$$;

-- Row level security: users read their own profile and write their own log
-- rows; admins read and manage everything. Users never change their own plan.
alter table public.profiles enable row level security;
alter table public.access_log enable row level security;
alter table public.plans enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for select using (id = auth.uid() or public.is_admin());
drop policy if exists "admin manages profiles" on public.profiles;
create policy "admin manages profiles" on public.profiles for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists "own log insert" on public.access_log;
create policy "own log insert" on public.access_log for insert with check (user_id = auth.uid());
drop policy if exists "admin reads log" on public.access_log;
create policy "admin reads log" on public.access_log for select using (public.is_admin() or user_id = auth.uid());

drop policy if exists "plans readable" on public.plans;
create policy "plans readable" on public.plans for select using (true);
drop policy if exists "admin manages plans" on public.plans;
create policy "admin manages plans" on public.plans for all using (public.is_admin()) with check (public.is_admin());

-- Handy view for the admin panel: last activity per user.
create or replace view public.admin_users with (security_invoker = true) as
select p.id, p.email, p.display_name, p.plan, p.status, p.modules, p.expires_at, p.created_at,
       (select max(created_at) from public.access_log l where l.user_id = p.id) as last_seen,
       (select count(*) from public.access_log l where l.user_id = p.id and l.created_at > now() - interval '30 days') as events_30d
from public.profiles p;
