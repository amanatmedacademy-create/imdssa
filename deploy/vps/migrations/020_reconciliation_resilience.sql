BEGIN;

CREATE OR REPLACE FUNCTION app.reconcile_billing_state(p_provider text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=app,pg_temp
AS $$
DECLARE
  v_run_id uuid;
  linked_payments integer := 0;
  linked_refunds integer := 0;
  repaired_payments integer := 0;
  recalculated_invoices integer := 0;
  unmatched_events integer := 0;
  invoice_errors integer := 0;
  item record;
  error_message text;
BEGIN
  INSERT INTO app.billing_reconciliation_runs(provider,status)
  VALUES(nullif(btrim(p_provider),''),'running')
  RETURNING id INTO v_run_id;

  BEGIN
    UPDATE app.billing_provider_events e
    SET payment_id=p.id,processed_at=now()
    FROM app.billing_payments p
    WHERE e.payment_id IS NULL
      AND e.event_type IN ('pay','payment.succeeded')
      AND (p_provider IS NULL OR e.provider=p_provider)
      AND p.external_reference=e.provider||':'||e.event_reference;
    GET DIAGNOSTICS linked_payments = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS error_message = MESSAGE_TEXT;
    INSERT INTO app.billing_reconciliation_issues(run_id,provider,issue_type,severity,issue_key,expected,actual)
    VALUES(v_run_id,p_provider,'payment_linking_failed','error','run:'||v_run_id::text||':payment-linking','{}'::jsonb,jsonb_build_object('error',error_message));
  END;

  BEGIN
    UPDATE app.billing_provider_events e
    SET refund_id=r.id,processed_at=now()
    FROM app.billing_refunds r
    WHERE e.refund_id IS NULL
      AND e.event_type='refund'
      AND (p_provider IS NULL OR e.provider=p_provider)
      AND r.provider=e.provider AND r.external_reference=e.event_reference;
    GET DIAGNOSTICS linked_refunds = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS error_message = MESSAGE_TEXT;
    INSERT INTO app.billing_reconciliation_issues(run_id,provider,issue_type,severity,issue_key,expected,actual)
    VALUES(v_run_id,p_provider,'refund_linking_failed','error','run:'||v_run_id::text||':refund-linking','{}'::jsonb,jsonb_build_object('error',error_message));
  END;

  BEGIN
    WITH totals AS (
      SELECT p.id,coalesce(sum(r.amount_kzt) filter (where r.status='succeeded'),0) refunded
      FROM app.billing_payments p
      LEFT JOIN app.billing_refunds r ON r.payment_id=p.id
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
    WHERE p.id=t.id AND (
      p.refunded_total_kzt IS DISTINCT FROM t.refunded
      OR p.status IS DISTINCT FROM CASE
        WHEN p.status IN ('failed','cancelled') THEN p.status
        WHEN t.refunded>=p.amount_kzt AND t.refunded>0 THEN 'refunded'
        WHEN t.refunded>0 THEN 'partially_refunded'
        WHEN p.status IN ('refunded','partially_refunded') THEN 'succeeded'
        ELSE p.status END
    );
    GET DIAGNOSTICS repaired_payments = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS error_message = MESSAGE_TEXT;
    INSERT INTO app.billing_reconciliation_issues(run_id,provider,issue_type,severity,issue_key,expected,actual)
    VALUES(v_run_id,p_provider,'payment_totals_repair_failed','error','run:'||v_run_id::text||':payment-totals','{}'::jsonb,jsonb_build_object('error',error_message));
  END;

  FOR item IN
    SELECT DISTINCT a.invoice_id
    FROM app.billing_payment_allocations a
    UNION
    SELECT id FROM app.billing_invoices WHERE status IN ('issued','partially_paid','paid','overdue')
  LOOP
    BEGIN
      PERFORM app.recalculate_billing_invoice(item.invoice_id);
      recalculated_invoices := recalculated_invoices+1;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS error_message = MESSAGE_TEXT;
      invoice_errors := invoice_errors+1;
      INSERT INTO app.billing_reconciliation_issues(
        run_id,provider,issue_type,severity,issue_key,invoice_id,expected,actual
      ) VALUES(
        v_run_id,p_provider,'invoice_recalculation_failed','error',
        'invoice:'||item.invoice_id::text,item.invoice_id,
        jsonb_build_object('recalculated',true),jsonb_build_object('error',error_message)
      ) ON CONFLICT(run_id,issue_key) DO NOTHING;
    END;
  END LOOP;

  BEGIN
    INSERT INTO app.billing_reconciliation_issues(
      run_id,provider,issue_type,severity,issue_key,organization_id,invoice_id,payment_id,provider_event_id,expected,actual
    )
    SELECT v_run_id,e.provider,'provider_event_unlinked','error',e.provider||':'||e.event_type||':'||e.event_reference,
           i.organization_id,e.invoice_id,e.payment_id,e.id,
           jsonb_build_object('linked',true),jsonb_build_object('eventType',e.event_type,'eventReference',e.event_reference)
    FROM app.billing_provider_events e
    LEFT JOIN app.billing_invoices i ON i.id=e.invoice_id
    WHERE (p_provider IS NULL OR e.provider=p_provider)
      AND ((e.event_type IN ('pay','payment.succeeded') AND e.payment_id IS NULL)
        OR (e.event_type='refund' AND e.refund_id IS NULL))
    ON CONFLICT(run_id,issue_key) DO NOTHING;
    GET DIAGNOSTICS unmatched_events = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS error_message = MESSAGE_TEXT;
    INSERT INTO app.billing_reconciliation_issues(run_id,provider,issue_type,severity,issue_key,expected,actual)
    VALUES(v_run_id,p_provider,'provider_issue_scan_failed','error','run:'||v_run_id::text||':provider-scan','{}'::jsonb,jsonb_build_object('error',error_message));
  END;

  UPDATE app.billing_reconciliation_runs
  SET status='completed',completed_at=now(),summary=jsonb_build_object(
    'linkedPayments',linked_payments,
    'linkedRefunds',linked_refunds,
    'repairedPayments',repaired_payments,
    'recalculatedInvoices',recalculated_invoices,
    'invoiceErrors',invoice_errors,
    'unmatchedEvents',unmatched_events
  )
  WHERE id=v_run_id;

  RETURN jsonb_build_object(
    'runId',v_run_id,
    'status','completed',
    'linkedPayments',linked_payments,
    'linkedRefunds',linked_refunds,
    'repairedPayments',repaired_payments,
    'recalculatedInvoices',recalculated_invoices,
    'invoiceErrors',invoice_errors,
    'unmatchedEvents',unmatched_events,
    'checkedAt',now()
  );
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS error_message = MESSAGE_TEXT;
  IF v_run_id IS NOT NULL THEN
    UPDATE app.billing_reconciliation_runs
    SET status='failed',completed_at=now(),summary=jsonb_build_object('error',error_message)
    WHERE id=v_run_id;
  END IF;
  RETURN jsonb_build_object('runId',v_run_id,'status','failed','error',error_message,'checkedAt',now());
END;
$$;

GRANT EXECUTE ON FUNCTION app.reconcile_billing_state(text) TO imdssa_app;

COMMIT;
