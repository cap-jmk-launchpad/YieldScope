-- YieldScope earn ledger (Supabase / Postgres)
-- Target: blackpearl engine cluster

create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  wallet_address text unique,
  created_at timestamptz not null default now()
);

create table if not exists public.source_connections (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  source text not null check (source in ('binance', 'okx', 'monad_stake')),
  status text not null check (status in ('ok', 'error', 'not_connected')),
  last_error text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  unique (profile_id, source)
);

create table if not exists public.earn_events (
  id text primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  source text not null check (source in ('binance', 'okx', 'monad_stake')),
  asset text not null,
  amount numeric not null,
  earned_at timestamptz not null,
  raw_type text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists earn_events_profile_earned_idx
  on public.earn_events (profile_id, earned_at desc);

create table if not exists public.checkpoints (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  subject_address text not null,
  sequence bigint not null,
  root bytea not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  tx_hash text,
  chain_id integer not null default 10143,
  created_at timestamptz not null default now(),
  unique (subject_address, sequence, chain_id)
);

alter table public.earn_events enable row level security;
alter table public.source_connections enable row level security;
alter table public.checkpoints enable row level security;
alter table public.profiles enable row level security;
