#!/usr/bin/env bash
# Create yieldscope-supabase-secrets (JWT keys, dashboard password, DB URLs).
# Never commit the generated env file under deploy/env/.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NS="supabase-yieldscope"
PUBLIC_URL="https://supabase.yieldscope.d3bu7.com"
DEFAULT_SITE_URL="https://yieldscope.d3bu7.com"
NODEPORT="30595"
ENV_FILE="${YIELDSCOPE_SUPABASE_ENV_FILE:-$ROOT/deploy/env/yieldscope-supabase.env}"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "ERROR: missing $1" >&2
    exit 1
  }
}

require_cmd kubectl
require_cmd openssl
require_cmd node

rand_hex() {
  openssl rand -hex "${1:-16}"
}

set_env_key() {
  local file="$1" key="$2" value="$3"
  mkdir -p "$(dirname "$file")"
  touch "$file"
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    local tmp
    tmp="$(mktemp)"
    awk -v k="$key" -v v="$value" '
      BEGIN { done = 0 }
      $0 ~ "^" k "=" { print k "=" v; done = 1; next }
      { print }
      END { if (!done) print k "=" v }
    ' "$file" >"$tmp"
    mv "$tmp" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >>"$file"
  fi
}

load_env_file() {
  [[ -f "$1" ]] || return 0
  local tmp
  tmp="$(mktemp)"
  sed '1s/^\xEF\xBB\xBF//; s/\r$//' "$1" >"$tmp"
  set -a
  # shellcheck disable=SC1090
  source "$tmp"
  set +a
  rm -f "$tmp"
}

load_env_file "$ENV_FILE"

regen="${SUPABASE_REGENERATE_SECRETS:-0}"
reuse=0
if [[ "$regen" != "1" && -n "${POSTGRES_PASSWORD:-}" && -n "${JWT_SECRET:-}" ]]; then
  reuse=1
fi

if [[ "$reuse" -eq 0 ]]; then
  POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$(rand_hex 16)}"
  JWT_SECRET="${JWT_SECRET:-super-secret-jwt-token-with-at-least-32-characters-long-$(rand_hex 8)}"
  DASHBOARD_USERNAME="${DASHBOARD_USERNAME:-supabase}"
  DASHBOARD_PASSWORD="${DASHBOARD_PASSWORD:-$(rand_hex 12)}"
  PG_META_CRYPTO_KEY="${PG_META_CRYPTO_KEY:-$(rand_hex 16)}"
fi

SUPABASE_PUBLIC_URL="${SUPABASE_PUBLIC_URL:-$PUBLIC_URL}"
SUPABASE_DB_HOST="${SUPABASE_DB_HOST:-db}"
SUPABASE_DB_PORT="${SUPABASE_DB_PORT:-5432}"
SUPABASE_NAMESPACE="${SUPABASE_NAMESPACE:-$NS}"
SITE_URL="${SITE_URL:-$DEFAULT_SITE_URL}"

eval "$(
  POSTGRES_PASSWORD="$POSTGRES_PASSWORD" JWT_SECRET="$JWT_SECRET" \
    SUPABASE_PUBLIC_URL="$SUPABASE_PUBLIC_URL" SUPABASE_DB_HOST="$SUPABASE_DB_HOST" \
    SUPABASE_DB_PORT="$SUPABASE_DB_PORT" SUPABASE_NAMESPACE="$SUPABASE_NAMESPACE" \
    SITE_URL="$SITE_URL" KONG_NODEPORT="$NODEPORT" \
    node "$ROOT/deploy/scripts/lib/k8s-supabase-keys.mjs"
)"

GOTRUE_DB_DATABASE_URL="${GOTRUE_DB_DATABASE_URL:-postgres://supabase_auth_admin:${POSTGRES_PASSWORD}@${SUPABASE_DB_HOST}:${SUPABASE_DB_PORT}/postgres}"
PGRST_DB_URI="${PGRST_DB_URI:-postgres://authenticator:${POSTGRES_PASSWORD}@${SUPABASE_DB_HOST}:${SUPABASE_DB_PORT}/postgres}"
POSTGRES_BACKEND_URL="${POSTGRES_BACKEND_URL:-postgresql://supabase_admin:${POSTGRES_PASSWORD}@${SUPABASE_DB_HOST}:${SUPABASE_DB_PORT}/_supabase}"
STORAGE_DATABASE_URL="${STORAGE_DATABASE_URL:-postgres://supabase_storage_admin:${POSTGRES_PASSWORD}@${SUPABASE_DB_HOST}:${SUPABASE_DB_PORT}/postgres}"

for kv in \
  "SUPABASE_NAMESPACE=$SUPABASE_NAMESPACE" \
  "SUPABASE_PUBLIC_URL=$SUPABASE_PUBLIC_URL" \
  "SITE_URL=$SITE_URL" \
  "POSTGRES_PASSWORD=$POSTGRES_PASSWORD" \
  "JWT_SECRET=$JWT_SECRET" \
  "ANON_KEY=$ANON_KEY" \
  "SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY" \
  "DASHBOARD_USERNAME=${DASHBOARD_USERNAME:-supabase}" \
  "DASHBOARD_PASSWORD=${DASHBOARD_PASSWORD:-}" \
  "PG_META_CRYPTO_KEY=${PG_META_CRYPTO_KEY:-}" \
  "GOTRUE_DB_DATABASE_URL=$GOTRUE_DB_DATABASE_URL" \
  "PGRST_DB_URI=$PGRST_DB_URI" \
  "POSTGRES_BACKEND_URL=$POSTGRES_BACKEND_URL" \
  "STORAGE_DATABASE_URL=$STORAGE_DATABASE_URL" \
  "KONG_NODEPORT=$NODEPORT"; do
  key="${kv%%=*}"
  val="${kv#*=}"
  [[ -n "$val" ]] && set_env_key "$ENV_FILE" "$key" "$val"
done

# Preserve existing SMTP keys if present in env file
load_env_file "$ENV_FILE"

kubectl create namespace "$NS" --dry-run=client -o yaml | kubectl apply -f -

SECRET_ARGS=(
  --from-literal=POSTGRES_PASSWORD="$POSTGRES_PASSWORD"
  --from-literal=JWT_SECRET="$JWT_SECRET"
  --from-literal=ANON_KEY="$ANON_KEY"
  --from-literal=SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"
  --from-literal=DASHBOARD_USERNAME="${DASHBOARD_USERNAME:-supabase}"
  --from-literal=DASHBOARD_PASSWORD="${DASHBOARD_PASSWORD:-}"
  --from-literal=PG_META_CRYPTO_KEY="${PG_META_CRYPTO_KEY:-}"
  --from-literal=GOTRUE_DB_DATABASE_URL="$GOTRUE_DB_DATABASE_URL"
  --from-literal=PGRST_DB_URI="$PGRST_DB_URI"
  --from-literal=POSTGRES_BACKEND_URL="$POSTGRES_BACKEND_URL"
  --from-literal=STORAGE_DATABASE_URL="$STORAGE_DATABASE_URL"
)

# Keep SMTP if already patched
for k in SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS SMTP_ADMIN_EMAIL; do
  val="${!k:-}"
  if [[ -z "$val" ]] && kubectl -n "$NS" get secret yieldscope-supabase-secrets >/dev/null 2>&1; then
    val="$(kubectl -n "$NS" get secret yieldscope-supabase-secrets -o "jsonpath={.data.$k}" 2>/dev/null | base64 -d 2>/dev/null || true)"
  fi
  if [[ -n "$val" ]]; then
    SECRET_ARGS+=(--from-literal="$k=$val")
    set_env_key "$ENV_FILE" "$k" "$val"
  fi
done

kubectl -n "$NS" delete secret yieldscope-supabase-secrets --ignore-not-found
kubectl -n "$NS" create secret generic yieldscope-supabase-secrets "${SECRET_ARGS[@]}"

echo "==> yieldscope-supabase-secrets updated (namespace $NS)"
echo "    env file: $ENV_FILE (gitignored)"
echo "    Studio user: ${DASHBOARD_USERNAME:-supabase}"
echo "    Studio pass: retrieve with:"
echo "      kubectl -n $NS get secret yieldscope-supabase-secrets -o jsonpath='{.data.DASHBOARD_PASSWORD}' | base64 -d; echo"
if [[ "$reuse" -eq 1 ]]; then
  echo "    reused credentials from env file"
else
  echo "    generated new credentials"
fi
