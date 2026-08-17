BEGIN;

-- Module versions are taken from the real host product release at install time.
-- A module can therefore be catalogued before the first product heartbeat reports a version.
ALTER TABLE app.module_installations ALTER COLUMN version DROP NOT NULL;

INSERT INTO app.products(
  code,
  name,
  description,
  status,
  adapter_base_url,
  healthcheck_url,
  metadata
)
VALUES (
  'imds-marketing',
  'IMDS Marketing',
  'Marketing automation, CRM context, communications and integrations',
  'active'::app.product_status,
  'http://127.0.0.1:8787',
  'http://127.0.0.1:8787/api/health',
  jsonb_build_object('runtime','vps','systemdService','imds-marketing.service','source','local-runtime')
)
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    adapter_base_url = EXCLUDED.adapter_base_url,
    healthcheck_url = EXCLUDED.healthcheck_url,
    metadata = app.products.metadata || EXCLUDED.metadata,
    updated_at = now();

WITH marketing AS (
  SELECT id FROM app.products WHERE code = 'imds-marketing'
), catalog(code,name,description,category) AS (
  VALUES
    ('marketing.crm','CRM','Лиды, сделки, контакты и CRM-контекст','sales'),
    ('marketing.call-center','Call Center','Коммуникации call center и рабочее место оператора','communications'),
    ('marketing.tasks','Tasks','Задачи, назначения, повторения и уведомления','operations'),
    ('marketing.whatsapp-business','WhatsApp Business','WABA messaging, embedded signup и WhatsApp flows','communications'),
    ('marketing.meta-ads','Meta Ads','Управление рекламой Meta, каталоги, ad sets и conversions','advertising'),
    ('marketing.analytics','Analytics','Маркетинговая аналитика и показатели','analytics'),
    ('marketing.automation','Automation','Автоматизации и journey engine','automation'),
    ('marketing.voice-transcription','Voice Transcription','Транскрибация голосовых сообщений и звонков','telephony')
)
INSERT INTO app.modules(
  code,
  name,
  description,
  category,
  owner_product_id,
  status,
  current_version,
  permissions,
  limits,
  config_schema
)
SELECT
  catalog.code,
  catalog.name,
  catalog.description,
  catalog.category,
  marketing.id,
  'published'::app.module_status,
  NULL,
  '[]'::jsonb,
  '{}'::jsonb,
  '{}'::jsonb
FROM catalog CROSS JOIN marketing
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    category = EXCLUDED.category,
    owner_product_id = EXCLUDED.owner_product_id,
    status = 'published'::app.module_status,
    updated_at = now();

COMMIT;
