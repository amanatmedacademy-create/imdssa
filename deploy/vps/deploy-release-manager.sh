#!/usr/bin/env bash
set -euo pipefail

STAGE_DIR="${1:-/tmp/imdssa-release-manager}"
APP_DIR=/opt/imds-super-admin/release-manager
ROOT=/opt/imds-super-admin
ENV_DIR=/etc/imds-super-admin

if [ "$(id -u)" -ne 0 ]; then
  echo "deploy-release-manager.sh must run as root" >&2
  exit 1
fi
if [ ! -f "$ENV_DIR/postgres.env" ]; then
  echo "Missing $ENV_DIR/postgres.env" >&2
  exit 1
fi

install -d -o root -g root -m 0750 "$APP_DIR" "$ROOT/release-bundles" "$ROOT/local-deploy-jobs"
rm -rf "$APP_DIR/dist"
cp -a "$STAGE_DIR/dist" "$APP_DIR/dist"
install -m 0644 "$STAGE_DIR/package.json" "$APP_DIR/package.json"
if [ -d "$STAGE_DIR/node_modules" ]; then
  rm -rf "$APP_DIR/node_modules"
  cp -a "$STAGE_DIR/node_modules" "$APP_DIR/node_modules"
else
  cd "$APP_DIR"
  npm install --omit=dev --no-audit --no-fund
fi

install -m 0750 "$STAGE_DIR/local-release-runner.sh" "$ROOT/local-release-runner.sh"
install -m 0750 "$STAGE_DIR/snapshot-control-plane.sh" "$ROOT/snapshot-control-plane.sh"

cat > /etc/systemd/system/imds-release-manager.service <<'EOF'
[Unit]
Description=IMDS Local Release Manager
After=network.target postgresql.service imds-super-admin-api.service
Requires=postgresql.service

[Service]
Type=simple
User=root
Group=root
WorkingDirectory=/opt/imds-super-admin/release-manager
EnvironmentFile=/etc/imds-super-admin/postgres.env
Environment=HOST=127.0.0.1
Environment=PORT=8791
ExecStart=/usr/bin/node /opt/imds-super-admin/release-manager/dist/index.js
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectKernelLogs=true
ProtectControlGroups=false
RestrictSUIDSGID=true
LockPersonality=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
ReadWritePaths=/opt/imds-super-admin /var/www/imds-super-admin /run/lock

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable imds-release-manager.service
systemctl restart imds-release-manager.service
for _ in $(seq 1 30); do
  if curl --fail --silent --show-error http://127.0.0.1:8791/release-api/healthz >/dev/null 2>&1; then break; fi
  sleep 1
done
curl --fail --silent --show-error http://127.0.0.1:8791/release-api/healthz >/dev/null
systemctl is-active --quiet imds-release-manager.service
nginx -t
systemctl reload nginx
curl --fail --silent --show-error http://127.0.0.1:8080/release-api/healthz >/dev/null

echo "IMDS Local Release Manager deployed"
