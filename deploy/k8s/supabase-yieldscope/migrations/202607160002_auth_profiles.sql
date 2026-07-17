-- Link profiles to Supabase Auth users; keep wallet_address optional

alter table public.profiles
  add column if not exists user_id uuid unique references auth.users(id) on delete cascade;

alter table public.profiles
  add column if not exists email text;

create index if not exists profiles_user_id_idx on public.profiles (user_id);

-- Auto-create a profile row when a user signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, email)
  values (new.id, new.email)
  on conflict (user_id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- RLS: users only see their own profile / ledger rows
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = user_id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = user_id);

drop policy if exists "earn_events_select_own" on public.earn_events;
create policy "earn_events_select_own"
  on public.earn_events for select
  using (
    profile_id in (select id from public.profiles where user_id = auth.uid())
  );

drop policy if exists "earn_events_insert_own" on public.earn_events;
create policy "earn_events_insert_own"
  on public.earn_events for insert
  with check (
    profile_id in (select id from public.profiles where user_id = auth.uid())
  );

drop policy if exists "source_connections_select_own" on public.source_connections;
create policy "source_connections_select_own"
  on public.source_connections for select
  using (
    profile_id in (select id from public.profiles where user_id = auth.uid())
  );

drop policy if exists "source_connections_upsert_own" on public.source_connections;
create policy "source_connections_upsert_own"
  on public.source_connections for all
  using (
    profile_id in (select id from public.profiles where user_id = auth.uid())
  )
  with check (
    profile_id in (select id from public.profiles where user_id = auth.uid())
  );

drop policy if exists "checkpoints_select_own" on public.checkpoints;
create policy "checkpoints_select_own"
  on public.checkpoints for select
  using (
    profile_id in (select id from public.profiles where user_id = auth.uid())
  );

drop policy if exists "checkpoints_insert_own" on public.checkpoints;
create policy "checkpoints_insert_own"
  on public.checkpoints for insert
  with check (
    profile_id in (select id from public.profiles where user_id = auth.uid())
  );
