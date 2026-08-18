BEGIN;

CREATE TABLE IF NOT EXISTS app.product_module_commercial (
  product_id uuid NOT NULL REFERENCES app.products(id) ON DELETE CASCADE,
  module_id uuid NOT NULL REFERENCES app.modules(id) ON DELETE CASCADE,
  separately_sellable boolean NOT NULL DEFAULT false,
  addon_price_kzt numeric(14,2) CHECK (addon_price_kzt IS NULL OR addon_price_kzt >= 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id,module_id)
);

CREATE TABLE IF NOT EXISTS app.product_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES app.products(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  currency text NOT NULL DEFAULT 'KZT' CHECK (currency = 'KZT'),
  trial_days integer NOT NULL DEFAULT 3 CHECK (trial_days BETWEEN 0 AND 365),
  limits jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(product_id,code),
  CHECK (char_length(btrim(code)) BETWEEN 1 AND 80),
  CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  CHECK (jsonb_typeof(limits) = 'object'),
  CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE TABLE IF NOT EXISTS app.product_plan_prices (
  plan_id uuid NOT NULL REFERENCES app.product_plans(id) ON DELETE CASCADE,
  months smallint NOT NULL CHECK (months IN (1,3,6,12)),
  amount_kzt numeric(14,2) NOT NULL CHECK (amount_kzt >= 0),
  PRIMARY KEY (plan_id,months)
);

CREATE TABLE IF NOT EXISTS app.product_plan_modules (
  plan_id uuid NOT NULL REFERENCES app.product_plans(id) ON DELETE CASCADE,
  module_id uuid NOT NULL REFERENCES app.modules(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'disabled' CHECK (mode IN ('included','addon','disabled')),
  price_override_kzt numeric(14,2) CHECK (price_override_kzt IS NULL OR price_override_kzt >= 0),
  PRIMARY KEY (plan_id,module_id)
);

CREATE TABLE IF NOT EXISTS app.product_payment_methods (
  product_id uuid NOT NULL REFERENCES app.products(id) ON DELETE CASCADE,
  method text NOT NULL CHECK (method IN ('bank_transfer','kaspi','card')),
  enabled boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  display_name text NOT NULL,
  instructions text,
  sort_order smallint NOT NULL DEFAULT 100,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id,method)
);

CREATE UNIQUE INDEX IF NOT EXISTS product_payment_methods_one_default
  ON app.product_payment_methods(product_id) WHERE enabled=true AND is_default=true;
CREATE INDEX IF NOT EXISTS product_plans_product_status_idx ON app.product_plans(product_id,status,created_at);

INSERT INTO app.product_module_commercial(product_id,module_id)
SELECT m.owner_product_id,m.id
FROM app.modules m
WHERE m.owner_product_id IS NOT NULL
ON CONFLICT(product_id,module_id) DO NOTHING;

INSERT INTO app.product_payment_methods(product_id,method,enabled,is_default,display_name,sort_order)
SELECT p.id,'bank_transfer',true,true,'Банковский перевод',10 FROM app.products p
ON CONFLICT(product_id,method) DO NOTHING;
INSERT INTO app.product_payment_methods(product_id,method,enabled,is_default,display_name,sort_order)
SELECT p.id,'kaspi',true,false,'Kaspi',20 FROM app.products p
ON CONFLICT(product_id,method) DO NOTHING;
INSERT INTO app.product_payment_methods(product_id,method,enabled,is_default,display_name,sort_order)
SELECT p.id,'card',false,false,'Банковская карта',30 FROM app.products p
ON CONFLICT(product_id,method) DO NOTHING;

GRANT SELECT,INSERT,UPDATE,DELETE ON app.product_module_commercial TO imdssa_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON app.product_plans TO imdssa_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON app.product_plan_prices TO imdssa_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON app.product_plan_modules TO imdssa_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON app.product_payment_methods TO imdssa_app;

COMMIT;
