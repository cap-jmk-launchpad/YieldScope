#!/usr/bin/env bash
# Apply YieldScope nginx edge vhost on blackpearl (nginx-gitlab-edge).
# Run on blackpearl with sudo. Requires DNS yieldscope.d3bu7.com → WAN IP.
set -euo pipefail

EDGE_DIR="/etc/nginx/gitlab-edge"
CONF_SRC="${1:-$(dirname "$0")/yieldscope.conf}"
CONF_DST="${EDGE_DIR}/yieldscope.conf"
NGINX_MAIN="${EDGE_DIR}/nginx.conf"
CERT_DIR="/etc/letsencrypt/live/yieldscope.d3bu7.com"

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

if ! grep -q 'yieldscope.conf' "$NGINX_MAIN"; then
  sed -i '/include \/etc\/nginx\/gitlab-edge\/majico-staging.conf;/a\
    include /etc/nginx/gitlab-edge/yieldscope.conf;' "$NGINX_MAIN"
fi

nginx -t -c "$NGINX_MAIN"
systemctl reload nginx-gitlab-edge || nginx -s reload -c "$NGINX_MAIN"
echo "YieldScope edge vhost applied."
