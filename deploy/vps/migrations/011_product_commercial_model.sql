BEGIN;

ALTER TABLE app.product_module_commercial ADD COLUMN IF NOT EXISTS commercial_role text NOT NULL DEFAULT 'module';
ALTER TABLE app.product_module_commercial ADD COLUMN IF NOT EXISTS parent_module_id uuid REFERENCES app.modules(id) ON DELETE SET NULL;
ALTER TABLE app.product_module_commercial ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 100;
DO $$ BEGIN
  ALTER TABLE app.product_module_commercial ADD CONSTRAINT product_module_commercial_role_check CHECK (commercial_role IN ('module','feature','hidden'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS app.product_commercial_settings (
  product_id uuid PRIMARY KEY REFERENCES app.products(id) ON DELETE CASCADE,
  default_trial_days integer NOT NULL DEFAULT 3 CHECK (default_trial_days BETWEEN 0 AND 365),
  currency text NOT NULL DEFAULT 'KZT' CHECK (currency = 'KZT'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.product_limit_catalog (
  product_id uuid NOT NULL REFERENCES app.products(id) ON DELETE CASCADE,
  key text NOT NULL,
  label text NOT NULL,
  unit text NOT NULL DEFAULT 'шт.',
  period text NOT NULL DEFAULT 'subscription' CHECK (period IN ('subscription','month','day')),
  sort_order integer NOT NULL DEFAULT 100,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (product_id,key)
);

CREATE TABLE IF NOT EXISTS app.product_module_prices (
  product_id uuid NOT NULL REFERENCES app.products(id) ON DELETE CASCADE,
  module_id uuid NOT NULL REFERENCES app.modules(id) ON DELETE CASCADE,
  months smallint NOT NULL CHECK (months IN (1,3,6,12)),
  amount_kzt numeric(14,2) NOT NULL CHECK (amount_kzt >= 0),
  PRIMARY KEY (product_id,module_id,months)
);

CREATE TABLE IF NOT EXISTS app.product_module_dependencies (
  product_id uuid NOT NULL REFERENCES app.products(id) ON DELETE CASCADE,
  module_id uuid NOT NULL REFERENCES app.modules(id) ON DELETE CASCADE,
  depends_on_module_id uuid NOT NULL REFERENCES app.modules(id) ON DELETE CASCADE,
  dependency_type text NOT NULL DEFAULT 'requires' CHECK (dependency_type IN ('requires','recommends')),
  PRIMARY KEY (product_id,module_id,depends_on_module_id)
);

ALTER TABLE app.product_plans ADD COLUMN IF NOT EXISTS pricing_mode text NOT NULL DEFAULT 'fixed';
ALTER TABLE app.product_plans ADD COLUMN IF NOT EXISTS featured boolean NOT NULL DEFAULT false;
ALTER TABLE app.product_plans ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 100;
ALTER TABLE app.product_plans ADD COLUMN IF NOT EXISTS trial_mode text NOT NULL DEFAULT 'product_default';
ALTER TABLE app.product_plans ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 1;
DO $$ BEGIN
  ALTER TABLE app.product_plans ADD CONSTRAINT product_plans_pricing_mode_check CHECK (pricing_mode IN ('fixed','request'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE app.product_plans ADD CONSTRAINT product_plans_trial_mode_check CHECK (trial_mode IN ('product_default','custom','disabled'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS app.product_plan_revisions (
  id bigserial PRIMARY KEY,
  plan_id uuid NOT NULL REFERENCES app.product_plans(id) ON DELETE CASCADE,
  revision bigint NOT NULL,
  snapshot jsonb NOT NULL,
  actor_user_id uuid REFERENCES app.platform_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(plan_id,revision)
);

WITH marketing AS (SELECT id FROM app.products WHERE code='imds-marketing')
INSERT INTO app.product_commercial_settings(product_id,default_trial_days,currency)
SELECT id,3,'KZT' FROM marketing
ON CONFLICT(product_id) DO NOTHING;

WITH marketing AS (SELECT id FROM app.products WHERE code='imds-marketing')
INSERT INTO app.product_limit_catalog(product_id,key,label,unit,period,sort_order)
SELECT marketing.id,v.key,v.label,v.unit,v.period,v.sort_order
FROM marketing CROSS JOIN (VALUES
  ('users','Пользователи','шт.','subscription',10),
  ('branches','Филиалы','шт.','subscription',20),
  ('whatsapp_channels','WhatsApp-каналы','шт.','subscription',30),
  ('waba_accounts','WABA аккаунты','шт.','subscription',40),
  ('whatsapp_numbers','WhatsApp номера','шт.','subscription',50),
  ('telephony_channels','Телефонные каналы','шт.','subscription',60),
  ('call_minutes','Минуты звонков','мин/мес','month',70),
  ('transcription_minutes','Транскрибация','мин/мес','month',80),
  ('call_recording_days','Хранение записей','дней','subscription',90),
  ('ai_requests','AI-запросы','запросов/мес','month',100),
  ('automation_runs','Запуски автоматизаций','запусков/мес','month',110),
  ('storage_gb','Хранилище','GB','subscription',120),
  ('meta_ad_accounts','Meta Ad Accounts','шт.','subscription',130),
  ('meta_pages','Meta Pages','шт.','subscription',140),
  ('meta_datasets','Meta Pixel / Dataset','шт.','subscription',150)
) AS v(key,label,unit,period,sort_order)
ON CONFLICT(product_id,key) DO UPDATE SET label=excluded.label,unit=excluded.unit,period=excluded.period,sort_order=excluded.sort_order;

WITH marketing AS (SELECT id FROM app.products WHERE code='imds-marketing')
INSERT INTO app.modules(code,name,description,category,owner_product_id,status,current_version,permissions,limits,config_schema)
SELECT 'marketing.ai','IMDS AI','AI Intelligence, рекомендации, анализ, генерация и AI-функции','ai',marketing.id,'published'::app.module_status,NULL,'[]'::jsonb,'{}'::jsonb,'{}'::jsonb
FROM marketing
ON CONFLICT(code) DO UPDATE SET name=excluded.name,description=excluded.description,category=excluded.category,owner_product_id=excluded.owner_product_id,status='published'::app.module_status,updated_at=now();

INSERT INTO app.product_module_commercial(product_id,module_id,commercial_role,separately_sellable,sort_order)
SELECT m.owner_product_id,m.id,'module',false,80
FROM app.modules m WHERE m.code='marketing.ai' AND m.owner_product_id IS NOT NULL
ON CONFLICT(product_id,module_id) DO UPDATE SET commercial_role='module',parent_module_id=NULL,sort_order=80,updated_at=now();

UPDATE app.product_module_commercial c
SET commercial_role='feature',parent_module_id=parent.id,separately_sellable=false,sort_order=10,updated_at=now()
FROM app.modules child, app.modules parent
WHERE c.module_id=child.id AND child.code='marketing.voice-transcription' AND parent.code='marketing.call-center' AND c.product_id=parent.owner_product_id;

INSERT INTO app.product_module_dependencies(product_id,module_id,depends_on_module_id,dependency_type)
SELECT child.owner_product_id,child.id,parent.id,'requires'
FROM app.modules child JOIN app.modules parent ON parent.code='marketing.call-center'
WHERE child.code='marketing.voice-transcription' AND child.owner_product_id=parent.owner_product_id
ON CONFLICT DO NOTHING;

-- Preserve existing IMDS Intelligence access: organizations that already had Analytics active
-- receive the new AI entitlement before Marketing switches its route guard to marketing.ai.
INSERT INTO app.module_installations(
  organization_id,module_id,host_product_id,version,status,health,route,placement,permissions,limits,config,revision,actual_enabled,sync_status,last_applied_revision
)
SELECT analytics_install.organization_id,ai.id,analytics_install.host_product_id,analytics_install.version,
       'active'::app.installation_status,'unknown'::app.health_status,NULL,NULL,'[]'::jsonb,'{}'::jsonb,'{}'::jsonb,1,NULL,'pending',NULL
FROM app.module_installations analytics_install
JOIN app.modules analytics ON analytics.id=analytics_install.module_id AND analytics.code='marketing.analytics'
JOIN app.modules ai ON ai.code='marketing.ai' AND ai.owner_product_id=analytics_install.host_product_id
WHERE analytics_install.status='active'
ON CONFLICT(organization_id,module_id,host_product_id) DO NOTHING;

GRANT SELECT,INSERT,UPDATE,DELETE ON app.product_commercial_settings TO imdssa_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON app.product_limit_catalog TO imdssa_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON app.product_module_prices TO imdssa_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON app.product_module_dependencies TO imdssa_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON app.product_plan_revisions TO imdssa_app;
GRANT USAGE,SELECT ON SEQUENCE app.product_plan_revisions_id_seq TO imdssa_app;

COMMIT;
