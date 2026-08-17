#!/usr/bin/env bash
set -euo pipefail

PRODUCT_CODE="imds-marketing"
PRODUCT_NAME="IMDS Marketing"
SERVICE_NAME="imds-marketing.service"
ADAPTER_BASE_URL="http://127.0.0.1:8787"
HEALTHCHECK_URL="$ADAPTER_BASE_URL/api/health"

started_ms="$(date +%s%3N)"
health="offline"
last_error="Marketing service is not running"
version=""
heartbeat_sql="NULL"

service_state="$(systemctl is-active "$SERVICE_NAME" 2>/dev/null || true)"
if [ "$service_state" = "active" ]; then
  heartbeat_sql="now()"
  main_pid="$(systemctl show -p MainPID --value "$SERVICE_NAME" 2>/dev/null || true)"
  if [ -n "$main_pid" ] && [ "$main_pid" != "0" ] && [ -e "/proc/$main_pid/cwd" ]; then
    version="$(basename "$(readlink -f "/proc/$main_pid/cwd" 2>/dev/null || true)")"
  fi
  http_code="$(curl -sS -o /tmp/imdssa-marketing-health.json -w '%{http_code}' --max-time 4 "$HEALTHCHECK_URL" || true)"
  if [[ "$http_code" =~ ^2[0-9][0-9]$ ]]; then
    health="healthy"
    last_error=""
  elif [ -n "$http_code" ] && [ "$http_code" != "000" ]; then
    health="degraded"
    response="$(head -c 400 /tmp/imdssa-marketing-health.json 2>/dev/null || true)"
    last_error="Health endpoint HTTP $http_code${response:+: $response}"
  else
    health="degraded"
    last_error="Marketing process is active but health endpoint is unreachable"
  fi
fi
rm -f /tmp/imdssa-marketing-health.json

finished_ms="$(date +%s%3N)"
latency_ms="$((finished_ms - started_ms))"

sudo -u postgres psql \
  --set=ON_ERROR_STOP=1 \
  --set=product_code="$PRODUCT_CODE" \
  --set=product_name="$PRODUCT_NAME" \
  --set=adapter_base_url="$ADAPTER_BASE_URL" \
  --set=healthcheck_url="$HEALTHCHECK_URL" \
  --set=health="$health" \
  --set=latency_ms="$latency_ms" \
  --set=last_error="$last_error" \
  --set=version="$version" \
  --dbname=imdssa <<SQL
INSERT INTO app.products(code,name,description,status,version,adapter_base_url,healthcheck_url,last_health,last_heartbeat_at,last_latency_ms,last_error,metadata)
VALUES (
  :'product_code', :'product_name',
  'Marketing automation, CRM context, communications and integrations',
  'active'::app.product_status, NULLIF(:'version',''), :'adapter_base_url', :'healthcheck_url', :'health'::app.health_status,
  $heartbeat_sql, :'latency_ms'::integer, NULLIF(:'last_error',''),
  jsonb_build_object('runtime','vps','source','systemd-health-adapter','systemdService','$SERVICE_NAME')
)
ON CONFLICT (code) DO UPDATE
SET name=EXCLUDED.name,
    description=EXCLUDED.description,
    status='active'::app.product_status,
    version=COALESCE(EXCLUDED.version,app.products.version),
    adapter_base_url=EXCLUDED.adapter_base_url,
    healthcheck_url=EXCLUDED.healthcheck_url,
    last_health=EXCLUDED.last_health,
    last_heartbeat_at=CASE WHEN '$service_state'='active' THEN now() ELSE app.products.last_heartbeat_at END,
    last_latency_ms=EXCLUDED.last_latency_ms,
    last_error=EXCLUDED.last_error,
    metadata=app.products.metadata || EXCLUDED.metadata,
    updated_at=now();
SQL
