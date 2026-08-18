BEGIN;

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
  effective_paid numeric(14,2);
  outstanding numeric(14,2);
  invoice_result jsonb;
BEGIN
  IF p_method NOT IN ('bank_transfer','kaspi','card','cash','manual','other') THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_METHOD';
  END IF;
  IF p_amount_kzt IS NULL OR p_amount_kzt <= 0 THEN RAISE EXCEPTION 'INVALID_PAYMENT_AMOUNT'; END IF;
  IF nullif(btrim(p_external_reference),'') IS NULL THEN RAISE EXCEPTION 'EXTERNAL_REFERENCE_REQUIRED'; END IF;

  SELECT * INTO inv FROM app.billing_invoices WHERE id=p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND'; END IF;

  SELECT p.* INTO existing_payment
  FROM app.billing_payments p
  WHERE p.organization_id=inv.organization_id AND p.external_reference=p_external_reference
  LIMIT 1;
  IF FOUND THEN
    SELECT a.invoice_id INTO existing_invoice_id
    FROM app.billing_payment_allocations a WHERE a.payment_id=existing_payment.id ORDER BY a.created_at LIMIT 1;
    IF existing_invoice_id IS DISTINCT FROM p_invoice_id OR abs(existing_payment.amount_kzt-p_amount_kzt)>0.001 THEN
      RAISE EXCEPTION 'PAYMENT_REFERENCE_CONFLICT';
    END IF;
    RETURN jsonb_build_object('idempotent',true,'paymentId',existing_payment.id,'paymentNumber',existing_payment.payment_number,'invoiceId',p_invoice_id,'invoiceStatus',inv.status);
  END IF;

  IF inv.status IN ('draft','void','written_off') THEN RAISE EXCEPTION 'INVOICE_CANNOT_RECEIVE_PAYMENT'; END IF;

  SELECT coalesce(sum(greatest(a.amount_kzt-coalesce(r.refunded_kzt,0),0)),0)
  INTO effective_paid
  FROM app.billing_payment_allocations a
  JOIN app.billing_payments p ON p.id=a.payment_id
  LEFT JOIN (
    SELECT payment_id,invoice_id,sum(amount_kzt) refunded_kzt
    FROM app.billing_refunds WHERE status='succeeded'
    GROUP BY payment_id,invoice_id
  ) r ON r.payment_id=a.payment_id AND r.invoice_id=a.invoice_id
  WHERE a.invoice_id=p_invoice_id AND p.status IN ('succeeded','partially_refunded','refunded');

  outstanding := greatest(inv.total_kzt-effective_paid,0);
  IF outstanding<=0 THEN RAISE EXCEPTION 'INVOICE_ALREADY_PAID'; END IF;
  IF p_amount_kzt>outstanding+0.001 THEN RAISE EXCEPTION 'PAYMENT_EXCEEDS_OUTSTANDING'; END IF;

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

  INSERT INTO app.billing_events(organization_id,subscription_id,invoice_id,payment_id,event_type,payload)
  VALUES(inv.organization_id,inv.subscription_id,p_invoice_id,payment_id,'payment.provider_verified',jsonb_build_object(
    'paymentNumber',payment_number,'amountKzt',p_amount_kzt,'method',p_method,'externalReference',p_external_reference
  ));

  invoice_result := app.recalculate_billing_invoice(p_invoice_id);

  RETURN jsonb_build_object(
    'idempotent',false,'paymentId',payment_id,'paymentNumber',payment_number,
    'invoiceId',p_invoice_id,'invoiceStatus',invoice_result->>'status','paidTotalKzt',invoice_result->'effectivePaidKzt'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION app.record_verified_billing_payment(uuid,text,numeric,text,text,timestamptz,jsonb) TO imdssa_app;

COMMIT;
