# YieldScope mailserver (`yieldscope-mail`)

Self-hosted [docker-mailserver](https://docker-mailserver.github.io/docker-mailserver/) on engine for
`yieldscope.d3bu7.com` auth mail. Supabase GoTrue submits via ClusterIP (not IONOS SMTP).

| Item | Value |
|------|-------|
| Hostname | `mail.yieldscope.d3bu7.com` |
| Mailbox | `noreply@yieldscope.d3bu7.com` (SMTP for GoTrue) |
| E2E mailbox | `e2e@yieldscope.d3bu7.com` (plus-addressing: `e2e+tag@…` → same INBOX) |
| ClusterIP | `10.43.250.25` (fixed — used by GoTrue `hostAliases`) |
| Submission | `:587` STARTTLS (auth required; not an open relay) |
| NodePorts (LAN/test) | `30625` (25), `30687` (587), `30693` (993) |

## Deploy

```bash
export KUBECONFIG="$HOME/.kube/config-homelab"

# 1) DNS A for mail host + ACME cert on blackpearl, then:
bash deploy/scripts/k8s-yieldscope-mail-apply.sh

# 2) MX / SPF / DKIM / DMARC (IONOS API — keys from Obsevia .env.local):
pwsh deploy/scripts/setup-yieldscope-mail-dns.ps1

# 3) Point dedicated Supabase GoTrue at this mailserver:
bash deploy/scripts/setup-yieldscope-supabase-smtp.sh
```

## Retrieve mailbox password

```bash
kubectl -n yieldscope-mail get secret yieldscope-mail-mailbox \
  -o jsonpath='{.data.MAILBOX_PASSWORD}' | base64 -d; echo

# E2E inbox (Auth Playwright reads maildir via kubectl; IMAP optional)
kubectl -n yieldscope-mail get secret yieldscope-mail-e2e \
  -o jsonpath='{.data.MAILBOX_PASSWORD}' | base64 -d; echo
```

## Auth E2E (`pnpm test:e2e:auth`)

Uses `e2e+<stamp>@yieldscope.d3bu7.com`, waits for mail under
`/var/mail/yieldscope.d3bu7.com/e2e/new/`, asserts DKIM/`noreply@yieldscope.d3bu7.com`,
then exercises `/login` → `/app` and `/api/ledger`. Requires
`KUBECONFIG` (default `~/.kube/config-homelab`) and optional
`E2E_BASE_URL` / `E2E_SUPABASE_*`.

## Notes

- WAN TCP 25/587 on `77.23.124.82` currently DNATs toward **li-mail** NodePorts. Inbound MX for
  `yieldscope.d3bu7.com` therefore shares that path; **outbound** auth mail is sent directly from
  DMS on engine (port 25 egress to Gmail works). Noreply does not need inbound.
- Do not commit mailbox passwords or TLS private keys.
