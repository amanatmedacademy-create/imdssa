BEGIN;

ALTER TABLE app.product_commercial_settings
  ADD COLUMN IF NOT EXISTS past_due_days integer NOT NULL DEFAULT 1 CHECK (past_due_days BETWEEN 0 AND 30),
  ADD COLUMN IF NOT EXISTS grace_days integer NOT NULL DEFAULT 3 CHECK (grace_days BETWEEN 0 AND 60),
  ADD COLUMN IF NOT EXISTS read_only_days integer NOT NULL DEFAULT 3 CHECK (read_only_days BETWEEN 0 AND 60);

ALTER TABLE app.product_subscriptions
  ADD COLUMN IF NOT EXISTS lifecycle_stage_started_at timestamptz;

CREATE OR REPLACE FUNCTION app.refresh_subscription_lifecycle()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=app,pg_temp
AS $$
DECLARE
  rec record;
  expiry_at timestamptz;
  next_status text;
  next_stage_started_at timestamptz;
  next_grace_ends_at timestamptz;
  next_access_ends_at timestamptz;
  transitioned integer := 0;
  overdue_invoices integer := 0;
BEGIN
  UPDATE app.billing_invoices
  SET status='overdue',updated_at=now()
  WHERE status IN ('issued','partially_paid')
    AND due_at IS NOT NULL
    AND due_at < now()
    AND paid_total_kzt < total_kzt;
  GET DIAGNOSTICS overdue_invoices = ROW_COUNT;

  FOR rec IN
    SELECT s.id,s.organization_id,s.product_id,s.status,s.trial_ends_at,s.current_period_end,
           s.lifecycle_stage_started_at,s.grace_ends_at,s.access_ends_at,
           COALESCE(cs.past_due_days,1) past_due_days,
           COALESCE(cs.grace_days,3) grace_days,
           COALESCE(cs.read_only_days,3) read_only_days
    FROM app.product_subscriptions s
    LEFT JOIN app.product_commercial_settings cs ON cs.product_id=s.product_id
    WHERE s.status IN ('trial','pending_payment','active','past_due','grace','read_only')
    ORDER BY s.updated_at,s.id
    FOR UPDATE OF s SKIP LOCKED
  LOOP
    next_status := NULL;
    next_stage_started_at := rec.lifecycle_stage_started_at;
    next_grace_ends_at := rec.grace_ends_at;
    next_access_ends_at := rec.access_ends_at;

    IF rec.status IN ('trial','pending_payment') THEN
      expiry_at := rec.trial_ends_at;
      IF expiry_at IS NOT NULL AND expiry_at <= now() THEN
        next_status := 'past_due';
        next_stage_started_at := expiry_at;
        next_grace_ends_at := expiry_at + make_interval(days => rec.past_due_days + rec.grace_days);
        next_access_ends_at := expiry_at + make_interval(days => rec.past_due_days + rec.grace_days + rec.read_only_days);
      END IF;
    ELSIF rec.status='active' THEN
      expiry_at := rec.current_period_end;
      IF expiry_at IS NOT NULL AND expiry_at <= now() THEN
        next_status := 'past_due';
        next_stage_started_at := expiry_at;
        next_grace_ends_at := expiry_at + make_interval(days => rec.past_due_days + rec.grace_days);
        next_access_ends_at := expiry_at + make_interval(days => rec.past_due_days + rec.grace_days + rec.read_only_days);
      END IF;
    ELSIF rec.status='past_due' THEN
      expiry_at := COALESCE(rec.lifecycle_stage_started_at,rec.current_period_end,rec.trial_ends_at,now());
      IF expiry_at + make_interval(days => rec.past_due_days) <= now() THEN
        next_status := 'grace';
        next_stage_started_at := expiry_at + make_interval(days => rec.past_due_days);
        next_grace_ends_at := COALESCE(rec.grace_ends_at,expiry_at + make_interval(days => rec.past_due_days + rec.grace_days));
        next_access_ends_at := COALESCE(rec.access_ends_at,expiry_at + make_interval(days => rec.past_due_days + rec.grace_days + rec.read_only_days));
      END IF;
    ELSIF rec.status='grace' THEN
      IF rec.grace_ends_at IS NOT NULL AND rec.grace_ends_at <= now() THEN
        next_status := 'read_only';
        next_stage_started_at := rec.grace_ends_at;
      END IF;
    ELSIF rec.status='read_only' THEN
      IF rec.access_ends_at IS NOT NULL AND rec.access_ends_at <= now() THEN
        next_status := 'suspended';
        next_stage_started_at := rec.access_ends_at;
      END IF;
    END IF;

    IF next_status IS NOT NULL AND next_status <> rec.status THEN
      UPDATE app.product_subscriptions
      SET status=next_status,
          lifecycle_stage_started_at=next_stage_started_at,
          grace_ends_at=next_grace_ends_at,
          access_ends_at=next_access_ends_at,
          updated_at=now()
      WHERE id=rec.id;

      UPDATE app.organization_products
      SET status=CASE WHEN next_status='suspended' THEN 'suspended'::app.installation_status ELSE 'active'::app.installation_status END,
          config=config || jsonb_build_object(
            'subscriptionStatus',next_status,
            'subscriptionId',rec.id::text,
            'graceEndsAt',next_grace_ends_at,
            'accessEndsAt',next_access_ends_at
          ),
          updated_at=now()
      WHERE organization_id=rec.organization_id AND product_id=rec.product_id;

      INSERT INTO app.product_subscription_events(subscription_id,event_type,payload)
      VALUES(rec.id,'subscription.lifecycle_changed',jsonb_build_object(
        'from',rec.status,'to',next_status,'graceEndsAt',next_grace_ends_at,'accessEndsAt',next_access_ends_at
      ));

      INSERT INTO app.billing_events(organization_id,subscription_id,event_type,payload)
      VALUES(rec.organization_id,rec.id,'subscription.lifecycle_changed',jsonb_build_object(
        'from',rec.status,'to',next_status,'graceEndsAt',next_grace_ends_at,'accessEndsAt',next_access_ends_at
      ));

      transitioned := transitioned + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('transitioned',transitioned,'overdueInvoices',overdue_invoices,'checkedAt',now());
END;
$$;

GRANT EXECUTE ON FUNCTION app.refresh_subscription_lifecycle() TO imdssa_app;

COMMIT;
