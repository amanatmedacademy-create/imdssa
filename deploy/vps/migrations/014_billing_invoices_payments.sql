BEGIN;

CREATE TABLE IF NOT EXISTS app.billing_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL UNIQUE REFERENCES app.organizations(id) ON DELETE CASCADE,
  legal_name text,
  bin_iin text,
  billing_email text,
  currency text NOT NULL DEFAULT 'KZT' CHECK (currency='KZT'),
  payment_terms_days integer NOT NULL DEFAULT 7 CHECK (payment_terms_days BETWEEN 0 AND 365),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.billing_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_account_id uuid NOT NULL REFERENCES app.billing_accounts(id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL REFERENCES app.organizations(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES app.product_subscriptions(id) ON DELETE RESTRICT,
  invoice_number text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued','partially_paid','paid','overdue','void','written_off')),
  currency text NOT NULL DEFAULT 'KZT' CHECK (currency='KZT'),
  subtotal_kzt numeric(14,2) NOT NULL CHECK (subtotal_kzt >= 0),
  total_kzt numeric(14,2) NOT NULL CHECK (total_kzt >= 0),
  paid_total_kzt numeric(14,2) NOT NULL DEFAULT 0 CHECK (paid_total_kzt >= 0),
  period_start timestamptz,
  period_end timestamptz,
  issued_at timestamptz,
  due_at timestamptz,
  paid_at timestamptz,
  notes text,
  pricing_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES app.platform_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (paid_total_kzt <= total_kzt)
);

CREATE TABLE IF NOT EXISTS app.billing_invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES app.billing_invoices(id) ON DELETE CASCADE,
  line_type text NOT NULL CHECK (line_type IN ('subscription','addon','discount','adjustment')),
  product_id uuid REFERENCES app.products(id) ON DELETE SET NULL,
  module_id uuid REFERENCES app.modules(id) ON DELETE SET NULL,
  description text NOT NULL,
  quantity numeric(12,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_kzt numeric(14,2) NOT NULL CHECK (unit_price_kzt >= 0),
  line_total_kzt numeric(14,2) NOT NULL CHECK (line_total_kzt >= 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.billing_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_account_id uuid NOT NULL REFERENCES app.billing_accounts(id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL REFERENCES app.organizations(id) ON DELETE CASCADE,
  payment_number text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'succeeded' CHECK (status IN ('pending','succeeded','failed','cancelled','refunded','partially_refunded')),
  method text NOT NULL CHECK (method IN ('bank_transfer','kaspi','card','cash','manual','other')),
  currency text NOT NULL DEFAULT 'KZT' CHECK (currency='KZT'),
  amount_kzt numeric(14,2) NOT NULL CHECK (amount_kzt > 0),
  external_reference text,
  payer_name text,
  received_at timestamptz,
  recorded_by uuid REFERENCES app.platform_users(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, external_reference)
);

CREATE TABLE IF NOT EXISTS app.billing_payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES app.billing_payments(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES app.billing_invoices(id) ON DELETE RESTRICT,
  amount_kzt numeric(14,2) NOT NULL CHECK (amount_kzt > 0),
  created_by uuid REFERENCES app.platform_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_id,invoice_id)
);

CREATE TABLE IF NOT EXISTS app.billing_events (
  id bigserial PRIMARY KEY,
  organization_id uuid REFERENCES app.organizations(id) ON DELETE SET NULL,
  subscription_id uuid REFERENCES app.product_subscriptions(id) ON DELETE SET NULL,
  invoice_id uuid REFERENCES app.billing_invoices(id) ON DELETE SET NULL,
  payment_id uuid REFERENCES app.billing_payments(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES app.platform_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_invoices_org ON app.billing_invoices(organization_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_invoices_status_due ON app.billing_invoices(status,due_at);
CREATE INDEX IF NOT EXISTS idx_billing_payments_org ON app.billing_payments(organization_id,received_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_events_org ON app.billing_events(organization_id,id DESC);

CREATE OR REPLACE FUNCTION app.trg_invoice_issued_pending_payment()
RETURNS trigger LANGUAGE plpgsql SET search_path=app,pg_temp AS $$
BEGIN
  IF NEW.status='issued' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    UPDATE app.product_subscriptions
    SET status='pending_payment', updated_at=now()
    WHERE id=NEW.subscription_id AND status='trial';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS billing_invoice_issued_pending_payment ON app.billing_invoices;
CREATE TRIGGER billing_invoice_issued_pending_payment
AFTER INSERT OR UPDATE OF status ON app.billing_invoices
FOR EACH ROW EXECUTE FUNCTION app.trg_invoice_issued_pending_payment();

CREATE OR REPLACE FUNCTION app.next_billing_document_number(p_prefix text, p_table text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=app,pg_temp AS $$
DECLARE result text; seq bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_prefix || ':' || to_char(now(),'YYYYMM'), 314159));
  IF p_table='invoice' THEN SELECT count(*)+1 INTO seq FROM app.billing_invoices WHERE created_at>=date_trunc('month',now());
  ELSIF p_table='payment' THEN SELECT count(*)+1 INTO seq FROM app.billing_payments WHERE created_at>=date_trunc('month',now());
  ELSE RAISE EXCEPTION 'Unsupported billing document type'; END IF;
  result := p_prefix || to_char(now(),'YYYYMM') || '-' || lpad(seq::text,5,'0');
  RETURN result;
END;
$$;

GRANT SELECT,INSERT,UPDATE,DELETE ON app.billing_accounts,app.billing_invoices,app.billing_invoice_lines,app.billing_payments,app.billing_payment_allocations,app.billing_events TO imdssa_app;
GRANT USAGE,SELECT ON SEQUENCE app.billing_events_id_seq TO imdssa_app;

COMMIT;
