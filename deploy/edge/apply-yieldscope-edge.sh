#!/usr/bin/env bash
# Apply YieldScope nginx edge vhost on blackpearl (nginx-gitlab-edge).
# Run on blackpearl with sudo. Requires DNS yieldscope.d3bu7.com -> WAN IP.
#
# IMPORTANT: regenerating /etc/nginx/gitlab-edge/nginx.conf (homelab edge apply)
# drops these includes. Re-run this script after any edge nginx.conf update.
set -euo pipefail

EDGE_DIR="/etc/nginx/gitlab-edge"
CONF_SRC="${1:-$(dirname "$0")/yieldscope.conf}"
CONF_DST="${EDGE_DIR}/yieldscope.conf"
NGINX_MAIN="${EDGE_DIR}/nginx.conf"
CERT_DIR="/etc/letsencrypt/live/yieldscope.d3bu7.com"
INCLUDE_LINE="    include /etc/nginx/gitlab-edge/yieldscope.conf;"

if [[ ! -f "$CONF_SRC" ]]; then
  echo "Missing $CONF_SRC" >&2
  exit 1
fi

install -m 644 "$CONF_SRC" "$CONF_DST"

if [[ ! -d "$CERT_DIR" ]]; then
  echo "Issuing TLS cert for yieldscope.d3bu7.com..."
  certbot certonly --webroot -w /var/lib/li-httpd -d yieldscope.d3bu7.com \
    --non-interactive --agree-tos -m admin@d3bu7.com || true
fi

if [[ ! -d "$CERT_DIR" ]]; then
  echo "Cert not found at $CERT_DIR — nginx include skipped until cert exists." >&2
  exit 1
fi

ensure_include() {
  if grep -qF 'include /etc/nginx/gitlab-edge/yieldscope.conf;' "$NGINX_MAIN"; then
    return 0
  fi
  if grep -qF 'include /etc/nginx/gitlab-edge/majico-staging.conf;' "$NGINX_MAIN"; then
    sed -i '/include \/etc\/nginx\/gitlab-edge\/majico-staging.conf;/a\
    include /etc/nginx/gitlab-edge/yieldscope.conf;' "$NGINX_MAIN"
  else
    echo "WARN: majico-staging.conf include not found; appending yieldscope include near end of $NGINX_MAIN" >&2
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

if ! nginx -T -c "$NGINX_MAIN" 2>/dev/null | grep -q 'server_name yieldscope.d3bu7.com'; then
  echo "ERROR: yieldscope.d3bu7.com server_name not active after reload" >&2
  exit 1
fi

echo "YieldScope edge vhost applied (Host yieldscope.d3bu7.com -> 127.0.0.1:30082)."
