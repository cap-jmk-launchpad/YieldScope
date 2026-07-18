-- Encrypted CEX / LUNC connection credentials (server-side only via service role)

create table if not exists public.source_credentials (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  source text not null check (source in ('binance', 'okx', 'lunc_stake')),
  ciphertext text not null,
  key_hint text,
  updated_at timestamptz not null default now(),
  unique (profile_id, source)
);

create index if not exists source_credentials_profile_idx
  on public.source_credentials (profile_id);

alter table public.source_credentials enable row level security;

-- No policies for authenticated/anon: only service_role (bypasses RLS) may read/write secrets.
drop policy if exists "source_credentials_deny_all" on public.source_credentials;
