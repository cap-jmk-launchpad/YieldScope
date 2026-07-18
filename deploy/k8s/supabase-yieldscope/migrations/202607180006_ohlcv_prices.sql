-- OHLCV price store for display-currency conversion + charts
-- Source: Binance public market data (no API key)
-- Intervals: 1m (kept current by CronJob) and 1d (backfill for yearly charts)

create table if not exists public.ohlcv (
  symbol text not null,
  interval text not null check (interval in ('1m', '1d')),
  open_time timestamptz not null,
  open numeric not null,
  high numeric not null,
  low numeric not null,
  close numeric not null,
  volume numeric not null default 0,
  source text not null default 'binance',
  ingested_at timestamptz not null default now(),
  primary key (symbol, interval, open_time, source)
);

create index if not exists ohlcv_symbol_interval_time_desc
  on public.ohlcv (symbol, interval, open_time desc);

comment on table public.ohlcv is
  'Binance klines persisted for YieldScope display FX (USD/EUR/BTC/ETH). Quote is USDT (~USD).';

-- Latest close per symbol+interval (convenience for conversion)
create or replace view public.ohlcv_latest as
select distinct on (symbol, interval, source)
  symbol,
  interval,
  open_time,
  close,
  source,
  ingested_at
from public.ohlcv
order by symbol, interval, source, open_time desc;

alter table public.ohlcv enable row level security;

-- Public read of prices is fine (market data); writes only via service_role.
drop policy if exists "ohlcv_select_authenticated" on public.ohlcv;
create policy "ohlcv_select_authenticated"
  on public.ohlcv for select
  to authenticated
  using (true);
