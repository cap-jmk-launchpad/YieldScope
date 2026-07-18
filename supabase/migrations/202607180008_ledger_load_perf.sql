-- Faster ledger load path: earliest-earned for coverage hints + daily series for charts.
-- Avoids shipping every earn_event row to the client on first paint.
--
-- Note: CREATE OR REPLACE VIEW cannot rename/reorder columns. Append first_earned_at
-- after existing columns, or DROP + CREATE.

create or replace view public.earn_aggregates_by_source as
select
  profile_id,
  source,
  count(*)::integer as event_count,
  sum(amount) as total_amount,
  max(earned_at) as last_earned_at,
  max(as_of) as last_as_of,
  min(earned_at) as first_earned_at
from public.earn_events
group by profile_id, source;

-- One row per (profile, source, asset, UTC day) — chart payloads stay small for 10k+ events.
create or replace view public.earn_daily_by_asset as
select
  profile_id,
  source,
  asset,
  ((earned_at at time zone 'utc')::date) as day,
  sum(amount) as total_amount,
  count(*)::integer as event_count
from public.earn_events
group by profile_id, source, asset, ((earned_at at time zone 'utc')::date);

grant select on public.earn_aggregates_by_source to authenticated;
grant select on public.earn_aggregates_by_source to service_role;
grant select on public.earn_daily_by_asset to authenticated;
grant select on public.earn_daily_by_asset to service_role;

comment on view public.earn_daily_by_asset is
  'UTC-day native totals per asset for deferred dashboard charts (load perf)';
comment on view public.earn_aggregates_by_source is
  'Per-source rollups including first_earned_at for CEX coverage hints';
