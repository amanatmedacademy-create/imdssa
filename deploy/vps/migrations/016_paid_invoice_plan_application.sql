BEGIN;

CREATE OR REPLACE FUNCTION app.apply_paid_invoice_subscription(p_invoice_id uuid, p_actor_user_id uuid DEFAULT NULL)
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
  period_start timestamptz;
  period_end timestamptz;
  base_price numeric(14,2);
  new_limits jsonb;
  enabled_module_ids uuid[] := ARRAY[]::uuid[];
  item record;
BEGIN
  SELECT * INTO inv FROM app.billing_invoices WHERE id=p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND'; END IF;
  IF inv.status <> 'paid' OR inv.paid_total_kzt < inv.total_kzt THEN RAISE EXCEPTION 'INVOICE_NOT_PAID'; END IF;

  SELECT * INTO sub FROM app.product_subscriptions WHERE id=inv.subscription_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SUBSCRIPTION_NOT_FOUND'; END IF;

  pending_plan_id := NULLIF(inv.pricing_snapshot->>'pendingPlanId','')::uuid;
  months := COALESCE(NULLIF(inv.pricing_snapshot->>'pendingBillingPeriodMonths','')::integer,sub.billing_period_months,1);
  IF months NOT IN (1,3,6,12) THEN RAISE EXCEPTION 'INVALID_BILLING_PERIOD'; END IF;

  period_start := CASE WHEN sub.current_period_end IS NOT NULL AND sub.current_period_end > now() THEN sub.current_period_end ELSE now() END;
  period_end := period_start + make_interval(months => months);

  IF pending_plan_id IS NOT NULL THEN
    SELECT * INTO plan_row FROM app.product_plans WHERE id=pending_plan_id AND product_id=sub.product_id AND status='published' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PENDING_PLAN_NOT_AVAILABLE'; END IF;
    IF plan_row.pricing_mode <> 'fixed' THEN RAISE EXCEPTION 'REQUEST_PRICED_PLAN_REQUIRES_ADMIN'; END IF;

    SELECT amount_kzt INTO base_price FROM app.product_plan_prices WHERE plan_id=plan_row.id AND months=months;
    IF base_price IS NULL THEN RAISE EXCEPTION 'PLAN_PRICE_NOT_CONFIGURED_FOR_PERIOD'; END IF;
    new_limits := COALESCE(plan_row.limits,'{}'::jsonb);

    UPDATE app.product_subscriptions
    SET plan_id=plan_row.id,
        plan_revision=plan_row.revision,
        status='active',
        billing_period_months=months,
        currency='KZT',
        base_price_kzt=base_price,
        addons_price_kzt=0,
        custom_price_kzt=NULL,
        trial_started_at=NULL,
        trial_ends_at=NULL,
        current_period_start=period_start,
        current_period_end=period_end,
        lifecycle_stage_started_at=now(),
        grace_ends_at=NULL,
        access_ends_at=period_end,
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
  ELSE
    new_limits := sub.limits;
    UPDATE app.product_subscriptions
    SET status='active',trial_started_at=NULL,trial_ends_at=NULL,current_period_start=period_start,current_period_end=period_end,
        lifecycle_stage_started_at=now(),grace_ends_at=NULL,access_ends_at=period_end,updated_at=now()
    WHERE id=sub.id;
  END IF;

  UPDATE app.organization_products
  SET status='active'::app.installation_status,
      config=config || jsonb_build_object(
        'subscriptionStatus','active','subscriptionId',sub.id::text,'billingInvoiceId',p_invoice_id::text,
        'limits',COALESCE(new_limits,'{}'::jsonb),'currentPeriodEnd',period_end,'accessEndsAt',period_end
      ),updated_at=now()
  WHERE organization_id=sub.organization_id AND product_id=sub.product_id;

  INSERT INTO app.product_subscription_events(subscription_id,event_type,payload,actor_user_id)
  VALUES(sub.id,'subscription.payment_activated',jsonb_build_object('invoiceId',p_invoice_id,'periodStart',period_start,'periodEnd',period_end,'planId',pending_plan_id),p_actor_user_id);

  INSERT INTO app.billing_events(organization_id,subscription_id,invoice_id,event_type,payload,actor_user_id)
  VALUES(sub.organization_id,sub.id,p_invoice_id,'subscription.activated_from_payment',jsonb_build_object('periodStart',period_start,'periodEnd',period_end,'planId',pending_plan_id),p_actor_user_id);

  RETURN jsonb_build_object('subscriptionId',sub.id,'status','active','periodStart',period_start,'periodEnd',period_end,'planId',pending_plan_id);
END;
$$;

GRANT EXECUTE ON FUNCTION app.apply_paid_invoice_subscription(uuid,uuid) TO imdssa_app;

COMMIT;
