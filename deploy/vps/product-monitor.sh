#!/usr/bin/env bash
set -euo pipefail

PRODUCT_CODE="imds-marketing"
PRODUCT_NAME="IMDS Marketing"
ADAPTER_BASE_URL="http://127.0.0.1:8787"
HEALTHCHECK_URL="$ADAPTER_BASE_URL/api/health"

started_ms="$(date +%s%3N)"
health="offline"
last_error="Marketing health endpoint unavailable"

if curl -fsS --max-time 4 "$HEALTHCHECK_URL" >/dev/null 2>&1; then
  health="healthy"
  last_error=""
fi

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
  --dbname=imdssa <<'SQL'
INSERT INTO app.products(
  code,
  name,
  description,
  status,
  adapter_base_url,
  healthcheck_url,
  last_health,
  last_heartbeat_at,
  last_latency_ms,
  last_error,
  metadata
)
VALUES (
  :'product_code',
  :'product_name',
  'Marketing automation, CRM context, integrations and communications',
  'active'::app.product_status,
  :'adapter_base_url',
  :'healthcheck_url',
  :'health'::app.health_status,
  CASE WHEN :'health' = 'healthy' THEN now() ELSE NULL END,
  :'latency_ms'::integer,
  NULLIF(:'last_error',''),
  jsonb_build_object('runtime','vps','source','local-health-adapter')
)
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    status = 'active'::app.product_status,
    adapter_base_url = EXCLUDED.adapter_base_url,
    healthcheck_url = EXCLUDED.healthcheck_url,
    last_health = EXCLUDED.last_health,
    last_heartbeat_at = CASE WHEN EXCLUDED.last_health = 'healthy' THEN now() ELSE app.products.last_heartbeat_at END,
    last_latency_ms = EXCLUDED.last_latency_ms,
    last_error = EXCLUDED.last_error,
    metadata = app.products.metadata || EXCLUDED.metadata,
    updated_at = now();
SQL
