BEGIN;

CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION imdssa_owner;

DO $$ BEGIN CREATE TYPE app.organization_status AS ENUM ('active','suspended','archived'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE app.product_status AS ENUM ('draft','active','degraded','maintenance','disabled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE app.module_status AS ENUM ('draft','published','disabled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE app.installation_status AS ENUM ('validating','provisioning','active','read_only','suspended','failed','archived'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE app.health_status AS ENUM ('unknown','healthy','degraded','failed','offline'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE app.global_role AS ENUM ('platform_owner','platform_admin','support','auditor'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS app.platform_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  full_name text NOT NULL,
  global_role app.global_role NOT NULL,
  mfa_enforced boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_key text UNIQUE,
  name text NOT NULL,
  legal_name text,
  bin text,
  city text,
  status app.organization_status NOT NULL DEFAULT 'active',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  status app.product_status NOT NULL DEFAULT 'draft',
  version text,
  adapter_base_url text,
  healthcheck_url text,
  last_health app.health_status NOT NULL DEFAULT 'unknown',
  last_heartbeat_at timestamptz,
  last_latency_ms integer,
  last_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.organization_products (
  organization_id uuid NOT NULL REFERENCES app.organizations(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES app.products(id) ON DELETE CASCADE,
  status app.installation_status NOT NULL DEFAULT 'active',
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, product_id)
);

CREATE TABLE IF NOT EXISTS app.modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'general',
  owner_product_id uuid REFERENCES app.products(id) ON DELETE SET NULL,
  status app.module_status NOT NULL DEFAULT 'draft',
  current_version text,
  default_route text,
  placement text,
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  limits jsonb NOT NULL DEFAULT '{}'::jsonb,
  config_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.module_installations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES app.organizations(id) ON DELETE CASCADE,
  module_id uuid NOT NULL REFERENCES app.modules(id) ON DELETE RESTRICT,
  host_product_id uuid NOT NULL REFERENCES app.products(id) ON DELETE RESTRICT,
  version text NOT NULL,
  status app.installation_status NOT NULL DEFAULT 'validating',
  health app.health_status NOT NULL DEFAULT 'unknown',
  route text,
  placement text,
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  limits jsonb NOT NULL DEFAULT '{}'::jsonb,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision bigint NOT NULL DEFAULT 1,
  last_heartbeat_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, module_id, host_product_id)
);

CREATE TABLE IF NOT EXISTS app.integration_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES app.organizations(id) ON DELETE CASCADE,
  product_id uuid REFERENCES app.products(id) ON DELETE CASCADE,
  provider text NOT NULL,
  external_account_id text,
  status text NOT NULL DEFAULT 'disconnected',
  health app.health_status NOT NULL DEFAULT 'unknown',
  last_heartbeat_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.realtime_events (
  id bigserial PRIMARY KEY,
  topic text NOT NULL,
  event_type text NOT NULL,
  organization_id uuid REFERENCES app.organizations(id) ON DELETE SET NULL,
  product_id uuid REFERENCES app.products(id) ON DELETE SET NULL,
  module_installation_id uuid REFERENCES app.module_installations(id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.audit_logs (
  id bigserial PRIMARY KEY,
  actor_user_id uuid REFERENCES app.platform_users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  reason text,
  request_id text,
  source_ip inet,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_products_heartbeat ON app.products(last_heartbeat_at DESC);
CREATE INDEX IF NOT EXISTS idx_installations_org ON app.module_installations(organization_id);
CREATE INDEX IF NOT EXISTS idx_installations_product ON app.module_installations(host_product_id);
CREATE INDEX IF NOT EXISTS idx_realtime_created ON app.realtime_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_realtime_topic ON app.realtime_events(topic, id DESC);
CREATE INDEX IF NOT EXISTS idx_audit_created ON app.audit_logs(created_at DESC);

CREATE OR REPLACE FUNCTION app.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.emit_realtime_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
DECLARE
  row_data jsonb;
  event_id bigint;
  org_id uuid;
  prod_id uuid;
  install_id uuid;
BEGIN
  row_data := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
  org_id := NULLIF(row_data ->> 'organization_id', '')::uuid;
  prod_id := NULLIF(COALESCE(row_data ->> 'product_id', row_data ->> 'host_product_id'), '')::uuid;
  install_id := CASE WHEN TG_TABLE_NAME = 'module_installations' THEN NULLIF(row_data ->> 'id', '')::uuid ELSE NULL END;

  INSERT INTO app.realtime_events(topic, event_type, organization_id, product_id, module_installation_id, payload)
  VALUES (TG_TABLE_NAME, lower(TG_OP), org_id, prod_id, install_id,
    jsonb_build_object('table', TG_TABLE_NAME, 'operation', TG_OP, 'data', row_data))
  RETURNING id INTO event_id;

  PERFORM pg_notify('imds_realtime', json_build_object('id', event_id, 'topic', TG_TABLE_NAME, 'eventType', lower(TG_OP))::text);
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['organizations','products','organization_products','modules','module_installations','integration_connections'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS realtime_%I ON app.%I', table_name, table_name);
    EXECUTE format('CREATE TRIGGER realtime_%I AFTER INSERT OR UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.emit_realtime_event()', table_name, table_name);
  END LOOP;
END $$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['platform_users','organizations','products','organization_products','modules','module_installations','integration_connections'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS touch_%I ON app.%I', table_name, table_name);
    EXECUTE format('CREATE TRIGGER touch_%I BEFORE UPDATE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at()', table_name, table_name);
  END LOOP;
END $$;

REVOKE ALL ON SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO imdssa_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO imdssa_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app TO imdssa_app;
ALTER DEFAULT PRIVILEGES FOR ROLE imdssa_owner IN SCHEMA app GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO imdssa_app;
ALTER DEFAULT PRIVILEGES FOR ROLE imdssa_owner IN SCHEMA app GRANT USAGE, SELECT ON SEQUENCES TO imdssa_app;

COMMIT;
