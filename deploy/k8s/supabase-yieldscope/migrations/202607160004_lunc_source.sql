-- Allow lunc_stake as a Phase-1 earn source

alter table public.source_connections
  drop constraint if exists source_connections_source_check;
alter table public.source_connections
  add constraint source_connections_source_check
  check (source in ('binance', 'okx', 'monad_stake', 'lunc_stake'));

alter table public.earn_events
  drop constraint if exists earn_events_source_check;
alter table public.earn_events
  add constraint earn_events_source_check
  check (source in ('binance', 'okx', 'monad_stake', 'lunc_stake'));

alter table public.sync_runs
  drop constraint if exists sync_runs_source_check;
alter table public.sync_runs
  add constraint sync_runs_source_check
  check (source in ('binance', 'okx', 'monad_stake', 'lunc_stake', 'all'));

-- Optional LUNC address on profile for paste-wallet flow
alter table public.profiles
  add column if not exists lunc_address text;

create index if not exists profiles_lunc_address_idx
  on public.profiles (lunc_address)
  where lunc_address is not null;
