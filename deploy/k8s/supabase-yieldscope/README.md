# YieldScope dedicated Supabase (`supabase-yieldscope`)

Self-hosted Supabase for YieldScope on blackpearl/engine — **not** Majico staging.

| Host | Backend |
|------|---------|
| `https://supabase.yieldscope.d3bu7.com` | Kong NodePort `30595` (API + Studio) |
| `https://yieldscope.d3bu7.com` | App (Site URL for Auth emails) |

Studio / dashboard is **basic-auth** via Kong (`DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` in the secret).

Auth SMTP is wired through GoTrue env (`GOTRUE_SMTP_*`) — no Studio UI click-through. Mailer uses IONOS SMTP (`smtp.ionos.de`); From address is the authenticated IONOS mailbox (currently `no-reply@majico.xyz`).

## Deploy

```bash
export KUBECONFIG="$HOME/.kube/config-homelab"
# Load IONOS SMTP from majico .env.local (EMAIL_*), then:
bash deploy/scripts/k8s-yieldscope-supabase-secret.sh
bash deploy/scripts/setup-yieldscope-supabase-smtp.sh
bash deploy/scripts/k8s-yieldscope-supabase-apply.sh
```

DNS (IONOS API) + edge nginx:

```powershell
.\deploy\scripts\setup-yieldscope-dns.ps1
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
