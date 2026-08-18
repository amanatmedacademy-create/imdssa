BEGIN;

CREATE OR REPLACE FUNCTION app.apply_paid_invoice_pending_plan(p_invoice_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=app,pg_temp
AS $$
DECLARE
  inv app.billing_invoices%ROWTYPE;
  sub app.product_subscriptions%ROWTYPE;
  plan_row app.product_plans%ROWTYPE;
  pending_plan_id uuid;
  months integer;
  base_price numeric(14,2);
  new_limits jsonb;
  enabled_module_ids uuid[] := ARRAY[]::uuid[];
  item record;
BEGIN
  SELECT * INTO inv FROM app.billing_invoices WHERE id=p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND'; END IF;
  IF inv.status <> 'paid' OR inv.paid_total_kzt < inv.total_kzt THEN RAISE EXCEPTION 'INVOICE_NOT_PAID'; END IF;

  pending_plan_id := NULLIF(inv.pricing_snapshot->>'pendingPlanId','')::uuid;
  IF pending_plan_id IS NULL THEN RETURN jsonb_build_object('applied',false,'reason','NO_PENDING_PLAN'); END IF;

  SELECT * INTO sub FROM app.product_subscriptions WHERE id=inv.subscription_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SUBSCRIPTION_NOT_FOUND'; END IF;

  months := COALESCE(NULLIF(inv.pricing_snapshot->>'pendingBillingPeriodMonths','')::integer,sub.billing_period_months,1);
  IF months NOT IN (1,3,6,12) THEN RAISE EXCEPTION 'INVALID_BILLING_PERIOD'; END IF;

  SELECT * INTO plan_row FROM app.product_plans WHERE id=pending_plan_id AND product_id=sub.product_id AND status='published' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PENDING_PLAN_NOT_AVAILABLE'; END IF;
  IF plan_row.pricing_mode <> 'fixed' THEN RAISE EXCEPTION 'REQUEST_PRICED_PLAN_REQUIRES_ADMIN'; END IF;

  SELECT amount_kzt INTO base_price FROM app.product_plan_prices WHERE plan_id=plan_row.id AND months=months;
  IF base_price IS NULL THEN RAISE EXCEPTION 'PLAN_PRICE_NOT_CONFIGURED_FOR_PERIOD'; END IF;
  new_limits := COALESCE(plan_row.limits,'{}'::jsonb);

  UPDATE app.product_subscriptions
  SET plan_id=plan_row.id,
      plan_revision=plan_row.revision,
      billing_period_months=months,
      currency='KZT',
      base_price_kzt=base_price,
      addons_price_kzt=0,
      custom_price_kzt=NULL,
      limits=new_limits,
      plan_snapshot=jsonb_build_object(
        'id',plan_row.id,'code',plan_row.code,'name',plan_row.name,'revision',plan_row.revision,
        'pricingMode',plan_row.pricing_mode,'trialMode',plan_row.trial_mode,'trialDays',plan_row.trial_days,'limits',new_limits
      ),
      updated_at=now()
  WHERE id=sub.id;

  DELETE FROM app.product_subscription_items WHERE subscription_id=sub.id;
  FOR item IN
    SELECT ppm.module_id,m.code,m.name
    FROM app.product_plan_modules ppm
    JOIN app.modules m ON m.id=ppm.module_id
    WHERE ppm.plan_id=plan_row.id AND ppm.mode='included'
  LOOP
    enabled_module_ids := array_append(enabled_module_ids,item.module_id);
    INSERT INTO app.product_subscription_items(subscription_id,module_id,mode,status,unit_price_kzt,price_snapshot)
    VALUES(sub.id,item.module_id,'included','active',0,jsonb_build_object('source','paid_invoice','invoiceId',p_invoice_id,'months',months))
    ON CONFLICT(subscription_id,module_id) DO UPDATE SET mode='included',status='active',unit_price_kzt=0,price_snapshot=excluded.price_snapshot,updated_at=now();
  END LOOP;

  UPDATE app.module_installations mi
  SET status=CASE WHEN mi.module_id=ANY(enabled_module_ids) THEN 'active'::app.installation_status ELSE 'suspended'::app.installation_status END,
      revision=mi.revision+1,updated_at=now()
  FROM app.product_module_commercial c
  WHERE mi.organization_id=sub.organization_id AND mi.host_product_id=sub.product_id
    AND c.product_id=sub.product_id AND c.module_id=mi.module_id AND c.commercial_role='module';

  INSERT INTO app.module_installations(organization_id,module_id,host_product_id,version,status,health,permissions,limits,config)
  SELECT sub.organization_id,m.id,sub.product_id,m.current_version,'active'::app.installation_status,'unknown'::app.health_status,
         COALESCE(m.permissions,'[]'::jsonb),COALESCE(m.limits,'{}'::jsonb),jsonb_build_object('source','paid_invoice','invoiceId',p_invoice_id)
  FROM app.modules m
  WHERE m.id=ANY(enabled_module_ids)
  ON CONFLICT(organization_id,module_id,host_product_id) DO UPDATE
    SET status='active'::app.installation_status,revision=app.module_installations.revision+1,config=app.module_installations.config || excluded.config,updated_at=now();

  UPDATE app.organization_products
  SET config=config || jsonb_build_object('limits',new_limits,'pendingPlanApplied',plan_row.code,'billingInvoiceId',p_invoice_id::text),updated_at=now()
  WHERE organization_id=sub.organization_id AND product_id=sub.product_id;

  INSERT INTO app.product_subscription_events(subscription_id,event_type,payload)
  VALUES(sub.id,'subscription.pending_plan_applied',jsonb_build_object('invoiceId',p_invoice_id,'planId',plan_row.id,'planCode',plan_row.code,'months',months));

  RETURN jsonb_build_object('applied',true,'subscriptionId',sub.id,'planId',plan_row.id,'planCode',plan_row.code,'months',months);
END;
$$;

CREATE OR REPLACE FUNCTION app.trg_apply_paid_invoice_pending_plan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=app,pg_temp
AS $$
BEGIN
  IF NEW.status='paid' AND OLD.status IS DISTINCT FROM 'paid' THEN
    PERFORM app.apply_paid_invoice_pending_plan(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS billing_invoice_apply_pending_plan ON app.billing_invoices;
CREATE TRIGGER billing_invoice_apply_pending_plan
AFTER UPDATE OF status ON app.billing_invoices
FOR EACH ROW EXECUTE FUNCTION app.trg_apply_paid_invoice_pending_plan();

GRANT EXECUTE ON FUNCTION app.apply_paid_invoice_pending_plan(uuid) TO imdssa_app;

COMMIT;
