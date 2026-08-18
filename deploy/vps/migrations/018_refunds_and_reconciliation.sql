BEGIN;

ALTER TABLE app.billing_payments
  ADD COLUMN IF NOT EXISTS refunded_total_kzt numeric(14,2) NOT NULL DEFAULT 0
  CHECK (refunded_total_kzt >= 0 AND refunded_total_kzt <= amount_kzt);

CREATE TABLE IF NOT EXISTS app.billing_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES app.organizations(id) ON DELETE CASCADE,
  payment_id uuid NOT NULL REFERENCES app.billing_payments(id) ON DELETE RESTRICT,
  invoice_id uuid NOT NULL REFERENCES app.billing_invoices(id) ON DELETE RESTRICT,
  refund_number text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'succeeded' CHECK (status IN ('succeeded','failed','cancelled')),
  provider text NOT NULL,
  currency text NOT NULL DEFAULT 'KZT' CHECK (currency='KZT'),
  amount_kzt numeric(14,2) NOT NULL CHECK (amount_kzt > 0),
  original_payment_reference text NOT NULL,
  external_reference text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid REFERENCES app.platform_users(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider,external_reference)
);

CREATE INDEX IF NOT EXISTS idx_billing_refunds_payment ON app.billing_refunds(payment_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_refunds_invoice ON app.billing_refunds(invoice_id,created_at DESC);

ALTER TABLE app.billing_provider_events
  ADD COLUMN IF NOT EXISTS refund_id uuid REFERENCES app.billing_refunds(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS app.billing_reconciliation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed')),
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS app.billing_reconciliation_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES app.billing_reconciliation_runs(id) ON DELETE CASCADE,
  provider text,
  issue_type text NOT NULL,
  severity text NOT NULL DEFAULT 'warning' CHECK (severity IN ('info','warning','error')),
  issue_key text NOT NULL,
  organization_id uuid REFERENCES app.organizations(id) ON DELETE SET NULL,
  invoice_id uuid REFERENCES app.billing_invoices(id) ON DELETE SET NULL,
  payment_id uuid REFERENCES app.billing_payments(id) ON DELETE SET NULL,
  provider_event_id bigint REFERENCES app.billing_provider_events(id) ON DELETE SET NULL,
  expected jsonb NOT NULL DEFAULT '{}'::jsonb,
  actual jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','ignored')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE(run_id,issue_key)
);

CREATE INDEX IF NOT EXISTS idx_billing_reconciliation_runs_started ON app.billing_reconciliation_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_reconciliation_issues_run ON app.billing_reconciliation_issues(run_id,severity,status);

CREATE OR REPLACE FUNCTION app.next_billing_document_number(p_prefix text, p_table text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=app,pg_temp AS $$
DECLARE result text; seq bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_prefix || ':' || to_char(now(),'YYYYMM'), 314159));
  IF p_table='invoice' THEN SELECT count(*)+1 INTO seq FROM app.billing_invoices WHERE created_at>=date_trunc('month',now());
  ELSIF p_table='payment' THEN SELECT count(*)+1 INTO seq FROM app.billing_payments WHERE created_at>=date_trunc('month',now());
  ELSIF p_table='refund' THEN SELECT count(*)+1 INTO seq FROM app.billing_refunds WHERE created_at>=date_trunc('month',now());
  ELSE RAISE EXCEPTION 'Unsupported billing document type'; END IF;
  result := p_prefix || to_char(now(),'YYYYMM') || '-' || lpad(seq::text,5,'0');
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION app.recalculate_billing_invoice(p_invoice_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=app,pg_temp
AS $$
DECLARE
  inv app.billing_invoices%ROWTYPE;
  sub app.product_subscriptions%ROWTYPE;
  effective_paid numeric(14,2);
  previous_status text;
  next_status text;
  later_paid boolean := false;
  current_coverage boolean := false;
  past_due_days integer := 1;
  grace_days integer := 3;
  read_only_days integer := 3;
  next_grace timestamptz;
  next_access timestamptz;
BEGIN
  SELECT * INTO inv FROM app.billing_invoices WHERE id=p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND'; END IF;
  previous_status := inv.status;

  SELECT coalesce(sum(greatest(a.amount_kzt-coalesce(r.refunded_kzt,0),0)),0)
  INTO effective_paid
  FROM app.billing_payment_allocations a
  JOIN app.billing_payments p ON p.id=a.payment_id
  LEFT JOIN (
    SELECT payment_id,invoice_id,sum(amount_kzt) refunded_kzt
    FROM app.billing_refunds
    WHERE status='succeeded'
    GROUP BY payment_id,invoice_id
  ) r ON r.payment_id=a.payment_id AND r.invoice_id=a.invoice_id
  WHERE a.invoice_id=p_invoice_id
    AND p.status IN ('succeeded','partially_refunded','refunded');

  IF inv.status IN ('void','written_off','draft') AND effective_paid=0 THEN
    next_status := inv.status;
  ELSE
    next_status := CASE
      WHEN effective_paid >= inv.total_kzt AND inv.total_kzt > 0 THEN 'paid'
      WHEN effective_paid > 0 THEN 'partially_paid'
      WHEN inv.due_at IS NOT NULL AND inv.due_at < now() THEN 'overdue'
      ELSE 'issued'
    END;
  END IF;

  UPDATE app.billing_invoices
  SET paid_total_kzt=least(effective_paid,total_kzt),
      status=next_status,
      paid_at=CASE WHEN next_status='paid' THEN coalesce(paid_at,now()) ELSE NULL END,
      updated_at=now()
  WHERE id=p_invoice_id;

  IF previous_status='paid' AND next_status<>'paid' THEN
    SELECT * INTO sub FROM app.product_subscriptions WHERE id=inv.subscription_id FOR UPDATE;
    IF FOUND AND sub.status NOT IN ('free','beta','canceled','expired') THEN
      SELECT EXISTS(
        SELECT 1 FROM app.billing_invoices newer
        WHERE newer.subscription_id=inv.subscription_id
          AND newer.id<>inv.id
          AND newer.status='paid'
          AND (
            (inv.period_end IS NOT NULL AND newer.period_end IS NOT NULL AND newer.period_end>inv.period_end)
            OR (inv.paid_at IS NOT NULL AND newer.paid_at IS NOT NULL AND newer.paid_at>inv.paid_at)
          )
      ) INTO later_paid;
      current_coverage := sub.current_period_end IS NULL OR inv.period_end IS NULL OR inv.period_end >= sub.current_period_end - interval '1 second';

      IF current_coverage AND NOT later_paid THEN
        SELECT
          coalesce((select s.past_due_days from app.product_commercial_settings s where s.product_id=sub.product_id),1),
          coalesce((select s.grace_days from app.product_commercial_settings s where s.product_id=sub.product_id),3),
          coalesce((select s.read_only_days from app.product_commercial_settings s where s.product_id=sub.product_id),3)
        INTO past_due_days,grace_days,read_only_days;
        next_grace := now()+make_interval(days=>past_due_days+grace_days);
        next_access := now()+make_interval(days=>past_due_days+grace_days+read_only_days);

        UPDATE app.product_subscriptions
        SET status='past_due',lifecycle_stage_started_at=now(),grace_ends_at=next_grace,access_ends_at=next_access,updated_at=now()
        WHERE id=sub.id;
        UPDATE app.organization_products
        SET status='active'::app.installation_status,
            config=config || jsonb_build_object('subscriptionStatus','past_due','billingInvoiceId',inv.id::text,'graceEndsAt',next_grace,'accessEndsAt',next_access),
            updated_at=now()
        WHERE organization_id=sub.organization_id AND product_id=sub.product_id;
        INSERT INTO app.product_subscription_events(subscription_id,event_type,payload)
        VALUES(sub.id,'subscription.refund_past_due',jsonb_build_object('invoiceId',inv.id,'invoiceStatus',next_status,'effectivePaidKzt',effective_paid,'graceEndsAt',next_grace,'accessEndsAt',next_access));
        INSERT INTO app.billing_events(organization_id,subscription_id,invoice_id,event_type,payload)
        VALUES(sub.organization_id,sub.id,inv.id,'subscription.past_due_after_refund',jsonb_build_object('invoiceStatus',next_status,'effectivePaidKzt',effective_paid));
      END IF;
    END IF;
  ELSIF previous_status<>'paid' AND next_status='paid' THEN
    SELECT * INTO sub FROM app.product_subscriptions WHERE id=inv.subscription_id FOR UPDATE;
    IF FOUND AND sub.status NOT IN ('free','beta','canceled') THEN
      SELECT EXISTS(
        SELECT 1 FROM app.billing_invoices newer
        WHERE newer.subscription_id=inv.subscription_id AND newer.id<>inv.id AND newer.status='paid'
          AND inv.period_end IS NOT NULL AND newer.period_end IS NOT NULL AND newer.period_end>inv.period_end
      ) INTO later_paid;
      IF NOT later_paid AND (sub.current_period_end IS NULL OR inv.period_end IS NULL OR inv.period_end>=sub.current_period_end) THEN
        UPDATE app.product_subscriptions
        SET status='active',trial_started_at=NULL,trial_ends_at=NULL,
            current_period_start=coalesce(inv.period_start,now()),
            current_period_end=coalesce(inv.period_end,now()+make_interval(months=>coalesce(sub.billing_period_months,1))),
            lifecycle_stage_started_at=now(),grace_ends_at=NULL,
            access_ends_at=coalesce(inv.period_end,now()+make_interval(months=>coalesce(sub.billing_period_months,1))),updated_at=now()
        WHERE id=sub.id;
        UPDATE app.organization_products
        SET status='active'::app.installation_status,
            config=config || jsonb_build_object('subscriptionStatus','active','billingInvoiceId',inv.id::text),updated_at=now()
        WHERE organization_id=sub.organization_id AND product_id=sub.product_id;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('invoiceId',p_invoice_id,'previousStatus',previous_status,'status',next_status,'effectivePaidKzt',effective_paid);
END;
$$;

CREATE OR REPLACE FUNCTION app.record_verified_billing_refund(
  p_provider text,
  p_original_payment_reference text,
  p_refund_reference text,
  p_amount_kzt numeric,
  p_invoice_id uuid DEFAULT NULL,
  p_received_at timestamptz DEFAULT now(),
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=app,pg_temp
AS $$
DECLARE
  payment app.billing_payments%ROWTYPE;
  target_invoice_id uuid;
  allocation_amount numeric(14,2);
  allocation_count integer;
  already_refunded numeric(14,2);
  total_refunded numeric(14,2);
  refund_id uuid;
  refund_number text;
  existing app.billing_refunds%ROWTYPE;
  invoice_result jsonb;
BEGIN
  IF nullif(btrim(p_provider),'') IS NULL OR nullif(btrim(p_original_payment_reference),'') IS NULL OR nullif(btrim(p_refund_reference),'') IS NULL THEN
    RAISE EXCEPTION 'REFUND_REFERENCES_REQUIRED';
  END IF;
  IF p_amount_kzt IS NULL OR p_amount_kzt<=0 THEN RAISE EXCEPTION 'INVALID_REFUND_AMOUNT'; END IF;

  SELECT * INTO existing FROM app.billing_refunds WHERE provider=p_provider AND external_reference=p_refund_reference LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('idempotent',true,'refundId',existing.id,'refundNumber',existing.refund_number,'invoiceId',existing.invoice_id,'paymentId',existing.payment_id);
  END IF;

  SELECT * INTO payment FROM app.billing_payments
  WHERE external_reference=p_original_payment_reference AND status IN ('succeeded','partially_refunded','refunded')
  ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ORIGINAL_PAYMENT_NOT_FOUND'; END IF;

  IF p_invoice_id IS NOT NULL THEN
    SELECT a.invoice_id,a.amount_kzt INTO target_invoice_id,allocation_amount
    FROM app.billing_payment_allocations a WHERE a.payment_id=payment.id AND a.invoice_id=p_invoice_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_INVOICE_ALLOCATION_NOT_FOUND'; END IF;
  ELSE
    SELECT count(*)::int INTO allocation_count FROM app.billing_payment_allocations a WHERE a.payment_id=payment.id;
    IF allocation_count<>1 THEN RAISE EXCEPTION 'REFUND_INVOICE_REQUIRED_FOR_MULTI_ALLOCATION_PAYMENT'; END IF;
    SELECT a.invoice_id,a.amount_kzt INTO target_invoice_id,allocation_amount
    FROM app.billing_payment_allocations a WHERE a.payment_id=payment.id LIMIT 1 FOR UPDATE;
  END IF;

  SELECT coalesce(sum(r.amount_kzt),0) INTO already_refunded
  FROM app.billing_refunds r
  WHERE r.payment_id=payment.id AND r.invoice_id=target_invoice_id AND r.status='succeeded';
  IF already_refunded+p_amount_kzt>allocation_amount+0.001 OR payment.refunded_total_kzt+p_amount_kzt>payment.amount_kzt+0.001 THEN
    RAISE EXCEPTION 'REFUND_EXCEEDS_PAYMENT';
  END IF;

  refund_number := app.next_billing_document_number('REF-','refund');
  INSERT INTO app.billing_refunds(
    organization_id,payment_id,invoice_id,refund_number,status,provider,currency,amount_kzt,
    original_payment_reference,external_reference,received_at,metadata
  ) VALUES(
    payment.organization_id,payment.id,target_invoice_id,refund_number,'succeeded',p_provider,'KZT',p_amount_kzt,
    p_original_payment_reference,p_refund_reference,coalesce(p_received_at,now()),coalesce(p_metadata,'{}'::jsonb)
  ) RETURNING id INTO refund_id;

  SELECT coalesce(sum(r.amount_kzt),0) INTO total_refunded
  FROM app.billing_refunds r WHERE r.payment_id=payment.id AND r.status='succeeded';
  UPDATE app.billing_payments
  SET refunded_total_kzt=total_refunded,
      status=CASE WHEN total_refunded>=amount_kzt THEN 'refunded' ELSE 'partially_refunded' END,
      updated_at=now()
  WHERE id=payment.id;

  INSERT INTO app.billing_events(organization_id,invoice_id,payment_id,event_type,payload)
  VALUES(payment.organization_id,target_invoice_id,payment.id,'refund.provider_verified',jsonb_build_object(
    'refundId',refund_id,'refundNumber',refund_number,'provider',p_provider,'amountKzt',p_amount_kzt,
    'originalPaymentReference',p_original_payment_reference,'refundReference',p_refund_reference
  ));

  invoice_result := app.recalculate_billing_invoice(target_invoice_id);
  RETURN jsonb_build_object('idempotent',false,'refundId',refund_id,'refundNumber',refund_number,'paymentId',payment.id,'invoiceId',target_invoice_id,'amountKzt',p_amount_kzt,'invoice',invoice_result);
END;
$$;

CREATE OR REPLACE FUNCTION app.reconcile_billing_state(p_provider text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=app,pg_temp
AS $$
DECLARE
  run_id uuid;
  linked_payments integer := 0;
  linked_refunds integer := 0;
  repaired_payments integer := 0;
  recalculated_invoices integer := 0;
  unmatched_events integer := 0;
  item record;
BEGIN
  INSERT INTO app.billing_reconciliation_runs(provider,status) VALUES(nullif(btrim(p_provider),''),'running') RETURNING id INTO run_id;

  UPDATE app.billing_provider_events e
  SET payment_id=p.id,processed_at=now()
  FROM app.billing_payments p
  WHERE e.payment_id IS NULL
    AND e.event_type IN ('pay','payment.succeeded')
    AND (p_provider IS NULL OR e.provider=p_provider)
    AND p.external_reference=e.provider||':'||e.event_reference;
  GET DIAGNOSTICS linked_payments = ROW_COUNT;

  UPDATE app.billing_provider_events e
  SET refund_id=r.id,processed_at=now()
  FROM app.billing_refunds r
  WHERE e.refund_id IS NULL
    AND e.event_type='refund'
    AND (p_provider IS NULL OR e.provider=p_provider)
    AND r.provider=e.provider AND r.external_reference=e.event_reference;
  GET DIAGNOSTICS linked_refunds = ROW_COUNT;

  WITH totals AS (
    SELECT p.id,coalesce(sum(r.amount_kzt) filter (where r.status='succeeded'),0) refunded
    FROM app.billing_payments p LEFT JOIN app.billing_refunds r ON r.payment_id=p.id
    GROUP BY p.id
  )
  UPDATE app.billing_payments p
  SET refunded_total_kzt=t.refunded,
      status=CASE
        WHEN p.status IN ('failed','cancelled') THEN p.status
        WHEN t.refunded>=p.amount_kzt AND t.refunded>0 THEN 'refunded'
        WHEN t.refunded>0 THEN 'partially_refunded'
        WHEN p.status IN ('refunded','partially_refunded') THEN 'succeeded'
        ELSE p.status END,
      updated_at=now()
  FROM totals t
  WHERE p.id=t.id AND (p.refunded_total_kzt IS DISTINCT FROM t.refunded OR p.status IS DISTINCT FROM CASE
        WHEN p.status IN ('failed','cancelled') THEN p.status
        WHEN t.refunded>=p.amount_kzt AND t.refunded>0 THEN 'refunded'
        WHEN t.refunded>0 THEN 'partially_refunded'
        WHEN p.status IN ('refunded','partially_refunded') THEN 'succeeded'
        ELSE p.status END);
  GET DIAGNOSTICS repaired_payments = ROW_COUNT;

  FOR item IN
    SELECT DISTINCT a.invoice_id
    FROM app.billing_payment_allocations a
    UNION
    SELECT id AS invoice_id FROM app.billing_invoices WHERE status IN ('issued','partially_paid','paid','overdue')
  LOOP
    PERFORM app.recalculate_billing_invoice(item.invoice_id);
    recalculated_invoices := recalculated_invoices+1;
  END LOOP;

  INSERT INTO app.billing_reconciliation_issues(run_id,provider,issue_type,severity,issue_key,organization_id,invoice_id,payment_id,provider_event_id,expected,actual)
  SELECT run_id,e.provider,'provider_event_unlinked','error',e.provider||':'||e.event_type||':'||e.event_reference,
         i.organization_id,e.invoice_id,e.payment_id,e.id,
         jsonb_build_object('linked',true),jsonb_build_object('eventType',e.event_type,'eventReference',e.event_reference)
  FROM app.billing_provider_events e
  LEFT JOIN app.billing_invoices i ON i.id=e.invoice_id
  WHERE (p_provider IS NULL OR e.provider=p_provider)
    AND ((e.event_type IN ('pay','payment.succeeded') AND e.payment_id IS NULL) OR (e.event_type='refund' AND e.refund_id IS NULL))
  ON CONFLICT(run_id,issue_key) DO NOTHING;
  GET DIAGNOSTICS unmatched_events = ROW_COUNT;

  UPDATE app.billing_reconciliation_runs
  SET status='completed',completed_at=now(),summary=jsonb_build_object(
    'linkedPayments',linked_payments,'linkedRefunds',linked_refunds,'repairedPayments',repaired_payments,
    'recalculatedInvoices',recalculated_invoices,'unmatchedEvents',unmatched_events
  ) WHERE id=run_id;

  RETURN jsonb_build_object('runId',run_id,'status','completed','linkedPayments',linked_payments,'linkedRefunds',linked_refunds,
    'repairedPayments',repaired_payments,'recalculatedInvoices',recalculated_invoices,'unmatchedEvents',unmatched_events,'checkedAt',now());
END;
$$;

GRANT SELECT,INSERT,UPDATE,DELETE ON app.billing_refunds TO imdssa_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON app.billing_reconciliation_runs TO imdssa_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON app.billing_reconciliation_issues TO imdssa_app;
GRANT EXECUTE ON FUNCTION app.recalculate_billing_invoice(uuid) TO imdssa_app;
GRANT EXECUTE ON FUNCTION app.record_verified_billing_refund(text,text,text,numeric,uuid,timestamptz,jsonb) TO imdssa_app;
GRANT EXECUTE ON FUNCTION app.reconcile_billing_state(text) TO imdssa_app;

COMMIT;
