#!/usr/bin/env bash
# Patch IONOS SMTP into yieldscope-supabase-secrets and restart GoTrue.
# Loads EMAIL_* / SMTP_* from env or majico .env.local paths.
set -euo pipefail

NS="supabase-yieldscope"
SECRET="yieldscope-supabase-secrets"

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

# Prefer already-exported env; else majico / Obsevia local files (never committed here).
if [[ -z "${SMTP_HOST:-${EMAIL_HOST:-}}" || -z "${SMTP_PASS:-${EMAIL_PASS:-}}" ]]; then
  for candidate in \
    "${MAJICO_ENV_FILE:-}" \
    "$HOME/Documents/Programming/majico/majico.xyz/.env.local" \
    "/mnt/c/Users/Julian/Documents/Programming/majico/majico.xyz/.env.local" \
    "$HOME/../Julian/Documents/Programming/majico/majico.xyz/.env.local"; do
    [[ -n "$candidate" && -f "$candidate" ]] || continue
    echo "[smtp] loading $candidate"
    load_env_file "$candidate"
    break
  done
fi

# Windows path when run from Git Bash / WSL with USERPROFILE
if [[ -z "${SMTP_HOST:-${EMAIL_HOST:-}}" && -n "${USERPROFILE:-}" ]]; then
  win="${USERPROFILE}/Documents/Programming/majico/majico.xyz/.env.local"
  win="${win//\\//}"
  if [[ -f "$win" ]]; then
    echo "[smtp] loading $win"
    load_env_file "$win"
  fi
fi

SMTP_HOST="${SMTP_HOST:-${EMAIL_HOST:-}}"
SMTP_PORT="${SMTP_PORT:-${EMAIL_PORT:-465}}"
SMTP_USER="${SMTP_USER:-${EMAIL_USER:-}}"
SMTP_PASS="${SMTP_PASS:-${EMAIL_PASS:-}}"
SMTP_ADMIN_EMAIL="${SMTP_ADMIN_EMAIL:-${SMTP_USER}}"

missing=0
for var in SMTP_HOST SMTP_USER SMTP_PASS; do
  if [[ -z "${!var:-}" ]]; then
    echo "Missing required env: $var (or EMAIL_* from majico .env.local)" >&2
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

kubectl -n "$NS" rollout restart deployment/auth
kubectl -n "$NS" rollout status deployment/auth --timeout=180s

sleep 3
if kubectl -n "$NS" logs deploy/auth --tail=40 2>&1 | grep -q "Noop mail client"; then
  echo "[smtp] WARN: GoTrue still using noop mail client — check SMTP_HOST secret." >&2
  exit 1
fi

echo "[smtp] Done. From=${SMTP_ADMIN_EMAIL} via ${SMTP_HOST}:${SMTP_PORT}"
echo "[smtp] Auth emails (confirm/recovery) go through GOTRUE_SMTP_* — no Studio UI needed."
