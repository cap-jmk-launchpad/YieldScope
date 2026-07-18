#!/usr/bin/env bash
# Optional: mirror vendored logos from web/public/assets/tokens/ into Supabase
# Storage bucket `asset-logos`. The Next.js app serves local files first —
# this script is only needed if you still want CDN/Storage copies.
#
# Prefer refreshing local SVGs with:
#   node scripts/refresh-asset-logos.mjs
#
# Usage (from repo root, with kubeconfig):
#   export KUBECONFIG="$HOME/.kube/config-homelab"
#   bash deploy/scripts/upload-asset-logos.sh
#
# Convention:
#   bucket:  asset-logos
#   object:  {slug}.svg
#   local:   web/public/assets/tokens/{slug}.svg
set -euo pipefail

NS="${SUPABASE_NS:-supabase-yieldscope}"
BUCKET="${ASSET_LOGOS_BUCKET:-asset-logos}"
PUBLIC_URL="${SUPABASE_PUBLIC_URL:-https://supabase.yieldscope.d3bu7.com}"
API="${PUBLIC_URL}/storage/v1"
CDN="https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOCAL_DIR="${ROOT}/web/public/assets/tokens"

# Prefer local vendored files; CDN + custom as fallbacks
CDN_SLUGS=(btc eth usdt usdc dai tusd usd eur gbp jpy sol bnb xrp ada doge link avax dot atom trx matic busd fdusd usde)
CUSTOM_SLUGS=(mon lunc ustc)

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
# Create (ignore if exists)
curl -sf "${auth_hdr[@]}" -H "Content-Type: application/json" \
  -d "{\"id\":\"${BUCKET}\",\"name\":\"${BUCKET}\",\"public\":true,\"file_size_limit\":1048576,\"allowed_mime_types\":[\"image/svg+xml\",\"image/png\",\"image/webp\"]}" \
  "${API}/bucket" >/dev/null 2>&1 || true

# Force public
curl -sf -X PUT "${auth_hdr[@]}" -H "Content-Type: application/json" \
  -d '{"public":true}' \
  "${API}/bucket/${BUCKET}" >/dev/null 2>&1 || true

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

write_custom() {
  local slug="$1"
  case "$slug" in
  mon)
    cat >"$TMP/mon.svg" <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="16" fill="#836EF9"/><path fill="#fff" d="M9.2 21.5V10.5h2.4l3.2 7.1 3.2-7.1h2.4v11H18v-7.2l-2.6 5.6h-1.6L11.2 14.3v7.2H9.2z"/></svg>
SVG
    ;;
  lunc)
    cat >"$TMP/lunc.svg" <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="16" fill="#172852"/><path fill="#F4D03F" d="M16 6.5c.4 3.2 2.3 5.8 5.2 7.5-2.9 1.7-4.8 4.3-5.2 7.5-.4-3.2-2.3-5.8-5.2-7.5 2.9-1.7 4.8-4.3 5.2-7.5z"/><circle cx="16" cy="16" r="2.2" fill="#F4D03F"/></svg>
SVG
    ;;
  ustc)
    cat >"$TMP/ustc.svg" <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="16" fill="#5493F7"/><path fill="#fff" d="M10 11.2h12v2.2h-4.7V22h-2.6V13.4H10v-2.2z"/></svg>
SVG
    ;;
  esac
}

upload_file() {
  local slug="$1" file="$2"
  local object="${slug}.svg"
  echo "  upload $object"
  # upsert via POST with x-upsert
  curl -sf "${auth_hdr[@]}" \
    -H "Content-Type: image/svg+xml" \
    -H "x-upsert: true" \
    --data-binary @"$file" \
    "${API}/object/${BUCKET}/${object}" >/dev/null
}

echo "==> upload icons (local vendored → CDN → custom)"
for slug in "${CDN_SLUGS[@]}"; do
  if [[ -f "${LOCAL_DIR}/${slug}.svg" ]]; then
    upload_file "$slug" "${LOCAL_DIR}/${slug}.svg"
  elif curl -sfL "${CDN}/${slug}.svg" -o "${TMP}/${slug}.svg"; then
    upload_file "$slug" "${TMP}/${slug}.svg"
  else
    echo "  WARN: miss for ${slug}.svg — skip (app falls back to initials)"
  fi
done

echo "==> custom icons (MON / LUNC / USTC)"
for slug in "${CUSTOM_SLUGS[@]}"; do
  if [[ -f "${LOCAL_DIR}/${slug}.svg" ]]; then
    upload_file "$slug" "${LOCAL_DIR}/${slug}.svg"
  else
    write_custom "$slug"
    upload_file "$slug" "${TMP}/${slug}.svg"
  fi
done

echo "==> verify public URL"
sample="${PUBLIC_URL}/storage/v1/object/public/${BUCKET}/btc.svg"
code="$(curl -s -o /dev/null -w '%{http_code}' "$sample")"
echo "  GET $sample → $code"
if [[ "$code" != "200" ]]; then
  echo "ERROR: public object not readable (HTTP $code)" >&2
  exit 1
fi

echo "OK — bucket=${BUCKET} public base=${PUBLIC_URL}/storage/v1/object/public/${BUCKET}/{slug}.svg"
