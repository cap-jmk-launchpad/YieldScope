#!/usr/bin/env bash
# Apply YieldScope dedicated Supabase stack + migrations.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NS="supabase-yieldscope"
OVERLAY="$ROOT/deploy/k8s/supabase-yieldscope"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "ERROR: missing $1" >&2
    exit 1
  }
}

require_cmd kubectl

kubectl get secret yieldscope-supabase-secrets -n "$NS" >/dev/null 2>&1 || {
  echo "ERROR: missing yieldscope-supabase-secrets — run deploy/scripts/k8s-yieldscope-supabase-secret.sh first" >&2
  exit 1
}

echo "==> apply yieldscope supabase ($NS)"
kubectl -n "$NS" delete job yieldscope-supabase-migrate --ignore-not-found
kubectl apply -k "$OVERLAY/"

echo "==> wait for postgres"
kubectl -n "$NS" rollout status statefulset/db --timeout=600s

echo "==> sync role passwords"
PG="$(kubectl get secret yieldscope-supabase-secrets -n "$NS" -o jsonpath='{.data.POSTGRES_PASSWORD}' | base64 -d)"
for role in authenticator supabase_auth_admin supabase_admin supabase_storage_admin pgbouncer; do
  kubectl exec -n "$NS" db-0 -- env PGPASSWORD="$PG" psql -h 127.0.0.1 -U supabase_admin -d postgres -v ON_ERROR_STOP=1 \
    -c "ALTER USER ${role} WITH PASSWORD '${PG}';" >/dev/null
done
echo "==> role passwords synced"

echo "==> run migrations"
kubectl apply -k "$OVERLAY/"
kubectl -n "$NS" wait --for=condition=complete job/yieldscope-supabase-migrate --timeout=300s

for dep in auth rest meta studio kong; do
  echo "==> wait $dep"
  kubectl -n "$NS" rollout status "deployment/$dep" --timeout=600s
done

kubectl -n "$NS" get pods,svc
echo ""
echo "Kong NodePort: http://<blackpearl-ip>:30595/"
echo "Public API:    https://supabase.yieldscope.d3bu7.com"
echo "Studio:        https://supabase.yieldscope.d3bu7.com/ (basic auth)"
