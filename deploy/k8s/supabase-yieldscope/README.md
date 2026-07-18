# YieldScope dedicated Supabase (`supabase-yieldscope`)

Self-hosted Supabase for YieldScope on blackpearl/engine — **not** Majico staging.

| Host | Backend |
|------|---------|
| `https://supabase.yieldscope.d3bu7.com` | Kong NodePort `30595` (API + Studio) |
| `https://yieldscope.d3bu7.com` | App (Site URL for Auth emails) |

Auth email links must use `/auth/v1/verify` (via `GOTRUE_MAILER_URLPATHS_*`). GoTrue’s default
`/verify` path hits Kong’s Studio catch-all (basic-auth) instead of GoTrue, so password-reset
and confirm-email links appear to “redirect to Supabase”.

**Password reset landing:** app `redirectTo` must be the path-only URL
`https://yieldscope.d3bu7.com/auth/reset-password` (not `/auth/callback?next=...`). After
`/auth/v1/verify`, GoTrue 302/303s there with either `?code=` (PKCE) or `#access_token=`
(implicit). `GOTRUE_SITE_URL` is the app host; `API_EXTERNAL_URL` is the Supabase API host.

Studio / dashboard is **basic-auth** via Kong (`DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` in the secret).

Auth SMTP is wired through GoTrue env (`GOTRUE_SMTP_*`) — no Studio UI click-through. Mailer uses the
self-hosted **yieldscope-mail** docker-mailserver (`noreply@yieldscope.d3bu7.com` via
`mail.yieldscope.d3bu7.com:587`). See `deploy/k8s/yieldscope-mail/README.md`.

### Auth email branding (code-managed, not Studio)

GoTrue loads HTML templates from the in-cluster `auth-mail-templates` Service (nginx + ConfigMap).
Subjects and template URLs live in `configmap.yaml`; bodies are files under `email-templates/`.

| Flow | Template file | Subject env |
|------|---------------|-------------|
| Signup confirm | `confirmation.html` | `GOTRUE_MAILER_SUBJECTS_CONFIRMATION` |
| Password reset | `recovery.html` | `GOTRUE_MAILER_SUBJECTS_RECOVERY` |
| Magic link | `magic_link.html` | `GOTRUE_MAILER_SUBJECTS_MAGIC_LINK` |
| Email change | `email_change.html` | `GOTRUE_MAILER_SUBJECTS_EMAIL_CHANGE` |
| Invite | `invite.html` | `GOTRUE_MAILER_SUBJECTS_INVITE` |

To change branding later: edit the HTML under `email-templates/`, adjust subjects in `configmap.yaml` if needed, then
`kubectl apply -k deploy/k8s/supabase-yieldscope/` and restart `auth` so GoTrue refreshes its template cache
(`kubectl -n supabase-yieldscope rollout restart deploy/auth`). Do **not** edit templates in Studio — they are
ignored when `GOTRUE_MAILER_TEMPLATES_*` is set.

The auth Deployment pins `hostAliases` for `db` and `mail.yieldscope.d3bu7.com` to their ClusterIPs so
GoTrue is not blocked by intermittent CoreDNS UDP timeouts (engine → deck). If the `db` Service is
recreated and gets a new ClusterIP, update `auth-deployment.yaml` and re-apply.

## Schema migrations

SQL lives in `migrations/` (mirrored under `supabase/migrations/`). The migrate Job
(`migrate-job.yaml`) applies each `*.sql` once, tracked in `public.schema_migrations`.

```bash
export KUBECONFIG="$HOME/.kube/config-homelab"
# Re-apply kustomize so the migrations ConfigMap picks up new files, then run the Job:
bash deploy/scripts/k8s-yieldscope-supabase-apply.sh
kubectl -n supabase-yieldscope delete job yieldscope-supabase-migrate --ignore-not-found
kubectl -n supabase-yieldscope apply -f deploy/k8s/supabase-yieldscope/migrate-job.yaml
kubectl -n supabase-yieldscope wait --for=condition=complete job/yieldscope-supabase-migrate --timeout=120s
```

Index inventory (hot paths):

| Index | Serves |
|-------|--------|
| `earn_events_profile_earned_idx` | `loadDbLedger` paginated `.range()` by `earned_at DESC` |
| `earn_events_profile_source_earned_idx` | merge-window delete + `getSourceHighWaterMs` |
| `earn_events_profile_source_asset_idx` | aggregate views `GROUP BY` |
| `ohlcv_symbol_interval_source_time_desc` | latest / as-of / max open_time with `source` |
| `sync_runs_profile_started_idx` / `…_source_started_idx` | sync history |
| `wallet_connections_profile_idx` | latest wallet |
| `source_credentials` UNIQUE `(profile_id, source)` | credential load/save |
| `profiles_user_id_idx` | `ensureProfileId` |

## Deploy

```bash
export KUBECONFIG="$HOME/.kube/config-homelab"
bash deploy/scripts/k8s-yieldscope-supabase-secret.sh
bash deploy/scripts/k8s-yieldscope-supabase-apply.sh

# Mailserver + mailbox + LE TLS, then DNS + GoTrue SMTP:
bash deploy/scripts/k8s-yieldscope-mail-apply.sh
pwsh deploy/scripts/setup-yieldscope-mail-dns.ps1
bash deploy/scripts/setup-yieldscope-supabase-smtp.sh
```

DNS (IONOS API) + edge nginx:

```powershell
.\deploy\scripts\setup-yieldscope-dns.ps1
.\deploy\scripts\setup-yieldscope-mail-dns.ps1
# on blackpearl:
sudo bash deploy/edge/apply-yieldscope-supabase-edge.sh
```

## Retrieve Studio password

```bash
kubectl -n supabase-yieldscope get secret yieldscope-supabase-secrets \
  -o jsonpath='{.data.DASHBOARD_USERNAME}' | base64 -d; echo
kubectl -n supabase-yieldscope get secret yieldscope-supabase-secrets \
  -o jsonpath='{.data.DASHBOARD_PASSWORD}' | base64 -d; echo
```

App keys for YieldScope:

```bash
kubectl -n supabase-yieldscope get secret yieldscope-supabase-secrets \
  -o jsonpath='{.data.ANON_KEY}' | base64 -d; echo
kubectl -n supabase-yieldscope get secret yieldscope-supabase-secrets \
  -o jsonpath='{.data.SERVICE_ROLE_KEY}' | base64 -d; echo
```

## Asset logos (Supabase Storage)

Currency / asset logos are **not** in git. They live in a public Storage bucket:

| | |
|--|--|
| Bucket | `asset-logos` |
| Object path | `{slug}.svg` (lowercase ticker or alias: `btc.svg`, `eth.svg`, `mon.svg`, `lunc.svg`, …) |
| Public URL | `https://supabase.yieldscope.d3bu7.com/storage/v1/object/public/asset-logos/{slug}.svg` |

Requires the `storage` Deployment (`storage-deployment.yaml`) and Kong `/storage/v1/` route.
Secret key `STORAGE_DATABASE_URL` (`postgres://supabase_storage_admin:…@db:5432/postgres`) is
created by `k8s-yieldscope-supabase-secret.sh`.

Seed / refresh icons (fetches from cryptocurrency-icons CDN once; generates MON/LUNC/USTC):

```bash
export KUBECONFIG="$HOME/.kube/config-homelab"
bash deploy/scripts/upload-asset-logos.sh
```

The web app resolves logos via `web/src/lib/asset-icon.ts` (`AssetIcon` / `CurrencyLogo` /
`CurrencyCell`) and falls back to initials if an object is missing.
