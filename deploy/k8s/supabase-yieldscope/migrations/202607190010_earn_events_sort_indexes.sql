-- Indexes for server-side earn_events sort (dashboard table: amount / asset / source).
-- earned_at DESC already covered by earn_events_profile_earned_idx.
-- source + earned_at covered by earn_events_profile_source_earned_idx.

create index if not exists earn_events_profile_amount_earned_idx
  on public.earn_events (profile_id, amount desc, earned_at desc);

create index if not exists earn_events_profile_asset_earned_idx
  on public.earn_events (profile_id, asset, earned_at desc);

comment on index public.earn_events_profile_amount_earned_idx is
  'Paged ledger ORDER BY amount (with earned_at tiebreak)';
comment on index public.earn_events_profile_asset_earned_idx is
  'Paged ledger ORDER BY asset (with earned_at tiebreak)';
