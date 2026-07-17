#!/usr/bin/env bash
# Point YieldScope GoTrue SMTP at self-hosted yieldscope-mail (noreply@yieldscope.d3bu7.com).
# Falls back to env / majico IONOS only if USE_IONOS_SMTP=1.
set -euo pipefail

NS="supabase-yieldscope"
SECRET="yieldscope-supabase-secrets"
MAIL_NS="${MAIL_NS:-yieldscope-mail}"
MAIL_HOST="${MAIL_HOST:-mail.yieldscope.d3bu7.com}"
MAIL_PORT="${MAIL_PORT:-587}"

load_env_file() {
  local f="$1"
  [[ -f "$f" ]] || return 0
  local tmp
  tmp="$(mktemp)"
  sed '1s/^\xEF\xBB\xBF//; s/\r$//' "$f" >"$tmp"
  set -a
  # shellcheck disable=SC1090
  source "$tmp"
  set +a
  rm -f "$tmp"
}

if [[ "${USE_IONOS_SMTP:-0}" == "1" ]]; then
  echo "[smtp] USE_IONOS_SMTP=1 — loading majico/IONOS credentials"
  if [[ -z "${SMTP_HOST:-${EMAIL_HOST:-}}" || -z "${SMTP_PASS:-${EMAIL_PASS:-}}" ]]; then
    for candidate in \
      "${MAJICO_ENV_FILE:-}" \
      "$HOME/Documents/Programming/majico/majico.xyz/.env.local" \
      "/mnt/c/Users/Julian/Documents/Programming/majico/majico.xyz/.env.local"; do
      [[ -n "$candidate" && -f "$candidate" ]] || continue
      echo "[smtp] loading $candidate"
      load_env_file "$candidate"
      break
    done
  fi
  SMTP_HOST="${SMTP_HOST:-${EMAIL_HOST:-}}"
  SMTP_PORT="${SMTP_PORT:-${EMAIL_PORT:-465}}"
  SMTP_USER="${SMTP_USER:-${EMAIL_USER:-}}"
  SMTP_PASS="${SMTP_PASS:-${EMAIL_PASS:-}}"
  SMTP_ADMIN_EMAIL="${SMTP_ADMIN_EMAIL:-${SMTP_USER}}"
else
  echo "[smtp] loading mailbox from $MAIL_NS/yieldscope-mail-mailbox"
  kubectl -n "$MAIL_NS" get secret yieldscope-mail-mailbox >/dev/null
  SMTP_HOST="$MAIL_HOST"
  SMTP_PORT="$MAIL_PORT"
  SMTP_USER="$(kubectl -n "$MAIL_NS" get secret yieldscope-mail-mailbox -o jsonpath='{.data.MAILBOX_ADDRESS}' | base64 -d)"
  SMTP_PASS="$(kubectl -n "$MAIL_NS" get secret yieldscope-mail-mailbox -o jsonpath='{.data.MAILBOX_PASSWORD}' | base64 -d)"
  SMTP_ADMIN_EMAIL="$SMTP_USER"
fi

missing=0
for var in SMTP_HOST SMTP_USER SMTP_PASS; do
  if [[ -z "${!var:-}" ]]; then
    echo "Missing required env: $var" >&2
    missing=1
  fi
done
[[ "$missing" -eq 0 ]] || exit 1

kubectl -n "$NS" get secret "$SECRET" >/dev/null

patch_json="$(
  SMTP_HOST="$SMTP_HOST" SMTP_PORT="$SMTP_PORT" SMTP_USER="$SMTP_USER" \
    SMTP_PASS="$SMTP_PASS" SMTP_ADMIN_EMAIL="$SMTP_ADMIN_EMAIL" python3 - <<'PY'
import json, os
print(json.dumps({"stringData": {
    "SMTP_HOST": os.environ["SMTP_HOST"].strip(),
    "SMTP_PORT": os.environ["SMTP_PORT"].strip(),
    "SMTP_USER": os.environ["SMTP_USER"].strip(),
    "SMTP_PASS": os.environ["SMTP_PASS"].strip(),
    "SMTP_ADMIN_EMAIL": (os.environ.get("SMTP_ADMIN_EMAIL") or os.environ["SMTP_USER"]).strip(),
}}))
PY
)"

patch_file="$(mktemp)"
trap 'rm -f "$patch_file"' EXIT
printf '%s' "$patch_json" >"$patch_file"
kubectl -n "$NS" patch secret "$SECRET" --type merge --patch-file "$patch_file"

# Ensure auth resolves mail hostname to fixed ClusterIP (TLS SAN = mail.yieldscope.d3bu7.com)
kubectl -n "$NS" patch deployment/auth --type strategic -p '{"spec":{"template":{"spec":{"hostAliases":[{"ip":"10.43.250.25","hostnames":["mail.yieldscope.d3bu7.com"]}]}}}}'

kubectl -n "$NS" rollout restart deployment/auth
kubectl -n "$NS" rollout status deployment/auth --timeout=180s

sleep 3
if kubectl -n "$NS" logs deploy/auth --tail=40 2>&1 | grep -q "Noop mail client"; then
  echo "[smtp] WARN: GoTrue still using noop mail client — check SMTP_HOST secret." >&2
  exit 1
fi

echo "[smtp] Done. From=${SMTP_ADMIN_EMAIL} via ${SMTP_HOST}:${SMTP_PORT}"
echo "[smtp] Auth emails go through GOTRUE_SMTP_* → self-hosted yieldscope-mail."
