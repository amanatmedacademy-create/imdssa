BEGIN;

CREATE TABLE IF NOT EXISTS app.product_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES app.organizations(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES app.products(id) ON DELETE CASCADE,
  plan_id uuid REFERENCES app.product_plans(id) ON DELETE SET NULL,
  plan_revision bigint,
  status text NOT NULL DEFAULT 'trial' CHECK (status IN ('trial','pending_payment','active','past_due','grace','read_only','suspended','expired','canceled','free','beta')),
  billing_period_months smallint NOT NULL DEFAULT 1 CHECK (billing_period_months IN (1,3,6,12)),
  currency text NOT NULL DEFAULT 'KZT' CHECK (currency='KZT'),
  base_price_kzt numeric(14,2),
  addons_price_kzt numeric(14,2) NOT NULL DEFAULT 0 CHECK (addons_price_kzt >= 0),
  custom_price_kzt numeric(14,2),
  payment_method text,
  renewal_mode text NOT NULL DEFAULT 'manual' CHECK (renewal_mode IN ('manual','auto')),
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  grace_ends_at timestamptz,
  access_ends_at timestamptz,
  limits jsonb NOT NULL DEFAULT '{}'::jsonb,
  plan_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, product_id)
);

CREATE TABLE IF NOT EXISTS app.product_subscription_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES app.product_subscriptions(id) ON DELETE CASCADE,
  module_id uuid NOT NULL REFERENCES app.modules(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('included','addon')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','scheduled','disabled')),
  quantity numeric(12,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_kzt numeric(14,2) NOT NULL DEFAULT 0 CHECK (unit_price_kzt >= 0),
  price_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subscription_id,module_id)
);

CREATE TABLE IF NOT EXISTS app.product_subscription_events (
  id bigserial PRIMARY KEY,
  subscription_id uuid NOT NULL REFERENCES app.product_subscriptions(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES app.platform_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_subscriptions_org ON app.product_subscriptions(organization_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_subscriptions_status ON app.product_subscriptions(status,access_ends_at);
CREATE INDEX IF NOT EXISTS idx_product_subscription_items_subscription ON app.product_subscription_items(subscription_id);
CREATE INDEX IF NOT EXISTS idx_product_subscription_events_subscription ON app.product_subscription_events(subscription_id,id DESC);

GRANT SELECT,INSERT,UPDATE,DELETE ON app.product_subscriptions TO imdssa_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON app.product_subscription_items TO imdssa_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON app.product_subscription_events TO imdssa_app;
GRANT USAGE,SELECT ON SEQUENCE app.product_subscription_events_id_seq TO imdssa_app;

-- Preserve existing access. Existing organizations get a non-priced legacy subscription
-- so introducing the billing domain never disables a product that is already active.
INSERT INTO app.product_subscriptions(
  organization_id,product_id,status,billing_period_months,currency,limits,plan_snapshot,metadata
)
SELECT op.organization_id,op.product_id,
       CASE WHEN op.status::text='active' THEN 'free' ELSE 'suspended' END,
       1,'KZT',
       CASE WHEN jsonb_typeof(op.config->'limits')='object' THEN op.config->'limits' ELSE '{}'::jsonb END,
       jsonb_build_object('legacy',true,'plan',op.plan),
       jsonb_build_object('source','organization_products_backfill')
FROM app.organization_products op
ON CONFLICT(organization_id,product_id) DO NOTHING;

COMMIT;
