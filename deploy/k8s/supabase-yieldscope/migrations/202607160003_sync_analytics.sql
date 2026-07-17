-- Analytics-ready earn ledger: wallet connections, sync runs, aggregation indexes

create table if not exists public.wallet_connections (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  address text not null,
  chain_id integer not null default 10143,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (profile_id, address, chain_id)
);

create table if not exists public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  source text not null check (source in ('binance', 'okx', 'monad_stake', 'all')),
  status text not null check (status in ('ok', 'error', 'not_connected', 'partial')),
  event_count integer not null default 0,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  meta jsonb not null default '{}'::jsonb
);

-- Point-in-time of the sync that wrote the row (for analytics windows)
alter table public.earn_events
  add column if not exists as_of timestamptz not null default now();

create index if not exists earn_events_profile_source_asset_idx
  on public.earn_events (profile_id, source, asset);

create index if not exists earn_events_profile_as_of_idx
  on public.earn_events (profile_id, as_of desc);

create index if not exists earn_events_profile_source_earned_idx
  on public.earn_events (profile_id, source, earned_at desc);

create index if not exists sync_runs_profile_started_idx
  on public.sync_runs (profile_id, started_at desc);

create index if not exists wallet_connections_profile_idx
  on public.wallet_connections (profile_id, last_seen_at desc);

alter table public.wallet_connections enable row level security;
alter table public.sync_runs enable row level security;

drop policy if exists "wallet_connections_own" on public.wallet_connections;
create policy "wallet_connections_own"
  on public.wallet_connections for all
  using (
    profile_id in (select id from public.profiles where user_id = auth.uid())
  )
  with check (
    profile_id in (select id from public.profiles where user_id = auth.uid())
  );

drop policy if exists "sync_runs_own" on public.sync_runs;
create policy "sync_runs_own"
  on public.sync_runs for all
  using (
    profile_id in (select id from public.profiles where user_id = auth.uid())
  )
  with check (
    profile_id in (select id from public.profiles where user_id = auth.uid())
  );

-- Allow owners to replace source event sets
drop policy if exists "earn_events_update_own" on public.earn_events;
create policy "earn_events_update_own"
  on public.earn_events for update
  using (
    profile_id in (select id from public.profiles where user_id = auth.uid())
  );

drop policy if exists "earn_events_delete_own" on public.earn_events;
create policy "earn_events_delete_own"
  on public.earn_events for delete
  using (
    profile_id in (select id from public.profiles where user_id = auth.uid())
  );

-- Fast aggregations: sum by source / asset for a profile
create or replace view public.earn_aggregates_by_source as
select
  profile_id,
  source,
  count(*)::integer as event_count,
  sum(amount) as total_amount,
  max(earned_at) as last_earned_at,
  max(as_of) as last_as_of
from public.earn_events
group by profile_id, source;

create or replace view public.earn_aggregates_by_asset as
select
  profile_id,
  asset,
  source,
  count(*)::integer as event_count,
  sum(amount) as total_amount,
  max(earned_at) as last_earned_at
from public.earn_events
group by profile_id, asset, source;

grant select on public.earn_aggregates_by_source to authenticated;
grant select on public.earn_aggregates_by_asset to authenticated;
