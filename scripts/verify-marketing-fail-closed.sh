#!/usr/bin/env bash
set -euo pipefail

command -v jq >/dev/null 2>&1 || { apt-get update >/dev/null && apt-get install -y jq >/dev/null; }

MARKETING_API='http://127.0.0.1:8787'
ORGANIZATION_NAME='Amanat Med Academy'
MODULE_CODE='marketing.analytics'
STATE_FILE='/opt/imds-marketing/control/entitlements.json'
BACKUP_FILE="${STATE_FILE}.failclosed-e2e.$$"
RECONCILE_TIMER_WAS_ACTIVE='false'
MARKETING_HASH=''
STATE_MOVED='false'

cleanup() {
  if [ "$STATE_MOVED" = 'true' ] && [ -f "$BACKUP_FILE" ]; then
    mv -f "$BACKUP_FILE" "$STATE_FILE" || true
    STATE_MOVED='false'
  fi
  if [ "$RECONCILE_TIMER_WAS_ACTIVE" = 'true' ]; then
    systemctl start imdssa-reconcile.timer >/dev/null 2>&1 || true
  fi
  if [ -n "$MARKETING_HASH" ]; then
    docker exec imds-postgres psql -U imds_owner -d imds_marketing -c "delete from public.imds_auth_sessions where token_hash='$MARKETING_HASH'" >/dev/null 2>&1 || true
  fi
  rm -f /tmp/imds-fail-closed-response.json
}
trap cleanup EXIT

source /etc/imds-platform-control.env

echo 'FAIL_CLOSED_WAIT_RUNTIME=begin'
runtime_ready='false'
for attempt in $(seq 1 120); do
  info="$(curl -fsS -H "Authorization: Bearer $IMDS_PLATFORM_CONTROL_TOKEN" "$MARKETING_API/internal/platform/info" 2>/dev/null || true)"
  mode="$(printf '%s' "$info" | jq -r '.entitlementMode // empty' 2>/dev/null || true)"
  column_ready="$(docker exec imds-postgres psql -U imds_owner -d imds_marketing -At -c "select exists(select 1 from information_schema.columns where table_schema='public' and table_name='crm_companies' and column_name='platform_managed_at')" 2>/dev/null | xargs || true)"
  if systemctl is-active --quiet imds-marketing.service && [ "$mode" = 'fail-closed-managed' ] && [ "$column_ready" = 't' ]; then
    runtime_ready='true'
    echo "FAIL_CLOSED_RUNTIME_READY attempts=$attempt"
    break
  fi
  if [ $((attempt % 10)) -eq 0 ]; then
    echo "FAIL_CLOSED_WAIT_RUNTIME attempt=$attempt service=$(systemctl is-active imds-marketing.service 2>/dev/null || true) mode=${mode:-missing} column=${column_ready:-missing}"
  fi
  sleep 2
done
[ "$runtime_ready" = 'true' ]

TENANT_ID="$(sudo -u postgres psql -d imdssa -At -c "select b.remote_tenant_id from app.product_tenant_bindings b join app.products p on p.id=b.product_id join app.organizations o on o.id=b.organization_id where p.code='imds-marketing' and o.name='$ORGANIZATION_NAME' order by b.updated_at desc limit 1" | xargs)"
[[ "$TENANT_ID" =~ ^[0-9a-fA-F-]{36}$ ]]

tenant_state="$(curl -fsS -H "Authorization: Bearer $IMDS_PLATFORM_CONTROL_TOKEN" "$MARKETING_API/internal/platform/state?tenantId=$TENANT_ID")"
printf '%s' "$tenant_state" | jq -e --arg tenant "$TENANT_ID" --arg module "$MODULE_CODE" '.tenant.tenantId==$tenant and .tenant.productEnabled==true and .tenant.modules[$module]==true and (.tenant.revision|type)=="number"' >/dev/null

# Idempotently enroll this existing real tenant in fail-closed mode using its exact current entitlement.
apply_payload="$(printf '%s' "$tenant_state" | jq -c '.tenant')"
curl -fsS \
  -H "Authorization: Bearer $IMDS_PLATFORM_CONTROL_TOKEN" \
  -H 'content-type: application/json' \
  -X POST "$MARKETING_API/internal/platform/entitlements/apply" \
  --data "$apply_payload" | jq -e '.applied==true' >/dev/null

managed="$(docker exec imds-postgres psql -U imds_owner -d imds_marketing -At -c "select platform_managed_at is not null from public.crm_companies where id='$TENANT_ID'::uuid" | xargs)"
[ "$managed" = 't' ]
echo 'FAIL_CLOSED_MANAGED_MARKER=success'

MARKETING_USER_ID="$(docker exec imds-postgres psql -U imds_owner -d imds_marketing -At -c "select id from public.imds_auth_users where lower(email)='admin@imds.kz' and status='active' limit 1" | xargs)"
[[ "$MARKETING_USER_ID" =~ ^[0-9a-fA-F-]{36}$ ]]
MARKETING_TOKEN="$(openssl rand -hex 48)"
MARKETING_HASH="$(printf '%s' "$MARKETING_TOKEN" | sha256sum | awk '{print $1}')"
docker exec imds-postgres psql -U imds_owner -d imds_marketing -c "insert into public.imds_auth_sessions(user_id,token_hash,remember_me,expires_at) values('$MARKETING_USER_ID'::uuid,'$MARKETING_HASH',false,now()+interval '10 minutes')" >/dev/null

normal_code="$(curl -sS -o /tmp/imds-fail-closed-response.json -w '%{http_code}' -H "Authorization: Bearer $MARKETING_TOKEN" -H "x-imds-company-id: $TENANT_ID" "$MARKETING_API/api/analytics")"
[ "$normal_code" != '503' ]
[ "$normal_code" != '403' ]
echo "FAIL_CLOSED_BASELINE_ACCESS=success code=$normal_code"

[ -s "$STATE_FILE" ]
if systemctl is-active --quiet imdssa-reconcile.timer; then
  RECONCILE_TIMER_WAS_ACTIVE='true'
fi
systemctl stop imdssa-reconcile.timer >/dev/null 2>&1 || true
systemctl stop imdssa-reconcile.service >/dev/null 2>&1 || true
mv "$STATE_FILE" "$BACKUP_FILE"
STATE_MOVED='true'

fail_code="$(curl -sS -o /tmp/imds-fail-closed-response.json -w '%{http_code}' -H "Authorization: Bearer $MARKETING_TOKEN" -H "x-imds-company-id: $TENANT_ID" "$MARKETING_API/api/analytics")"
[ "$fail_code" = '503' ]
jq -e '.error=="PLATFORM_ENTITLEMENT_UNAVAILABLE" and .retryable==true' /tmp/imds-fail-closed-response.json >/dev/null
echo 'FAIL_CLOSED_MISSING_ENTITLEMENT_503=success'

mv -f "$BACKUP_FILE" "$STATE_FILE"
STATE_MOVED='false'
if [ "$RECONCILE_TIMER_WAS_ACTIVE" = 'true' ]; then
  systemctl start imdssa-reconcile.timer >/dev/null
fi

restored_entitlements="$(curl -fsS -H "Authorization: Bearer $MARKETING_TOKEN" -H "x-imds-company-id: $TENANT_ID" "$MARKETING_API/api/platform/entitlements")"
printf '%s' "$restored_entitlements" | jq -e --arg module "$MODULE_CODE" '.productEnabled==true and .modules[$module]==true' >/dev/null
restored_code="$(curl -sS -o /tmp/imds-fail-closed-response.json -w '%{http_code}' -H "Authorization: Bearer $MARKETING_TOKEN" -H "x-imds-company-id: $TENANT_ID" "$MARKETING_API/api/analytics")"
[ "$restored_code" != '503' ]
[ "$restored_code" != '403' ]
echo "FAIL_CLOSED_RESTORE=success code=$restored_code"
echo 'MARKETING_FAIL_CLOSED_E2E=success'
