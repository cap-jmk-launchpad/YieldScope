-- Materialize earn aggregates for fast ledger/dashboard reads.
--
-- Before: earn_aggregates_* / earn_daily_by_asset were plain views that
-- re-scanned earn_events on every SELECT (correct but slow for large ledgers).
--
-- After: same relation names are TABLES. Refresh is explicit:
--   refresh_earn_aggregates_for_profile(profile_id)
-- called AFTER persistSourceSync writes earn_events (replace / merge / upsert).
-- Full-profile recompute keeps merge windows and LUNC history crawls correct —
-- we never patch a window slice of aggregates in isolation.
--
-- Why tables (delete+upsert per profile) over REFRESH MATERIALIZED VIEW:
--   - one user's sync must not rewrite every tenant's rollups
--   - CONCURRENTLY still refreshes the whole matview
--   - scoped delete+insert is O(events for that profile)

drop view if exists public.earn_daily_by_asset;
drop view if exists public.earn_aggregates_by_source;
drop view if exists public.earn_aggregates_by_asset;

create table public.earn_aggregates_by_source (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  source text not null,
  event_count integer not null default 0,
  total_amount numeric not null default 0,
  last_earned_at timestamptz,
  last_as_of timestamptz,
  first_earned_at timestamptz,
  refreshed_at timestamptz not null default now(),
  primary key (profile_id, source)
);

create table public.earn_aggregates_by_asset (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  asset text not null,
  source text not null,
  event_count integer not null default 0,
  total_amount numeric not null default 0,
  last_earned_at timestamptz,
  refreshed_at timestamptz not null default now(),
  primary key (profile_id, asset, source)
);

create table public.earn_daily_by_asset (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  source text not null,
  asset text not null,
  day date not null,
  total_amount numeric not null default 0,
  event_count integer not null default 0,
  refreshed_at timestamptz not null default now(),
  primary key (profile_id, source, asset, day)
);

create index if not exists earn_agg_by_source_profile_idx
  on public.earn_aggregates_by_source (profile_id);

create index if not exists earn_agg_by_asset_profile_idx
  on public.earn_aggregates_by_asset (profile_id);

create index if not exists earn_daily_by_asset_profile_day_idx
  on public.earn_daily_by_asset (profile_id, day);

alter table public.earn_aggregates_by_source enable row level security;
alter table public.earn_aggregates_by_asset enable row level security;
alter table public.earn_daily_by_asset enable row level security;

drop policy if exists "earn_aggregates_by_source_own" on public.earn_aggregates_by_source;
create policy "earn_aggregates_by_source_own"
  on public.earn_aggregates_by_source for select
  using (
    profile_id in (select id from public.profiles where user_id = auth.uid())
  );

drop policy if exists "earn_aggregates_by_asset_own" on public.earn_aggregates_by_asset;
create policy "earn_aggregates_by_asset_own"
  on public.earn_aggregates_by_asset for select
  using (
    profile_id in (select id from public.profiles where user_id = auth.uid())
  );

drop policy if exists "earn_daily_by_asset_own" on public.earn_daily_by_asset;
create policy "earn_daily_by_asset_own"
  on public.earn_daily_by_asset for select
  using (
    profile_id in (select id from public.profiles where user_id = auth.uid())
  );

create or replace function public.refresh_earn_aggregates_for_profile(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_profile_id is null then
    raise exception 'refresh_earn_aggregates_for_profile: profile_id required';
  end if;

  delete from public.earn_aggregates_by_source where profile_id = p_profile_id;
  delete from public.earn_aggregates_by_asset where profile_id = p_profile_id;
  delete from public.earn_daily_by_asset where profile_id = p_profile_id;

  insert into public.earn_aggregates_by_source (
    profile_id, source, event_count, total_amount,
    last_earned_at, last_as_of, first_earned_at, refreshed_at
  )
  select
    profile_id,
    source,
    count(*)::integer,
    coalesce(sum(amount), 0),
    max(earned_at),
    max(as_of),
    min(earned_at),
    now()
  from public.earn_events
  where profile_id = p_profile_id
  group by profile_id, source;

  insert into public.earn_aggregates_by_asset (
    profile_id, asset, source, event_count, total_amount,
    last_earned_at, refreshed_at
  )
  select
    profile_id,
    asset,
    source,
    count(*)::integer,
    coalesce(sum(amount), 0),
    max(earned_at),
    now()
  from public.earn_events
  where profile_id = p_profile_id
  group by profile_id, asset, source;

  insert into public.earn_daily_by_asset (
    profile_id, source, asset, day, total_amount, event_count, refreshed_at
  )
  select
    profile_id,
    source,
    asset,
    ((earned_at at time zone 'utc')::date),
    coalesce(sum(amount), 0),
    count(*)::integer,
    now()
  from public.earn_events
  where profile_id = p_profile_id
  group by profile_id, source, asset, ((earned_at at time zone 'utc')::date);
end;
$$;

revoke all on function public.refresh_earn_aggregates_for_profile(uuid) from public;
grant execute on function public.refresh_earn_aggregates_for_profile(uuid) to service_role;

-- One-shot backfill so existing ledgers stay readable before the next sync.
do $$
declare
  r record;
begin
  for r in select id from public.profiles loop
    perform public.refresh_earn_aggregates_for_profile(r.id);
  end loop;
end $$;

grant select on public.earn_aggregates_by_source to authenticated;
grant select on public.earn_aggregates_by_source to service_role;
grant select on public.earn_aggregates_by_asset to authenticated;
grant select on public.earn_aggregates_by_asset to service_role;
grant select on public.earn_daily_by_asset to authenticated;
grant select on public.earn_daily_by_asset to service_role;

comment on table public.earn_aggregates_by_source is
  'Precomputed per-source rollups; refreshed by refresh_earn_aggregates_for_profile AFTER persist';
comment on table public.earn_aggregates_by_asset is
  'Precomputed per-asset rollups; refreshed by refresh_earn_aggregates_for_profile AFTER persist';
comment on table public.earn_daily_by_asset is
  'Precomputed UTC-day series for charts; refreshed by refresh_earn_aggregates_for_profile AFTER persist';
comment on function public.refresh_earn_aggregates_for_profile(uuid) is
  'Delete+reinsert aggregates for one profile from earn_events. Call after every persistSourceSync (replace/merge/upsert).';
