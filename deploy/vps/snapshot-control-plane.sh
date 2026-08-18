#!/usr/bin/env bash
set -euo pipefail

BASE=/opt/imds-super-admin
STORE="$BASE/release-bundles"
WEB=/var/www/imds-super-admin/current
API="$BASE/api"
MIGRATIONS="$BASE/migrations"
ID="recovery-$(date -u +%Y%m%d%H%M%S)"
ROOT="$STORE/$ID"
STAGE="$ROOT/stage"

mkdir -p "$STAGE/web" "$STAGE/api"
cp -a "$WEB/." "$STAGE/web/"
cp -a "$API/dist" "$STAGE/api/dist"
cp "$API/package.json" "$STAGE/api/package.json"
if [ -d "$API/node_modules" ]; then cp -a "$API/node_modules" "$STAGE/api/node_modules"; fi

for file in "$MIGRATIONS"/*.sql; do
  [ -f "$file" ] && cp "$file" "$STAGE/$(basename "$file")"
done
cp /etc/nginx/sites-available/imds-super-admin "$STAGE/nginx.conf"
cp "$BASE/deploy-control-plane.sh" "$STAGE/deploy-control-plane.sh"
cp /usr/local/sbin/imdssa-product-monitor "$STAGE/product-monitor.sh"
cp /etc/systemd/system/imdssa-product-monitor.service "$STAGE/product-monitor.service"
cp /etc/systemd/system/imdssa-product-monitor.timer "$STAGE/product-monitor.timer"
cp /etc/systemd/system/imdssa-reconcile.service "$STAGE/reconcile.service"
cp /etc/systemd/system/imdssa-reconcile.timer "$STAGE/reconcile.timer"
cp /etc/systemd/system/imdssa-subscription-lifecycle.service "$STAGE/subscription-lifecycle.service"
cp /etc/systemd/system/imdssa-subscription-lifecycle.timer "$STAGE/subscription-lifecycle.timer"
cp /etc/systemd/system/imdssa-billing-reconciliation.service "$STAGE/billing-reconciliation.service"
cp /etc/systemd/system/imdssa-billing-reconciliation.timer "$STAGE/billing-reconciliation.timer"
[ -f "$BASE/local-release-runner.sh" ] && cp "$BASE/local-release-runner.sh" "$STAGE/local-release-runner.sh"
[ -f "$BASE/snapshot-control-plane.sh" ] && cp "$BASE/snapshot-control-plane.sh" "$STAGE/snapshot-control-plane.sh"

SIZE="$(du -sb "$STAGE" | awk '{print $1}')"
cat > "$ROOT/release.json" <<EOF
{
  "id": "$ID",
  "source": "recovery",
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "sizeBytes": $SIZE
}
EOF
chmod -R o-rwx "$ROOT"
echo "SNAPSHOT_ID=$ID"
