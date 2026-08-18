BEGIN;

ALTER TABLE app.billing_invoices
  ADD COLUMN IF NOT EXISTS payment_provider text,
  ADD COLUMN IF NOT EXISTS provider_order_id text,
  ADD COLUMN IF NOT EXISTS checkout_url text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_invoices_provider_order
  ON app.billing_invoices(payment_provider,provider_order_id)
  WHERE payment_provider IS NOT NULL AND provider_order_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS app.billing_provider_events (
  id bigserial PRIMARY KEY,
  provider text NOT NULL,
  event_type text NOT NULL,
  event_reference text NOT NULL,
  invoice_id uuid REFERENCES app.billing_invoices(id) ON DELETE SET NULL,
  payment_id uuid REFERENCES app.billing_payments(id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  processed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider,event_type,event_reference)
);

CREATE INDEX IF NOT EXISTS idx_billing_provider_events_invoice
  ON app.billing_provider_events(invoice_id,created_at DESC);

CREATE OR REPLACE FUNCTION app.record_verified_billing_payment(
  p_invoice_id uuid,
  p_method text,
  p_amount_kzt numeric,
  p_external_reference text,
  p_payer_name text DEFAULT NULL,
  p_received_at timestamptz DEFAULT now(),
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=app,pg_temp
AS $$
DECLARE
  inv app.billing_invoices%ROWTYPE;
  existing_payment app.billing_payments%ROWTYPE;
  existing_invoice_id uuid;
  payment_id uuid;
  payment_number text;
  outstanding numeric(14,2);
  paid_total numeric(14,2);
  next_status text;
  sub app.product_subscriptions%ROWTYPE;
  period_anchor timestamptz;
  period_start timestamptz;
  period_end timestamptz;
BEGIN
  IF p_method NOT IN ('bank_transfer','kaspi','card','cash','manual','other') THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_METHOD';
  END IF;
  IF p_amount_kzt IS NULL OR p_amount_kzt <= 0 THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_AMOUNT';
  END IF;
  IF nullif(btrim(p_external_reference),'') IS NULL THEN
    RAISE EXCEPTION 'EXTERNAL_REFERENCE_REQUIRED';
  END IF;

  SELECT * INTO inv FROM app.billing_invoices WHERE id=p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND'; END IF;

  SELECT p.* INTO existing_payment
  FROM app.billing_payments p
  WHERE p.organization_id=inv.organization_id AND p.external_reference=p_external_reference
  LIMIT 1;

  IF FOUND THEN
    SELECT a.invoice_id INTO existing_invoice_id
    FROM app.billing_payment_allocations a
    WHERE a.payment_id=existing_payment.id
    ORDER BY a.created_at
    LIMIT 1;
    IF existing_invoice_id IS DISTINCT FROM p_invoice_id OR abs(existing_payment.amount_kzt-p_amount_kzt) > 0.001 THEN
      RAISE EXCEPTION 'PAYMENT_REFERENCE_CONFLICT';
    END IF;
    RETURN jsonb_build_object(
      'idempotent',true,
      'paymentId',existing_payment.id,
      'paymentNumber',existing_payment.payment_number,
      'invoiceId',p_invoice_id,
      'invoiceStatus',inv.status
    );
  END IF;

  IF inv.status IN ('draft','void','written_off') THEN RAISE EXCEPTION 'INVOICE_CANNOT_RECEIVE_PAYMENT'; END IF;
  outstanding := inv.total_kzt-inv.paid_total_kzt;
  IF outstanding <= 0 THEN RAISE EXCEPTION 'INVOICE_ALREADY_PAID'; END IF;
  IF p_amount_kzt > outstanding + 0.001 THEN RAISE EXCEPTION 'PAYMENT_EXCEEDS_OUTSTANDING'; END IF;

  payment_number := app.next_billing_document_number('PAY-','payment');
  INSERT INTO app.billing_payments(
    billing_account_id,organization_id,payment_number,status,method,currency,amount_kzt,
    external_reference,payer_name,received_at,recorded_by,metadata
  ) VALUES(
    inv.billing_account_id,inv.organization_id,payment_number,'succeeded',p_method,'KZT',p_amount_kzt,
    p_external_reference,nullif(btrim(p_payer_name),''),coalesce(p_received_at,now()),NULL,coalesce(p_metadata,'{}'::jsonb)
  ) RETURNING id INTO payment_id;

  INSERT INTO app.billing_payment_allocations(payment_id,invoice_id,amount_kzt,created_by)
  VALUES(payment_id,p_invoice_id,p_amount_kzt,NULL);

  SELECT coalesce(sum(a.amount_kzt),0)
  INTO paid_total
  FROM app.billing_payment_allocations a
  JOIN app.billing_payments p ON p.id=a.payment_id
  WHERE a.invoice_id=p_invoice_id AND p.status IN ('succeeded','partially_refunded');

  next_status := CASE
    WHEN paid_total >= inv.total_kzt AND inv.total_kzt > 0 THEN 'paid'
    WHEN paid_total > 0 THEN 'partially_paid'
    WHEN inv.due_at IS NOT NULL AND inv.due_at < now() THEN 'overdue'
    ELSE 'issued'
  END;

  UPDATE app.billing_invoices
  SET paid_total_kzt=paid_total,
      status=next_status,
      paid_at=CASE WHEN next_status='paid' THEN coalesce(paid_at,now()) ELSE NULL END,
      updated_at=now()
  WHERE id=p_invoice_id;

  INSERT INTO app.billing_events(organization_id,subscription_id,invoice_id,payment_id,event_type,payload)
  VALUES(inv.organization_id,inv.subscription_id,p_invoice_id,payment_id,'payment.provider_verified',jsonb_build_object(
    'paymentNumber',payment_number,'amountKzt',p_amount_kzt,'method',p_method,'externalReference',p_external_reference
  ));

  IF next_status='paid' AND inv.status IS DISTINCT FROM 'paid' THEN
    SELECT * INTO sub FROM app.product_subscriptions WHERE id=inv.subscription_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'SUBSCRIPTION_NOT_FOUND'; END IF;

    period_anchor := CASE WHEN sub.current_period_end IS NOT NULL AND sub.current_period_end > now() THEN sub.current_period_end ELSE now() END;
    period_start := CASE WHEN sub.current_period_end IS NOT NULL AND sub.current_period_end > now() THEN coalesce(sub.current_period_start,now()) ELSE now() END;
    period_end := period_anchor + make_interval(months => coalesce(sub.billing_period_months,1));

    UPDATE app.product_subscriptions
    SET status='active',
        trial_started_at=NULL,
        trial_ends_at=NULL,
        current_period_start=period_start,
        current_period_end=period_end,
        lifecycle_stage_started_at=now(),
        grace_ends_at=NULL,
        access_ends_at=period_end,
        updated_at=now()
    WHERE id=sub.id;

    UPDATE app.organization_products
    SET status='active'::app.installation_status,
        config=config || jsonb_build_object(
          'subscriptionStatus','active',
          'subscriptionId',sub.id::text,
          'billingInvoiceId',p_invoice_id::text,
          'currentPeriodEnd',period_end,
          'accessEndsAt',period_end
        ),
        updated_at=now()
    WHERE organization_id=sub.organization_id AND product_id=sub.product_id;

    INSERT INTO app.product_subscription_events(subscription_id,event_type,payload)
    VALUES(sub.id,'subscription.provider_payment_activated',jsonb_build_object(
      'invoiceId',p_invoice_id,'paymentId',payment_id,'periodEnd',period_end,'externalReference',p_external_reference
    ));

    INSERT INTO app.billing_events(organization_id,subscription_id,invoice_id,payment_id,event_type,payload)
    VALUES(sub.organization_id,sub.id,p_invoice_id,payment_id,'subscription.activated_from_provider_payment',jsonb_build_object(
      'periodStart',period_start,'periodEnd',period_end,'externalReference',p_external_reference
    ));
  END IF;

  RETURN jsonb_build_object(
    'idempotent',false,
    'paymentId',payment_id,
    'paymentNumber',payment_number,
    'invoiceId',p_invoice_id,
    'invoiceStatus',next_status,
    'paidTotalKzt',paid_total
  );
END;
$$;

CREATE OR REPLACE FUNCTION app.trg_queue_subscription_sync()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=app,pg_temp
AS $$
DECLARE
  target_org uuid;
  target_product uuid;
BEGIN
  target_org := CASE WHEN TG_OP='DELETE' THEN OLD.organization_id ELSE NEW.organization_id END;
  target_product := CASE WHEN TG_OP='DELETE' THEN OLD.product_id ELSE NEW.product_id END;

  IF TG_OP='UPDATE' AND ROW(
    NEW.plan_id,NEW.plan_revision,NEW.status,NEW.billing_period_months,NEW.currency,
    NEW.base_price_kzt,NEW.addons_price_kzt,NEW.custom_price_kzt,NEW.payment_method,
    NEW.renewal_mode,NEW.trial_started_at,NEW.trial_ends_at,NEW.current_period_start,
    NEW.current_period_end,NEW.grace_ends_at,NEW.access_ends_at,NEW.limits,NEW.plan_snapshot
  ) IS NOT DISTINCT FROM ROW(
    OLD.plan_id,OLD.plan_revision,OLD.status,OLD.billing_period_months,OLD.currency,
    OLD.base_price_kzt,OLD.addons_price_kzt,OLD.custom_price_kzt,OLD.payment_method,
    OLD.renewal_mode,OLD.trial_started_at,OLD.trial_ends_at,OLD.current_period_start,
    OLD.current_period_end,OLD.grace_ends_at,OLD.access_ends_at,OLD.limits,OLD.plan_snapshot
  ) THEN
    RETURN NEW;
  END IF;

  PERFORM app.queue_product_sync(target_org,target_product,'product_subscription.' || lower(TG_OP));
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS control_sync_product_subscriptions ON app.product_subscriptions;
CREATE TRIGGER control_sync_product_subscriptions
AFTER INSERT OR UPDATE OR DELETE ON app.product_subscriptions
FOR EACH ROW EXECUTE FUNCTION app.trg_queue_subscription_sync();

GRANT SELECT,INSERT,UPDATE ON app.billing_provider_events TO imdssa_app;
GRANT USAGE,SELECT ON SEQUENCE app.billing_provider_events_id_seq TO imdssa_app;
GRANT EXECUTE ON FUNCTION app.record_verified_billing_payment(uuid,text,numeric,text,text,timestamptz,jsonb) TO imdssa_app;

COMMIT;
