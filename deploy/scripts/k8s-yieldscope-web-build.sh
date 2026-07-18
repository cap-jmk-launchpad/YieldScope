#!/usr/bin/env bash
# Build + import YieldScope web image into blackpearl k3s.
# NEXT_PUBLIC_* is baked at build time - always use YieldScope Supabase (never majico).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
IMAGE="${IMAGE:-ghcr.io/cap-jmk-real/yieldscope-web:latest}"
BUILD_HOST="${BUILD_HOST:-blackpearl}"
KUBECONFIG="${KUBECONFIG:-$HOME/.kube/config-homelab}"
export KUBECONFIG

# Always bake YieldScope URL + cluster anon key (web/.env.local often still has majico/wrong JWT).
SU="${NEXT_PUBLIC_SUPABASE_URL:-https://supabase.yieldscope.d3bu7.com}"
if [[ "$SU" == *majico* ]]; then
  echo "Refusing to build with majico Supabase URL: $SU" >&2
  exit 1
fi

SA="$(kubectl -n supabase-yieldscope get secret yieldscope-supabase-secrets \
  -o jsonpath='{.data.ANON_KEY}' | base64 -d)"
if [[ -z "$SA" ]]; then
  echo "Missing ANON_KEY in supabase-yieldscope/yieldscope-supabase-secrets" >&2
  exit 1
fi
MR="${NEXT_PUBLIC_MONAD_RPC_URL:-https://testnet-rpc.monad.xyz}"
CP="${NEXT_PUBLIC_CHECKPOINT_ADDRESS:-}"
WC="${NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID:-21fef48091f12692cad574a6f7753643}"

echo "==> syncing sources to $BUILD_HOST"
TAR_EXCLUDES=(
  --exclude=node_modules
  --exclude=.next
  --exclude=web/.next
  --exclude=coverage
  --exclude=coverage-*
  --exclude=.git
  --exclude=.agents
  --exclude=.cursor
  --exclude=.codex
  --exclude=scripts/tmp-*
  --exclude=deploy/scripts/_web-deploy.out.log
  --exclude=deploy/scripts/_web-deploy.err.log
)
ssh "$BUILD_HOST" 'rm -rf /tmp/yieldscope-build && mkdir -p /tmp/yieldscope-build'
# Exit 1 = "file changed as we read it" (harmless noise from local tooling); fail on real errors.
set +e
tar "${TAR_EXCLUDES[@]}" -cf - -C "$ROOT" . \
  | ssh "$BUILD_HOST" 'tar -xf - -C /tmp/yieldscope-build'
pipe_status=("${PIPESTATUS[@]}")
set -e
tar_ec=${pipe_status[0]:-0}
ssh_ec=${pipe_status[1]:-0}
[[ "$ssh_ec" -eq 0 ]] || exit "$ssh_ec"
[[ "$tar_ec" -eq 0 || "$tar_ec" -eq 1 ]] || exit "$tar_ec"

echo "==> docker build $IMAGE (SUPABASE_URL=$SU)"
ssh "$BUILD_HOST" "set -e
  cd /tmp/yieldscope-build
  # Ensure local env cannot override build-args toward majico
  if [[ -f web/.env.local ]]; then
    sed -i 's|supabase\\.majico\\.d3bu7\\.com|supabase.yieldscope.d3bu7.com|g' web/.env.local || true
  fi
  docker build -t '$IMAGE' \
    --build-arg NEXT_PUBLIC_SUPABASE_URL='$SU' \
    --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY='$SA' \
    --build-arg NEXT_PUBLIC_MONAD_RPC_URL='$MR' \
    --build-arg NEXT_PUBLIC_CHECKPOINT_ADDRESS='$CP' \
    --build-arg NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID='$WC' \
    -f web/Dockerfile .
  docker save '$IMAGE' -o /tmp/yieldscope-web.tar
  sudo k3s ctr images import /tmp/yieldscope-web.tar
"

echo "==> rollout restart"
kubectl -n yieldscope rollout restart deploy/yieldscope-web
kubectl -n yieldscope rollout status deploy/yieldscope-web --timeout=180s

echo "==> verify baked URL (must be yieldscope, not majico)"
kubectl -n yieldscope exec deploy/yieldscope-web -- \
  sh -c 'grep -roh "supabase\.[a-z]*\.d3bu7\.com" /app/web/.next | sort -u'
echo "OK"
