BEGIN;

-- Repair only subscriptions created by the legacy organization_products backfill.
-- This is intentionally idempotent and never overwrites an explicitly assigned plan.
UPDATE app.product_subscriptions s
SET status = CASE WHEN (op.config->>'trialEndsAt')::timestamptz > now() THEN 'trial' ELSE 'expired' END,
    trial_started_at = nullif(op.config->>'trialStartsAt','')::timestamptz,
    trial_ends_at = nullif(op.config->>'trialEndsAt','')::timestamptz,
    access_ends_at = nullif(op.config->>'trialEndsAt','')::timestamptz,
    metadata = s.metadata || jsonb_build_object('trialRepaired',true,'trialSource','registration'),
    updated_at = now()
FROM app.organization_products op
WHERE s.organization_id=op.organization_id
  AND s.product_id=op.product_id
  AND s.plan_id IS NULL
  AND s.metadata->>'source'='organization_products_backfill'
  AND op.config->>'source'='registration'
  AND nullif(op.config->>'trialEndsAt','') IS NOT NULL;

COMMIT;
