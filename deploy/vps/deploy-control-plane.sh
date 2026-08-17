#!/usr/bin/env bash
set -euo pipefail

RELEASE_SHA="${1:?release sha required}"
STAGE_DIR="${2:-/tmp/imdssa-release}"
APP_DIR=/opt/imds-super-admin
WEB_ROOT=/var/www/imds-super-admin
API_DIR="$APP_DIR/api"
ENV_DIR=/etc/imds-super-admin

if [ "$(id -u)" -ne 0 ]; then
  echo "deploy-control-plane.sh must run as root" >&2
  exit 1
fi

id -u imdssa >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin imdssa
install -d -o root -g root -m 0755 "$APP_DIR"
install -d -o imdssa -g imdssa -m 0750 "$API_DIR"
install -d -m 0755 "$WEB_ROOT/releases/$RELEASE_SHA"
install -d -m 0750 "$ENV_DIR"

if [ ! -f "$ENV_DIR/postgres.env" ]; then
  echo "Missing $ENV_DIR/postgres.env. Run bootstrap-postgres.sh first." >&2
  exit 1
fi
chown root:imdssa "$ENV_DIR/postgres.env"
chmod 0640 "$ENV_DIR/postgres.env"

install -d -o root -g postgres -m 0750 "$APP_DIR/migrations"
install -o root -g postgres -m 0640 "$STAGE_DIR/002_auth_sessions.sql" "$APP_DIR/migrations/002_auth_sessions.sql"
sudo -u postgres psql --set=ON_ERROR_STOP=1 --dbname=imdssa --file="$APP_DIR/migrations/002_auth_sessions.sql"

rm -rf "$WEB_ROOT/releases/$RELEASE_SHA"/*
cp -a "$STAGE_DIR/web/." "$WEB_ROOT/releases/$RELEASE_SHA/"
ln -sfn "$WEB_ROOT/releases/$RELEASE_SHA" "$WEB_ROOT/current"

rm -rf "$API_DIR/dist"
cp -a "$STAGE_DIR/api/dist" "$API_DIR/dist"
install -m 0644 "$STAGE_DIR/api/package.json" "$API_DIR/package.json"
chown -R imdssa:imdssa "$API_DIR"
cd "$API_DIR"
npm install --omit=dev --no-audit --no-fund

if [ ! -f "$ENV_DIR/api.env" ]; then
  cat > "$ENV_DIR/api.env" <<'EOF'
HOST=127.0.0.1
PORT=8788
COOKIE_SECURE=false
EOF
fi
chown root:imdssa "$ENV_DIR/api.env"
chmod 0640 "$ENV_DIR/api.env"

cat > /etc/systemd/system/imds-super-admin-api.service <<'EOF'
[Unit]
Description=IMDS Super Admin API
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=imdssa
Group=imdssa
WorkingDirectory=/opt/imds-super-admin/api
EnvironmentFile=/etc/imds-super-admin/postgres.env
EnvironmentFile=/etc/imds-super-admin/api.env
ExecStart=/usr/bin/node /opt/imds-super-admin/api/dist/index.js
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/imds-super-admin

[Install]
WantedBy=multi-user.target
EOF

source "$ENV_DIR/postgres.env"
export DATABASE_URL
if ! sudo -u postgres psql --dbname=imdssa --tuples-only --no-align --command="select count(*) from app.platform_users" | grep -Eq '^[1-9][0-9]*$'; then
  INITIAL_ADMIN_PASSWORD="$(openssl rand -base64 24 | tr -d '\n')"
  export INITIAL_ADMIN_PASSWORD INITIAL_ADMIN_EMAIL=admin@imdstech.net
  sudo -u imdssa env DATABASE_URL="$DATABASE_URL" INITIAL_ADMIN_EMAIL="$INITIAL_ADMIN_EMAIL" INITIAL_ADMIN_PASSWORD="$INITIAL_ADMIN_PASSWORD" node "$API_DIR/dist/bootstrapAdmin.js"
  umask 077
  cat > /root/imdssa-initial-admin.txt <<EOF
IMDS Super Admin initial credentials
URL: http://$(hostname -I | awk '{print $1}'):8080/
Email: $INITIAL_ADMIN_EMAIL
Password: $INITIAL_ADMIN_PASSWORD
EOF
  chmod 0600 /root/imdssa-initial-admin.txt
fi

install -m 0644 "$STAGE_DIR/nginx.conf" /etc/nginx/sites-available/imds-super-admin
ln -sfn /etc/nginx/sites-available/imds-super-admin /etc/nginx/sites-enabled/imds-super-admin
nginx -t
systemctl daemon-reload
systemctl enable --now imds-super-admin-api.service
systemctl reload nginx

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q '^Status: active'; then
  ufw allow 8080/tcp >/dev/null
fi

curl --fail --silent --show-error http://127.0.0.1:8788/healthz >/dev/null
curl --fail --silent --show-error http://127.0.0.1:8080/healthz >/dev/null
systemctl is-active --quiet imds-super-admin-api.service
systemctl is-active --quiet postgresql

echo "IMDS Super Admin deployed on port 8080"
echo "Initial credentials are stored root-only at /root/imdssa-initial-admin.txt when first created"
