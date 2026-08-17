BEGIN;

CREATE TABLE IF NOT EXISTS app.product_tenant_bindings (
  organization_id uuid NOT NULL REFERENCES app.organizations(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES app.products(id) ON DELETE CASCADE,
  remote_tenant_id text,
  desired_revision bigint NOT NULL DEFAULT 1,
  actual_revision bigint NOT NULL DEFAULT 0,
  sync_status text NOT NULL DEFAULT 'pending',
  actual_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, product_id)
);

CREATE TABLE IF NOT EXISTS app.control_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES app.organizations(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES app.products(id) ON DELETE CASCADE,
  command_type text NOT NULL,
  desired_revision bigint NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.outbox_events (
  id bigserial PRIMARY KEY,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app.module_installations ADD COLUMN IF NOT EXISTS actual_enabled boolean;
ALTER TABLE app.module_installations ADD COLUMN IF NOT EXISTS sync_status text NOT NULL DEFAULT 'pending';
ALTER TABLE app.module_installations ADD COLUMN IF NOT EXISTS last_applied_revision bigint;

CREATE INDEX IF NOT EXISTS idx_control_commands_ready ON app.control_commands(status, next_attempt_at, created_at);
CREATE INDEX IF NOT EXISTS idx_bindings_sync ON app.product_tenant_bindings(sync_status, desired_revision, actual_revision);
CREATE INDEX IF NOT EXISTS idx_outbox_unpublished ON app.outbox_events(published_at, id);

CREATE OR REPLACE FUNCTION app.queue_product_sync(p_organization_id uuid, p_product_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
DECLARE
  next_revision bigint;
  remote_id text;
  command_key text;
BEGIN
  SELECT COALESCE(NULLIF(op.config ->> 'remoteTenantId',''), NULLIF(o.external_key,''))
  INTO remote_id
  FROM app.organizations o
  LEFT JOIN app.organization_products op
    ON op.organization_id=o.id AND op.product_id=p_product_id
  WHERE o.id=p_organization_id;

  INSERT INTO app.product_tenant_bindings(organization_id,product_id,remote_tenant_id,desired_revision,actual_revision,sync_status)
  VALUES(p_organization_id,p_product_id,remote_id,1,0,'pending')
  ON CONFLICT(organization_id,product_id) DO UPDATE
  SET remote_tenant_id=COALESCE(EXCLUDED.remote_tenant_id,app.product_tenant_bindings.remote_tenant_id),
      desired_revision=app.product_tenant_bindings.desired_revision+1,
      sync_status='pending',
      last_error=NULL,
      updated_at=now()
  RETURNING desired_revision INTO next_revision;

  UPDATE app.module_installations
  SET sync_status='pending', updated_at=now()
  WHERE organization_id=p_organization_id AND host_product_id=p_product_id;

  command_key := p_product_id::text || ':' || p_organization_id::text || ':' || next_revision::text;
  INSERT INTO app.control_commands(organization_id,product_id,command_type,desired_revision,idempotency_key,payload)
  VALUES(p_organization_id,p_product_id,'sync_entitlements',next_revision,command_key,jsonb_build_object('reason',p_reason))
  ON CONFLICT(idempotency_key) DO NOTHING;

  INSERT INTO app.outbox_events(aggregate_type,aggregate_id,event_type,payload)
  VALUES('product_tenant_binding',p_organization_id::text || ':' || p_product_id::text,'desired_state.changed',jsonb_build_object(
    'organizationId',p_organization_id,
    'productId',p_product_id,
    'revision',next_revision,
    'reason',p_reason
  ));
END;
$$;

CREATE OR REPLACE FUNCTION app.trg_queue_org_product_sync()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM app.queue_product_sync(CASE WHEN TG_OP='DELETE' THEN OLD.organization_id ELSE NEW.organization_id END,
                                 CASE WHEN TG_OP='DELETE' THEN OLD.product_id ELSE NEW.product_id END,
                                 'organization_product.' || lower(TG_OP));
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION app.trg_queue_module_sync()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM app.queue_product_sync(CASE WHEN TG_OP='DELETE' THEN OLD.organization_id ELSE NEW.organization_id END,
                                 CASE WHEN TG_OP='DELETE' THEN OLD.host_product_id ELSE NEW.host_product_id END,
                                 'module_installation.' || lower(TG_OP));
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION app.trg_queue_organization_sync()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rec record;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.external_key IS DISTINCT FROM OLD.external_key THEN
    FOR rec IN SELECT product_id FROM app.organization_products WHERE organization_id=NEW.id LOOP
      PERFORM app.queue_product_sync(NEW.id,rec.product_id,'organization.update');
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS control_sync_organization_products ON app.organization_products;
CREATE TRIGGER control_sync_organization_products
AFTER INSERT OR UPDATE OR DELETE ON app.organization_products
FOR EACH ROW EXECUTE FUNCTION app.trg_queue_org_product_sync();

DROP TRIGGER IF EXISTS control_sync_module_installations ON app.module_installations;
CREATE TRIGGER control_sync_module_installations
AFTER INSERT OR UPDATE OF status,config OR DELETE ON app.module_installations
FOR EACH ROW EXECUTE FUNCTION app.trg_queue_module_sync();

DROP TRIGGER IF EXISTS control_sync_organizations ON app.organizations;
CREATE TRIGGER control_sync_organizations
AFTER UPDATE OF status,external_key ON app.organizations
FOR EACH ROW EXECUTE FUNCTION app.trg_queue_organization_sync();

INSERT INTO app.product_tenant_bindings(organization_id,product_id,remote_tenant_id,desired_revision,actual_revision,sync_status)
SELECT op.organization_id,op.product_id,COALESCE(NULLIF(op.config ->> 'remoteTenantId',''),NULLIF(o.external_key,'')),1,0,'pending'
FROM app.organization_products op
JOIN app.organizations o ON o.id=op.organization_id
ON CONFLICT(organization_id,product_id) DO NOTHING;

DO $$
DECLARE rec record;
BEGIN
  FOR rec IN SELECT organization_id,product_id FROM app.organization_products LOOP
    PERFORM app.queue_product_sync(rec.organization_id,rec.product_id,'migration.bootstrap');
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON app.product_tenant_bindings, app.control_commands, app.outbox_events TO imdssa_app;
GRANT USAGE, SELECT ON SEQUENCE app.outbox_events_id_seq TO imdssa_app;

COMMIT;
