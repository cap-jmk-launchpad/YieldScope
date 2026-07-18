-- Clear fixture-leaked Monad (and optional other) earn rows for a user who
-- never connected that source. Run against YieldScope Supabase Postgres.
--
-- Example (from blackpearl / postgres pod):
--   psql "$DATABASE_URL" -v email='julian.m.kleber@gmail.com' -f cleanup-fixture-leak.sql
--
-- Or substitute the email below and run in Studio SQL editor.

\set email 'julian.m.kleber@gmail.com'

WITH target AS (
  SELECT id AS profile_id
  FROM profiles
  WHERE lower(email) = lower(:'email')
)
, deleted_events AS (
  DELETE FROM earn_events e
  USING target t
  WHERE e.profile_id = t.profile_id
    AND e.source = 'monad_stake'
  RETURNING e.id
)
, reset_conn AS (
  UPDATE source_connections sc
  SET status = 'not_connected',
      last_error = 'Wallet not connected',
      last_synced_at = now()
  FROM target t
  WHERE sc.profile_id = t.profile_id
    AND sc.source = 'monad_stake'
  RETURNING sc.source
)
, deleted_wallets AS (
  -- Only remove wallets that match the fixture demo address pattern if present.
  -- Safe no-op when the user never had a real wallet saved via Connect.
  DELETE FROM wallet_connections w
  USING target t
  WHERE w.profile_id = t.profile_id
    AND (
      lower(w.address) = '0x1111111111111111111111111111111111111111'
      OR lower(w.address) LIKE '0x000000000000000000000000000000000000%'
    )
  RETURNING w.address
)
SELECT
  (SELECT count(*) FROM deleted_events) AS events_removed,
  (SELECT count(*) FROM reset_conn) AS connections_reset,
  (SELECT count(*) FROM deleted_wallets) AS demo_wallets_removed;
