BEGIN;

CREATE OR REPLACE FUNCTION app.trg_queue_subscription_sync()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=app,pg_temp
AS $$
DECLARE
  target_org uuid;
  target_product uuid;
  reason text;
BEGIN
  target_org := CASE WHEN TG_OP='DELETE' THEN OLD.organization_id ELSE NEW.organization_id END;
  target_product := CASE WHEN TG_OP='DELETE' THEN OLD.product_id ELSE NEW.product_id END;
  reason := 'product_subscription.' || lower(TG_OP);

  IF TG_OP='UPDATE' THEN
    IF ROW(
      NEW.plan_id,
      NEW.plan_revision,
      NEW.status,
      NEW.billing_period_months,
      NEW.currency,
      NEW.base_price_kzt,
      NEW.addons_price_kzt,
      NEW.custom_price_kzt,
      NEW.payment_method,
      NEW.renewal_mode,
      NEW.trial_started_at,
      NEW.trial_ends_at,
      NEW.current_period_start,
      NEW.current_period_end,
      NEW.grace_ends_at,
      NEW.access_ends_at,
      NEW.limits,
      NEW.plan_snapshot
    ) IS NOT DISTINCT FROM ROW(
      OLD.plan_id,
      OLD.plan_revision,
      OLD.status,
      OLD.billing_period_months,
      OLD.currency,
      OLD.base_price_kzt,
      OLD.addons_price_kzt,
      OLD.custom_price_kzt,
      OLD.payment_method,
      OLD.renewal_mode,
      OLD.trial_started_at,
      OLD.trial_ends_at,
      OLD.current_period_start,
      OLD.current_period_end,
      OLD.grace_ends_at,
      OLD.access_ends_at,
      OLD.limits,
      OLD.plan_snapshot
    ) THEN
      RETURN NEW;
    END IF;
  END IF;

  PERFORM app.queue_product_sync(target_org,target_product,reason);
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS control_sync_product_subscriptions ON app.product_subscriptions;
CREATE TRIGGER control_sync_product_subscriptions
AFTER INSERT OR UPDATE OR DELETE ON app.product_subscriptions
FOR EACH ROW EXECUTE FUNCTION app.trg_queue_subscription_sync();

-- Existing subscriptions may predate the trigger. Queue one canonical refresh so
-- downstream products converge to Control Center state immediately after deploy.
DO $$
DECLARE rec record;
BEGIN
  FOR rec IN SELECT organization_id,product_id FROM app.product_subscriptions LOOP
    PERFORM app.queue_product_sync(rec.organization_id,rec.product_id,'subscription_sync_revision.bootstrap');
  END LOOP;
END $$;

COMMIT;
