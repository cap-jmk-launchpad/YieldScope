#!/usr/bin/env bash
# Deploy YieldScope docker-mailserver + mailbox secret + TLS secret.
# Prerequisites:
#   - kubectl + KUBECONFIG to homelab
#   - DNS A mail.yieldscope.d3bu7.com → edge WAN IP (or script will remind)
#   - On blackpearl: certbot webroot cert for mail.yieldscope.d3bu7.com (script can issue via ssh)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NS="yieldscope-mail"
MAIL_HOST="mail.yieldscope.d3bu7.com"
MAILBOX="noreply@yieldscope.d3bu7.com"
EDGE_HOST="${EDGE_HOST:-blackpearl}"
WEBROOT="${WEBROOT:-/var/lib/li-httpd}"
PASS_FILE="${YIELDSCOPE_MAIL_PASS_FILE:-${TMPDIR:-/tmp}/yieldscope-mail-pass.txt}"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "ERROR: missing $1" >&2
    exit 1
  }
}

require_cmd kubectl
require_cmd openssl
require_cmd ssh
require_cmd python3

echo "==> namespace + base manifests"
kubectl apply -k "$ROOT/deploy/k8s/yieldscope-mail/"

echo "==> ensure Let's Encrypt cert on $EDGE_HOST for $MAIL_HOST"
ssh -o BatchMode=yes "$EDGE_HOST" "sudo test -d /etc/letsencrypt/live/$MAIL_HOST" 2>/dev/null || {
  echo "Issuing cert via certbot webroot on $EDGE_HOST..."
  ssh -o BatchMode=yes "$EDGE_HOST" \
    "sudo certbot certonly --webroot -w '$WEBROOT' -d '$MAIL_HOST' --non-interactive --agree-tos -m admin@d3bu7.com"
}

echo "==> sync TLS secret yieldscope-mail-tls"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT
ssh -o BatchMode=yes "$EDGE_HOST" "sudo cat /etc/letsencrypt/live/$MAIL_HOST/fullchain.pem" >"$tmpdir/tls.crt"
ssh -o BatchMode=yes "$EDGE_HOST" "sudo cat /etc/letsencrypt/live/$MAIL_HOST/privkey.pem" >"$tmpdir/tls.key"
kubectl -n "$NS" create secret tls yieldscope-mail-tls \
  --cert="$tmpdir/tls.crt" --key="$tmpdir/tls.key" \
  --dry-run=client -o yaml | kubectl apply -f -

echo "==> mailbox password + accounts secret"
if [[ -f "$PASS_FILE" ]] && grep -q '^SMTP_PASS=' "$PASS_FILE"; then
  MAIL_PASS="$(grep '^SMTP_PASS=' "$PASS_FILE" | head -1 | cut -d= -f2- | tr -d '\r')"
  MAIL_HASH="$(grep '^SMTP_HASH=' "$PASS_FILE" | head -1 | cut -d= -f2- | tr -d '\r' || true)"
else
  MAIL_PASS="$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)"
  MAIL_HASH=""
fi

if [[ -z "${MAIL_HASH:-}" ]]; then
  # Prefer engine openssl (glibc crypt); fall back to python passlib if present
  MAIL_HASH="$(ssh -o BatchMode=yes engine "openssl passwd -6 '$MAIL_PASS'" | tr -d '\r')"
fi

# Preserve E2E mailbox password across rewrites of this file
EXISTING_E2E_PASS=""
if [[ -f "$PASS_FILE" ]] && grep -q '^E2E_SMTP_PASS=' "$PASS_FILE"; then
  EXISTING_E2E_PASS="$(grep '^E2E_SMTP_PASS=' "$PASS_FILE" | head -1 | cut -d= -f2- | tr -d '\r')"
fi

# Quote hash so $6$... is not expanded if file is ever sourced
{
  printf 'SMTP_PASS=%s\n' "$MAIL_PASS"
  printf 'SMTP_HASH=%s\n' "$MAIL_HASH"
} >"$PASS_FILE"
chmod 600 "$PASS_FILE" 2>/dev/null || true
echo "Mailbox password stored in $PASS_FILE (not committed)"

# Primary SMTP identity (GoTrue) + E2E catch mailbox (plus-addressing: e2e+tag@…)
E2E_MAILBOX="${E2E_MAILBOX:-e2e@yieldscope.d3bu7.com}"
if [[ -n "$EXISTING_E2E_PASS" ]]; then
  E2E_PASS="$EXISTING_E2E_PASS"
else
  E2E_PASS="$(openssl rand -base64 24 | tr -d '/+=' | head -c 28)"
fi
printf 'E2E_SMTP_PASS=%s\n' "$E2E_PASS" >>"$PASS_FILE"
E2E_HASH="$(ssh -o BatchMode=yes engine "openssl passwd -6 '$E2E_PASS'" | tr -d '\r')"

accounts_file="$tmpdir/postfix-accounts.cf"
{
  printf '%s\n' "${MAILBOX}|{SHA512-CRYPT}${MAIL_HASH}"
  printf '%s\n' "${E2E_MAILBOX}|{SHA512-CRYPT}${E2E_HASH}"
} >"$accounts_file"

kubectl -n "$NS" create secret generic yieldscope-mail-accounts \
  --from-file=postfix-accounts.cf="$accounts_file" \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl -n "$NS" create secret generic yieldscope-mail-mailbox \
  --from-literal=MAILBOX_ADDRESS="$MAILBOX" \
  --from-literal=MAILBOX_PASSWORD="$MAIL_PASS" \
  --from-literal=MAIL_HOSTNAME="$MAIL_HOST" \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl -n "$NS" create secret generic yieldscope-mail-e2e \
  --from-literal=MAILBOX_ADDRESS="$E2E_MAILBOX" \
  --from-literal=MAILBOX_PASSWORD="$E2E_PASS" \
  --dry-run=client -o yaml | kubectl apply -f -

echo "==> rollout mail"
kubectl -n "$NS" delete pod -l app=yieldscope-mail --ignore-not-found --wait=false 2>/dev/null || true
kubectl -n "$NS" rollout status statefulset/mail --timeout=300s || {
  echo "WARN: rollout not ready yet — check: kubectl -n $NS logs sts/mail -c mail" >&2
  kubectl -n "$NS" get pods -o wide
  exit 1
}

echo "==> wait readiness"
kubectl -n "$NS" wait --for=condition=ready pod -l app=yieldscope-mail --timeout=300s

echo "==> ensure DKIM keys for yieldscope.d3bu7.com"
kubectl -n "$NS" exec sts/mail -c mail -- setup config dkim domain yieldscope.d3bu7.com || true
kubectl -n "$NS" exec sts/mail -c mail -- sh -c '
  set -eu
  mkdir -p /etc/opendkim/keys/yieldscope.d3bu7.com
  cp -a /tmp/docker-mailserver/opendkim/KeyTable /tmp/docker-mailserver/opendkim/SigningTable /tmp/docker-mailserver/opendkim/TrustedHosts /etc/opendkim/ 2>/dev/null || true
  cp -a /tmp/docker-mailserver/opendkim/keys/yieldscope.d3bu7.com/. /etc/opendkim/keys/yieldscope.d3bu7.com/ 2>/dev/null || true
  chown -R opendkim:opendkim /etc/opendkim
  chmod 700 /etc/opendkim/keys /etc/opendkim/keys/yieldscope.d3bu7.com
  chmod 600 /etc/opendkim/keys/yieldscope.d3bu7.com/mail.private
  supervisorctl restart opendkim || true
'

echo "==> extract DKIM public key (if generated)"
DKIM_OUT="$ROOT/deploy/k8s/yieldscope-mail/dkim-public.txt"
if kubectl -n "$NS" exec sts/mail -c mail -- sh -c \
  'test -f /tmp/docker-mailserver/opendkim/keys/yieldscope.d3bu7.com/mail.txt && cat /tmp/docker-mailserver/opendkim/keys/yieldscope.d3bu7.com/mail.txt' \
  >"$DKIM_OUT" 2>/dev/null; then
  echo "DKIM TXT candidate written to $DKIM_OUT"
else
  kubectl -n "$NS" exec sts/mail -c mail -- sh -c 'find /tmp/docker-mailserver/opendkim -type f 2>/dev/null | head -40' || true
  echo "DKIM not ready yet - rerun extract after first mail start completes."
fi

echo ""
echo "OK: mailserver up"
echo "  Host:    $MAIL_HOST (ClusterIP 10.43.250.25)"
echo "  Mailbox: $MAILBOX"
echo "  Password: kubectl -n $NS get secret yieldscope-mail-mailbox -o jsonpath='{.data.MAILBOX_PASSWORD}' | base64 -d"
echo "Next: pwsh deploy/scripts/setup-yieldscope-mail-dns.ps1"
echo "Then: bash deploy/scripts/setup-yieldscope-supabase-smtp.sh"
