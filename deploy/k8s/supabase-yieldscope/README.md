# YieldScope dedicated Supabase (`supabase-yieldscope`)

Self-hosted Supabase for YieldScope on blackpearl/engine — **not** Majico staging.

| Host | Backend |
|------|---------|
| `https://supabase.yieldscope.d3bu7.com` | Kong NodePort `30595` (API + Studio) |
| `https://yieldscope.d3bu7.com` | App (Site URL for Auth emails) |

Auth email links must use `/auth/v1/verify` (via `GOTRUE_MAILER_URLPATHS_*`). GoTrue’s default
`/verify` path hits Kong’s Studio catch-all (basic-auth) instead of GoTrue, so password-reset
and confirm-email links appear to “redirect to Supabase”.

Studio / dashboard is **basic-auth** via Kong (`DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` in the secret).

Auth SMTP is wired through GoTrue env (`GOTRUE_SMTP_*`) — no Studio UI click-through. Mailer uses the
self-hosted **yieldscope-mail** docker-mailserver (`noreply@yieldscope.d3bu7.com` via
`mail.yieldscope.d3bu7.com:587`). See `deploy/k8s/yieldscope-mail/README.md`.

The auth Deployment pins `hostAliases` for `db` and `mail.yieldscope.d3bu7.com` to their ClusterIPs so
GoTrue is not blocked by intermittent CoreDNS UDP timeouts (engine → deck). If the `db` Service is
recreated and gets a new ClusterIP, update `auth-deployment.yaml` and re-apply.

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
