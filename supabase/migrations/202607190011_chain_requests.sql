-- User-submitted requests for chains / networks beyond Phase 1.
-- Writes go through the app service role (admin client); RLS stays fail-closed.

create table if not exists public.chain_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  chain_name text not null,
  why text,
  contact_email text,
  created_at timestamptz not null default now(),
  constraint chain_requests_chain_name_len check (
    char_length(trim(chain_name)) between 1 and 120
  ),
  constraint chain_requests_why_len check (
    why is null or char_length(why) <= 1000
  ),
  constraint chain_requests_email_len check (
    contact_email is null or char_length(contact_email) <= 320
  )
);

create index if not exists chain_requests_user_created_idx
  on public.chain_requests (user_id, created_at desc);

create index if not exists chain_requests_created_idx
  on public.chain_requests (created_at desc);

alter table public.chain_requests enable row level security;

-- No anon/authenticated policies: only service_role (bypasses RLS) may read/write.
drop policy if exists "chain_requests_deny_all" on public.chain_requests;
