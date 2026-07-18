-- Query-plan indexes aligned to YieldScope hot paths (ledger load, merge sync, OHLCV).
-- Safe to re-run: IF NOT EXISTS / DROP IF EXISTS.

-- OHLCV latest / cursor / as-of queries always filter source='binance'.
-- Replace (symbol, interval, open_time) with (symbol, interval, source, open_time)
-- so equality on source is index-covered before the DESC time walk.
drop index if exists public.ohlcv_symbol_interval_time_desc;
create index if not exists ohlcv_symbol_interval_source_time_desc
  on public.ohlcv (symbol, interval, source, open_time desc);

-- Per-source sync history (audit / future "last run for source" lookups).
-- Keep sync_runs_profile_started_idx for profile-wide ORDER BY started_at.
create index if not exists sync_runs_profile_source_started_idx
  on public.sync_runs (profile_id, source, started_at desc);

-- source_credentials UNIQUE (profile_id, source) already covers
--   eq(profile_id) and eq(profile_id)+eq(source) lookups.
-- earn_events already has:
--   (profile_id, earned_at desc)              -- loadDbLedger .range() pages
--   (profile_id, source, earned_at desc)      -- merge delete window + high-water
--   (profile_id, source, asset)               -- aggregate views GROUP BY
-- wallet_connections (profile_id, last_seen_at desc) — credentials + ledger wallet
-- profiles (user_id) — ensureProfileId

comment on index public.ohlcv_symbol_interval_source_time_desc is
  'loadLatestCloses / loadCloseAtOrBefore / loadMaxOpenTime: symbol+interval+source then open_time DESC';
comment on index public.sync_runs_profile_source_started_idx is
  'Per-source sync_runs history ordered by started_at DESC';

grant select on public.ohlcv_latest to authenticated;
grant select on public.ohlcv_latest to service_role;
