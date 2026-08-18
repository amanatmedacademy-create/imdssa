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
BACKUP="$ROOT/database"

mkdir -p "$STAGE/web" "$STAGE/api" "$BACKUP"
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

# Recovery snapshots include database dumps. They are not restored automatically during
# application rollback; an operator can use them for disaster recovery if schema/data
# also need to be returned to this point in time.
sudo -u postgres pg_dump --format=custom --no-owner --no-acl --file="$BACKUP/imdssa.dump" imdssa

MARKETING_DB_BACKED_UP=false
if command -v docker >/dev/null 2>&1 && docker inspect imds-postgres >/dev/null 2>&1; then
  if docker exec imds-postgres pg_dump -U imds_owner -Fc -d imds_marketing > "$BACKUP/imds_marketing.dump"; then
    MARKETING_DB_BACKED_UP=true
  else
    rm -f "$BACKUP/imds_marketing.dump"
  fi
fi

sha256sum "$BACKUP/imdssa.dump" > "$BACKUP/SHA256SUMS"
if [ -f "$BACKUP/imds_marketing.dump" ]; then sha256sum "$BACKUP/imds_marketing.dump" >> "$BACKUP/SHA256SUMS"; fi
chmod 0640 "$BACKUP"/*

SIZE="$(du -sb "$ROOT" | awk '{print $1}')"
cat > "$ROOT/release.json" <<EOF
{
  "id": "$ID",
  "source": "recovery",
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "sizeBytes": $SIZE,
  "databaseBackup": {
    "imdssa": true,
    "marketing": $MARKETING_DB_BACKED_UP,
    "checksums": true
  }
}
EOF
chmod -R o-rwx "$ROOT"

# Keep recovery storage bounded while preserving enough rollback history.
mapfile -t OLD_RECOVERY < <(find "$STORE" -mindepth 1 -maxdepth 1 -type d -name 'recovery-*' -printf '%T@ %p\n' | sort -nr | awk 'NR>10 {$1=""; sub(/^ /,""); print}')
for old in "${OLD_RECOVERY[@]}"; do
  [ -n "$old" ] && rm -rf -- "$old"
done

echo "SNAPSHOT_ID=$ID"
echo "DATABASE_BACKUP=$BACKUP/imdssa.dump"
