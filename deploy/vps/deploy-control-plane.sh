#!/usr/bin/env bash
set -euo pipefail

RELEASE_SHA="${1:?release sha required}"
STAGE_DIR="${2:-/tmp/imdssa-release}"
APP_DIR=/opt/imds-super-admin
WEB_ROOT=/var/www/imds-super-admin
API_DIR="$APP_DIR/api"
ENV_DIR=/etc/imds-super-admin
CONTROL_ENV=/etc/imds-platform-control.env
CONTROL_GROUP=imds-platform

if [ "$(id -u)" -ne 0 ]; then
  echo "deploy-control-plane.sh must run as root" >&2
  exit 1
fi

id -u imdssa >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin imdssa
getent group "$CONTROL_GROUP" >/dev/null 2>&1 || groupadd --system "$CONTROL_GROUP"
usermod -a -G "$CONTROL_GROUP" imdssa
if id imds >/dev/null 2>&1; then
  usermod -a -G "$CONTROL_GROUP" imds
fi
if [ ! -f "$CONTROL_ENV" ]; then
  umask 027
  printf 'IMDS_PLATFORM_CONTROL_TOKEN=%s\n' "$(openssl rand -hex 48)" > "$CONTROL_ENV"
fi
chown root:"$CONTROL_GROUP" "$CONTROL_ENV"
chmod 0640 "$CONTROL_ENV"

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

if [ ! -f "$ENV_DIR/telegram.env" ]; then
  cat > "$ENV_DIR/telegram.env" <<'EOF'
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
EOF
fi
chown root:imdssa "$ENV_DIR/telegram.env"
chmod 0640 "$ENV_DIR/telegram.env"

# The reconciliation and health workers touch the same control-plane tables that
# migrations install triggers on. Pause them briefly before DDL so repeat deploys
# cannot deadlock with a live worker transaction. Commands remain durable in
# PostgreSQL and are resumed after the migration completes.
systemctl stop imdssa-reconcile.timer imdssa-reconcile.service 2>/dev/null || true
systemctl stop imdssa-product-monitor.timer imdssa-product-monitor.service 2>/dev/null || true

install -d -o root -g postgres -m 0750 "$APP_DIR/migrations"
for migration in 002_auth_sessions.sql 003_platform_management.sql 004_control_plane_sync.sql 005_registration_notifications.sql 005_security_hardening.sql 006_tenant_rbac.sql 007_notification_delivery_settings.sql 008_product_commercial_catalog.sql 009_tenant_user_access.sql; do
  install -o root -g postgres -m 0640 "$STAGE_DIR/$migration" "$APP_DIR/migrations/$migration"
  sudo -u postgres psql --set=ON_ERROR_STOP=1 --dbname=imdssa --file="$APP_DIR/migrations/$migration"
done

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
SupplementaryGroups=imds-platform
WorkingDirectory=/opt/imds-super-admin/api
EnvironmentFile=/etc/imds-super-admin/postgres.env
EnvironmentFile=/etc/imds-super-admin/api.env
EnvironmentFile=/etc/imds-platform-control.env
EnvironmentFile=-/etc/imds-super-admin/telegram.env
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

install -m 0755 "$STAGE_DIR/product-monitor.sh" /usr/local/sbin/imdssa-product-monitor
install -m 0644 "$STAGE_DIR/product-monitor.service" /etc/systemd/system/imdssa-product-monitor.service
install -m 0644 "$STAGE_DIR/product-monitor.timer" /etc/systemd/system/imdssa-product-monitor.timer
install -m 0644 "$STAGE_DIR/reconcile.service" /etc/systemd/system/imdssa-reconcile.service
install -m 0644 "$STAGE_DIR/reconcile.timer" /etc/systemd/system/imdssa-reconcile.timer

nginx -t
systemctl daemon-reload

systemctl enable imds-super-admin-api.service
systemctl restart imds-super-admin-api.service

systemctl enable --now imdssa-product-monitor.timer
systemctl enable --now imdssa-reconcile.timer
systemctl start imdssa-product-monitor.service || true
systemctl start imdssa-reconcile.service || true
systemctl reload nginx

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q '^Status: active'; then
  ufw allow 8080/tcp >/dev/null
fi

for _ in $(seq 1 30); do
  if curl --fail --silent --show-error http://127.0.0.1:8788/healthz >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
curl --fail --silent --show-error http://127.0.0.1:8788/healthz >/dev/null
curl --fail --silent --show-error http://127.0.0.1:8080/healthz >/dev/null
systemctl is-active --quiet imds-super-admin-api.service
systemctl is-active --quiet postgresql
systemctl is-active --quiet imdssa-product-monitor.timer
systemctl is-active --quiet imdssa-reconcile.timer
sudo -u postgres psql --dbname=imdssa --tuples-only --no-align --command="select code||'|'||last_health::text from app.products where code='imds-marketing'" | grep -q '^imds-marketing|'
sudo -u postgres psql --dbname=imdssa --tuples-only --no-align --command="select case when to_regclass('app.registration_notifications') is null then 'missing' else 'ready' end" | grep -q '^ready$'
sudo -u postgres psql --dbname=imdssa --tuples-only --no-align --command="select exists(select 1 from information_schema.columns where table_schema='app' and table_name='platform_users' and column_name='must_change_password')" | grep -q '^t$'
sudo -u postgres psql --dbname=imdssa --tuples-only --no-align --command="select to_regclass('app.product_plans') is not null and to_regclass('app.product_module_commercial') is not null" | grep -q '^t$'

echo "IMDS Super Admin deployed on port 8080"
