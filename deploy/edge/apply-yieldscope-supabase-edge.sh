#!/usr/bin/env bash
# Apply YieldScope Supabase nginx edge vhost on blackpearl (nginx-gitlab-edge).
# Run on blackpearl with sudo. Requires DNS supabase.yieldscope.d3bu7.com -> WAN IP.
#
# IMPORTANT: regenerating /etc/nginx/gitlab-edge/nginx.conf drops these includes.
# Re-run after any edge nginx.conf update (together with apply-yieldscope-edge.sh).
set -euo pipefail

EDGE_DIR="/etc/nginx/gitlab-edge"
CONF_SRC="${1:-$(dirname "$0")/yieldscope-supabase.conf}"
CONF_DST="${EDGE_DIR}/yieldscope-supabase.conf"
NGINX_MAIN="${EDGE_DIR}/nginx.conf"
CERT_DIR="/etc/letsencrypt/live/supabase.yieldscope.d3bu7.com"
HOST="supabase.yieldscope.d3bu7.com"
INCLUDE_LINE="    include /etc/nginx/gitlab-edge/yieldscope-supabase.conf;"

if [[ ! -f "$CONF_SRC" ]]; then
  echo "Missing $CONF_SRC" >&2
  exit 1
fi

install -m 644 "$CONF_SRC" "$CONF_DST"

if [[ ! -d "$CERT_DIR" ]]; then
  echo "Issuing TLS cert for $HOST..."
  certbot certonly --webroot -w /var/lib/li-httpd -d "$HOST" \
    --non-interactive --agree-tos -m admin@d3bu7.com || true
fi

if [[ ! -d "$CERT_DIR" ]]; then
  echo "Cert not found at $CERT_DIR — nginx include skipped until cert exists." >&2
  echo "Ensure DNS A $HOST -> edge IP, then re-run." >&2
  exit 1
fi

ensure_include() {
  if grep -qF 'include /etc/nginx/gitlab-edge/yieldscope-supabase.conf;' "$NGINX_MAIN"; then
    return 0
  fi
  if grep -qF 'include /etc/nginx/gitlab-edge/yieldscope.conf;' "$NGINX_MAIN"; then
    sed -i '/include \/etc\/nginx\/gitlab-edge\/yieldscope.conf;/a\
    include /etc/nginx/gitlab-edge/yieldscope-supabase.conf;' "$NGINX_MAIN"
  elif grep -qF 'include /etc/nginx/gitlab-edge/majico-staging.conf;' "$NGINX_MAIN"; then
    sed -i '/include \/etc\/nginx\/gitlab-edge\/majico-staging.conf;/a\
    include /etc/nginx/gitlab-edge/yieldscope-supabase.conf;' "$NGINX_MAIN"
  else
    echo "WARN: anchor include not found; appending near end of $NGINX_MAIN" >&2
    awk -v line="$INCLUDE_LINE" '
      { lines[NR]=$0 }
      END {
        last=NR
        for (i=NR; i>=1; i--) if (lines[i] ~ /^[[:space:]]*}[[:space:]]*$/) { last=i; break }
        for (i=1; i<=NR; i++) {
          if (i==last) print line
          print lines[i]
        }
      }
    ' "$NGINX_MAIN" >"${NGINX_MAIN}.tmp"
    mv "${NGINX_MAIN}.tmp" "$NGINX_MAIN"
  fi
}

ensure_include

nginx -t -c "$NGINX_MAIN"
systemctl reload nginx-gitlab-edge || nginx -s reload -c "$NGINX_MAIN"

if ! nginx -T -c "$NGINX_MAIN" 2>/dev/null | grep -q "server_name $HOST"; then
  echo "ERROR: $HOST server_name not active after reload" >&2
  exit 1
fi

echo "YieldScope Supabase edge vhost applied ($HOST -> 127.0.0.1:30595)."
