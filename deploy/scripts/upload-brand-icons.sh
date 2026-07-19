#!/usr/bin/env bash
# Upload Phase 1 brand icons to Supabase Storage bucket `brand-icons`.
#
# Usage (from repo root, with kubeconfig):
#   export KUBECONFIG="$HOME/.kube/config-homelab"
#   bash deploy/scripts/upload-brand-icons.sh
#
# Convention:
#   bucket:  brand-icons
#   object:  {slug}.svg
#   local:   web/public/brands/{slug}.svg
set -euo pipefail

NS="${SUPABASE_NS:-supabase-yieldscope}"
BUCKET="${BRAND_ICONS_BUCKET:-brand-icons}"
PUBLIC_URL="${SUPABASE_PUBLIC_URL:-https://supabase.yieldscope.d3bu7.com}"
API="${PUBLIC_URL}/storage/v1"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOCAL_DIR="${ROOT}/web/public/brands"
SLUGS=(binance okx monad terra)

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "ERROR: missing $1" >&2
    exit 1
  }
}

require_cmd kubectl
require_cmd curl
require_cmd base64

SERVICE_KEY="$(kubectl -n "$NS" get secret yieldscope-supabase-secrets \
  -o jsonpath='{.data.SERVICE_ROLE_KEY}' | base64 -d)"
[[ -n "$SERVICE_KEY" ]] || {
  echo "ERROR: empty SERVICE_ROLE_KEY" >&2
  exit 1
}

auth_hdr=(-H "Authorization: Bearer ${SERVICE_KEY}" -H "apikey: ${SERVICE_KEY}")

echo "==> ensure storage API is up ($API/status)"
for i in $(seq 1 30); do
  if curl -sf "${API}/status" >/dev/null; then
    break
  fi
  if [[ "$i" -eq 30 ]]; then
    echo "ERROR: storage API not reachable at ${API}/status" >&2
    exit 1
  fi
  sleep 2
done

echo "==> ensure public bucket '$BUCKET'"
curl -sf "${auth_hdr[@]}" -H "Content-Type: application/json" \
  -d "{\"id\":\"${BUCKET}\",\"name\":\"${BUCKET}\",\"public\":true,\"file_size_limit\":1048576,\"allowed_mime_types\":[\"image/svg+xml\",\"image/png\",\"image/webp\",\"image/x-icon\"]}" \
  "${API}/bucket" >/dev/null 2>&1 || true

curl -sf -X PUT "${auth_hdr[@]}" -H "Content-Type: application/json" \
  -d '{"public":true}' \
  "${API}/bucket/${BUCKET}" >/dev/null 2>&1 || true

upload_file() {
  local slug="$1" file="$2"
  local object="${slug}.svg"
  echo "  upload $object"
  curl -sf "${auth_hdr[@]}" \
    -H "Content-Type: image/svg+xml" \
    -H "x-upsert: true" \
    --data-binary @"$file" \
    "${API}/object/${BUCKET}/${object}" >/dev/null
}

echo "==> upload brand icons from $LOCAL_DIR"
for slug in "${SLUGS[@]}"; do
  file="${LOCAL_DIR}/${slug}.svg"
  if [[ ! -f "$file" ]]; then
    echo "ERROR: missing $file" >&2
    exit 1
  fi
  upload_file "$slug" "$file"
done

echo "==> verify public URLs"
fail=0
for slug in "${SLUGS[@]}"; do
  url="${PUBLIC_URL}/storage/v1/object/public/${BUCKET}/${slug}.svg"
  code="$(curl -s -o /dev/null -w '%{http_code}' "$url")"
  echo "  GET $url → $code"
  if [[ "$code" != "200" ]]; then
    fail=1
  fi
done

if [[ "$fail" -ne 0 ]]; then
  echo "ERROR: one or more public objects not readable" >&2
  exit 1
fi

echo "OK — bucket=${BUCKET} public base=${PUBLIC_URL}/storage/v1/object/public/${BUCKET}/{slug}.svg"
