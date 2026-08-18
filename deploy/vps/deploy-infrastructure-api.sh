#!/usr/bin/env bash
set -euo pipefail

STAGE_DIR="${1:-/tmp/imdssa-infra-release}"
APP_DIR=/opt/imds-super-admin/infra-api
ENV_DIR=/etc/imds-super-admin

if [ "$(id -u)" -ne 0 ]; then
  echo "deploy-infrastructure-api.sh must run as root" >&2
  exit 1
fi
if [ ! -f "$ENV_DIR/postgres.env" ]; then
  echo "Missing $ENV_DIR/postgres.env" >&2
  exit 1
fi

install -d -o root -g root -m 0750 "$APP_DIR"
rm -rf "$APP_DIR/dist"
cp -a "$STAGE_DIR/dist" "$APP_DIR/dist"
install -m 0644 "$STAGE_DIR/package.json" "$APP_DIR/package.json"
cd "$APP_DIR"
npm install --omit=dev --no-audit --no-fund

cat > /etc/systemd/system/imds-infrastructure-api.service <<'EOF'
[Unit]
Description=IMDS Infrastructure Control API
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=root
Group=root
WorkingDirectory=/opt/imds-super-admin/infra-api
EnvironmentFile=/etc/imds-super-admin/postgres.env
Environment=HOST=127.0.0.1
Environment=PORT=8790
ExecStart=/usr/bin/node /opt/imds-super-admin/infra-api/dist/index.js
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
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6 AF_NETLINK

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable imds-infrastructure-api.service
systemctl restart imds-infrastructure-api.service
for _ in $(seq 1 30); do
  if curl --fail --silent --show-error http://127.0.0.1:8790/infra-api/healthz >/dev/null 2>&1; then break; fi
  sleep 1
done
curl --fail --silent --show-error http://127.0.0.1:8790/infra-api/healthz >/dev/null
systemctl is-active --quiet imds-infrastructure-api.service
nginx -t
systemctl reload nginx
curl --fail --silent --show-error http://127.0.0.1:8080/infra-api/healthz >/dev/null

echo "IMDS Infrastructure Control API deployed"
