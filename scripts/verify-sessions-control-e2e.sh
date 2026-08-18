#!/usr/bin/env bash
set -euo pipefail

command -v jq >/dev/null 2>&1 || { apt-get update >/dev/null && apt-get install -y jq >/dev/null; }

SA_API='http://127.0.0.1:8788'
MARKETING_API='http://127.0.0.1:8787'
ORGANIZATION_NAME='Amanat Med Academy'
MODULE_CODE='marketing.analytics'

runtime_ready=''
for attempt in $(seq 1 120); do
  if systemctl is-active --quiet imds-super-admin-api.service \
    && systemctl is-active --quiet imdssa-reconcile.timer \
    && systemctl is-active --quiet imdssa-product-monitor.timer \
    && test -f /opt/imds-super-admin/api/dist/sessionRoutes.js \
    && grep -q '/api/auth/sessions' /opt/imds-super-admin/api/dist/sessionRoutes.js \
    && grep -R -q 'Активные устройства' /var/www/imds-super-admin/current/assets 2>/dev/null \
    && curl -fsS "$SA_API/healthz" >/dev/null 2>&1; then
    runtime_ready=1
    echo "RUNTIME_READY attempts=$attempt"
    break
  fi
  if [ $((attempt % 10)) -eq 0 ]; then
    echo "WAIT_RUNTIME attempt=$attempt api=$(systemctl is-active imds-super-admin-api.service 2>/dev/null || true) reconcile=$(systemctl is-active imdssa-reconcile.timer 2>/dev/null || true) monitor=$(systemctl is-active imdssa-product-monitor.timer 2>/dev/null || true) session_routes=$(test -f /opt/imds-super-admin/api/dist/sessionRoutes.js && echo yes || echo no)"
  fi
  sleep 2
done
if [ -z "$runtime_ready" ]; then
  echo 'RUNTIME_NOT_READY' >&2
  ls -la /opt/imds-super-admin/api/dist/sessionRoutes.js 2>/dev/null || true
  systemctl --no-pager --full status imds-super-admin-api.service || true
  exit 1
fi

ADMIN_ID="$(sudo -u postgres psql -d imdssa -Atq -c "select id from app.platform_users where is_active=true and global_role in ('platform_owner','platform_admin') order by case global_role when 'platform_owner' then 0 else 1 end,created_at limit 1" | head -1 | xargs)"
[[ "$ADMIN_ID" =~ ^[0-9a-f-]{36}$ ]]
echo 'SESSION_ADMIN_READY=success'

SA_TOKEN="$(openssl rand -hex 32)"
SA_HASH="$(printf '%s' "$SA_TOKEN" | sha256sum | awk '{print $1}')"
SECOND_TOKEN="$(openssl rand -hex 32)"
SECOND_HASH="$(printf '%s' "$SECOND_TOKEN" | sha256sum | awk '{print $1}')"
SECOND_SESSION_ID="$(sudo -u postgres psql -d imdssa -Atq -c "insert into app.auth_sessions(user_id,token_hash,expires_at,source_ip,user_agent) values('$ADMIN_ID'::uuid,'$SECOND_HASH',now()+interval '10 minutes','127.0.0.1','IMDS E2E secondary') returning id" | head -1 | xargs)"
[[ "$SECOND_SESSION_ID" =~ ^[0-9a-f-]{36}$ ]]
echo 'SESSION_SECOND_CREATED=success'

sudo -u postgres psql -d imdssa -q -c "insert into app.auth_sessions(user_id,token_hash,expires_at,source_ip,user_agent) values('$ADMIN_ID'::uuid,'$SA_HASH',now()+interval '10 minutes','127.0.0.1','IMDS E2E current')" >/dev/null
SA_COOKIE="Cookie: imdssa_session=$SA_TOKEN"
echo 'SESSION_CURRENT_CREATED=success'

MARKETING_HASH=''
INSTALLATION_ID=''
ORGANIZATION_ID=''
TENANT_ID=''
ORIGINAL_STATUS=''

cleanup_auth() {
  sudo -u postgres psql -d imdssa -q -c "delete from app.auth_sessions where token_hash in ('$SA_HASH','$SECOND_HASH')" >/dev/null 2>&1 || true
  if [ -n "$MARKETING_HASH" ]; then
    docker exec imds-postgres psql -U imds_owner -d imds_marketing -c "delete from public.imds_auth_sessions where token_hash='$MARKETING_HASH'" >/dev/null 2>&1 || true
  fi
}

restore() {
  if [ -n "$INSTALLATION_ID" ] && [ -n "$ORIGINAL_STATUS" ]; then
    current="$(curl -fsS -H "$SA_COOKIE" "$SA_API/api/v1/installations" 2>/dev/null | jq -r --arg id "$INSTALLATION_ID" '.items[]|select(.id==$id)|.status' | head -1 || true)"
    if [ "$current" != "$ORIGINAL_STATUS" ]; then
      echo "RESTORE desired=$ORIGINAL_STATUS current=$current"
      curl -fsS -H "$SA_COOKIE" -H 'content-type: application/json' -X PATCH "$SA_API/api/v1/installations/$INSTALLATION_ID" --data "{\"status\":\"$ORIGINAL_STATUS\"}" >/dev/null || true
      expected_restore=true
      [ "$ORIGINAL_STATUS" = suspended ] && expected_restore=false
      for attempt in $(seq 1 30); do
        systemctl start imdssa-reconcile.service >/dev/null 2>&1 || true
        sleep 1
        if [ -n "$TENANT_ID" ]; then
          source /etc/imds-platform-control.env
          value="$(curl -fsS -H "Authorization: Bearer $IMDS_PLATFORM_CONTROL_TOKEN" "$MARKETING_API/internal/platform/state" 2>/dev/null | jq -r --arg tenant "$TENANT_ID" --arg code "$MODULE_CODE" '.tenants[$tenant].modules[$code]' || true)"
          if [ "$value" = "$expected_restore" ]; then
            echo "RESTORE_CONFIRMED expected=$expected_restore attempts=$attempt"
            break
          fi
        fi
      done
    fi
  fi
  cleanup_auth
}
trap restore EXIT

sessions="$(curl -fsS -H "$SA_COOKIE" "$SA_API/api/auth/sessions")"
session_count="$(printf '%s' "$sessions" | jq '.items|length')"
current_count="$(printf '%s' "$sessions" | jq '[.items[]|select(.is_current==true)]|length')"
echo "SESSION_LIST_READY count=$session_count current=$current_count"
printf '%s' "$sessions" | jq -e --arg id "$SECOND_SESSION_ID" '.items|map(select(.id==$id))|length==1' >/dev/null
printf '%s' "$sessions" | jq -e '.items|map(select(.is_current==true))|length>=1' >/dev/null
curl -fsS -H "$SA_COOKIE" -X DELETE "$SA_API/api/auth/sessions/$SECOND_SESSION_ID" | jq -e '.revoked==true' >/dev/null
sudo -u postgres psql -d imdssa -Atq -c "select count(*) from app.auth_sessions where id='$SECOND_SESSION_ID'::uuid" | head -1 | xargs | grep -q '^0$'
echo 'SESSION_MANAGEMENT=success'

installations="$(curl -fsS -H "$SA_COOKIE" "$SA_API/api/v1/installations")"
INSTALLATION_ID="$(printf '%s' "$installations" | jq -r --arg code "$MODULE_CODE" --arg org "$ORGANIZATION_NAME" '.items[]|select(.module_code==$code and .organization_name==$org)|.id' | head -1)"
ORGANIZATION_ID="$(printf '%s' "$installations" | jq -r --arg id "$INSTALLATION_ID" '.items[]|select(.id==$id)|.organization_id' | head -1)"
ORIGINAL_STATUS="$(printf '%s' "$installations" | jq -r --arg id "$INSTALLATION_ID" '.items[]|select(.id==$id)|.status' | head -1)"
[[ "$INSTALLATION_ID" =~ ^[0-9a-f-]{36}$ ]]
[[ "$ORGANIZATION_ID" =~ ^[0-9a-f-]{36}$ ]]
test "$ORIGINAL_STATUS" = active -o "$ORIGINAL_STATUS" = suspended
echo "CONTROL_TARGET_READY original=$ORIGINAL_STATUS"

source /etc/imds-platform-control.env
remote_state="$(curl -fsS -H "Authorization: Bearer $IMDS_PLATFORM_CONTROL_TOKEN" "$MARKETING_API/internal/platform/state")"
TENANT_ID="$(printf '%s' "$remote_state" | jq -r --arg org "$ORGANIZATION_ID" '.tenants|to_entries[]|select(.value.organizationId==$org)|.key' | head -1)"
[[ "$TENANT_ID" =~ ^[0-9a-f-]{36}$ ]]
echo 'MARKETING_TENANT_READY=success'

MARKETING_USER_ID="$(docker exec imds-postgres psql -U imds_owner -d imds_marketing -Atq -c "select id from public.imds_auth_users where lower(email)='admin@imds.kz' and status='active' limit 1" | head -1 | xargs)"
[[ "$MARKETING_USER_ID" =~ ^[0-9a-f-]{36}$ ]]
MARKETING_TOKEN="$(openssl rand -hex 48)"
MARKETING_HASH="$(printf '%s' "$MARKETING_TOKEN" | sha256sum | awk '{print $1}')"
docker exec imds-postgres psql -U imds_owner -d imds_marketing -q -c "insert into public.imds_auth_sessions(user_id,token_hash,remember_me,expires_at) values('$MARKETING_USER_ID'::uuid,'$MARKETING_HASH',false,now()+interval '10 minutes')" >/dev/null
echo 'MARKETING_SESSION_READY=success'

revision() {
  curl -fsS -H "$SA_COOKIE" "$SA_API/api/v1/organization-products" | jq -r --arg org "$ORGANIZATION_ID" '.items[]|select(.organization_id==$org and .product_code=="imds-marketing")|.desired_revision'
}

assert_synced() {
  expected="$1"
  start_revision="$2"
  require_403="$3"
  for attempt in $(seq 1 35); do
    systemctl start imdssa-reconcile.service >/dev/null 2>&1 || true
    sleep 1

    current_installations="$(curl -fsS -H "$SA_COOKIE" "$SA_API/api/v1/installations")"
    actual="$(printf '%s' "$current_installations" | jq -r --arg id "$INSTALLATION_ID" '.items[]|select(.id==$id)|.actual_enabled')"
    installation_sync="$(printf '%s' "$current_installations" | jq -r --arg id "$INSTALLATION_ID" '.items[]|select(.id==$id)|.sync_status')"
    applied_revision="$(printf '%s' "$current_installations" | jq -r --arg id "$INSTALLATION_ID" '.items[]|select(.id==$id)|.last_applied_revision')"

    bindings="$(curl -fsS -H "$SA_COOKIE" "$SA_API/api/v1/organization-products")"
    desired="$(printf '%s' "$bindings" | jq -r --arg org "$ORGANIZATION_ID" '.items[]|select(.organization_id==$org and .product_code=="imds-marketing")|.desired_revision')"
    binding_actual="$(printf '%s' "$bindings" | jq -r --arg org "$ORGANIZATION_ID" '.items[]|select(.organization_id==$org and .product_code=="imds-marketing")|.actual_revision')"
    binding_sync="$(printf '%s' "$bindings" | jq -r --arg org "$ORGANIZATION_ID" '.items[]|select(.organization_id==$org and .product_code=="imds-marketing")|.sync_status')"

    remote="$(curl -fsS -H "Authorization: Bearer $IMDS_PLATFORM_CONTROL_TOKEN" "$MARKETING_API/internal/platform/state")"
    remote_enabled="$(printf '%s' "$remote" | jq -r --arg tenant "$TENANT_ID" --arg code "$MODULE_CODE" '.tenants[$tenant].modules[$code]')"
    remote_revision="$(printf '%s' "$remote" | jq -r --arg tenant "$TENANT_ID" '.tenants[$tenant].revision')"

    browser="$(curl -fsS -H "Authorization: Bearer $MARKETING_TOKEN" -H "x-imds-company-id: $TENANT_ID" "$MARKETING_API/api/platform/entitlements")"
    browser_enabled="$(printf '%s' "$browser" | jq -r --arg code "$MODULE_CODE" '.modules[$code]')"
    browser_revision="$(printf '%s' "$browser" | jq -r '.revision')"

    command_status="$(sudo -u postgres psql -d imdssa -Atq -c "select c.status from app.control_commands c join app.products p on p.id=c.product_id where c.organization_id='$ORGANIZATION_ID'::uuid and p.code='imds-marketing' and c.desired_revision=$desired::bigint order by c.created_at desc limit 1" | head -1 | xargs)"

    echo "E2E_STATE attempt=$attempt expected=$expected desired=$desired actual=$actual install_sync=$installation_sync applied=$applied_revision binding_actual=$binding_actual binding_sync=$binding_sync remote=$remote_enabled remote_revision=$remote_revision browser=$browser_enabled browser_revision=$browser_revision command=$command_status"

    if [ "$actual" = "$expected" ] && [ "$installation_sync" = synced ] && [ "$applied_revision" = "$desired" ] && [ "$binding_actual" = "$desired" ] && [ "$binding_sync" = synced ] && [ "$remote_enabled" = "$expected" ] && [ "$remote_revision" = "$desired" ] && [ "$browser_enabled" = "$expected" ] && [ "$browser_revision" = "$desired" ] && [ "$command_status" = succeeded ] && [ "$desired" -gt "$start_revision" ]; then
      if [ "$require_403" = yes ]; then
        http_code="$(curl -sS -o /tmp/analytics-gate.json -w '%{http_code}' -H "Authorization: Bearer $MARKETING_TOKEN" -H "x-imds-company-id: $TENANT_ID" "$MARKETING_API/api/analytics")"
        test "$http_code" = 403
        jq -e --arg code "$MODULE_CODE" '.error=="MODULE_DISABLED_BY_PLATFORM" and .module==$code' /tmp/analytics-gate.json >/dev/null
        echo 'MARKETING_DIRECT_API_403=success'
      fi
      echo "E2E_SYNCED expected=$expected revision=$desired attempts=$attempt"
      return 0
    fi
  done
  return 1
}

before="$(revision)"
test_status=suspended
expected=false
require_403=yes
if [ "$ORIGINAL_STATUS" = suspended ]; then
  test_status=active
  expected=true
  require_403=no
fi

echo "E2E_BEGIN organization=$ORGANIZATION_NAME module=$MODULE_CODE original=$ORIGINAL_STATUS test=$test_status revision=$before"
curl -fsS -H "$SA_COOKIE" -H 'content-type: application/json' -X PATCH "$SA_API/api/v1/installations/$INSTALLATION_ID" --data "{\"status\":\"$test_status\"}" >/dev/null
assert_synced "$expected" "$before" "$require_403"

mid="$(revision)"
curl -fsS -H "$SA_COOKIE" -H 'content-type: application/json' -X PATCH "$SA_API/api/v1/installations/$INSTALLATION_ID" --data "{\"status\":\"$ORIGINAL_STATUS\"}" >/dev/null
original_expected=true
restore_403=no
if [ "$ORIGINAL_STATUS" = suspended ]; then
  original_expected=false
  restore_403=yes
fi
assert_synced "$original_expected" "$mid" "$restore_403"

echo 'CONTROL_PLANE_E2E=success'
echo "ORIGINAL_STATUS_RESTORED=$ORIGINAL_STATUS"
