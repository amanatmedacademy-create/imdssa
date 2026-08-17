BEGIN;

ALTER TABLE app.platform_users
  ALTER COLUMN global_role DROP NOT NULL;

DO $$
BEGIN
  CREATE TYPE app.organization_role AS ENUM ('owner','admin','member','viewer');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE app.membership_status AS ENUM ('active','suspended');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS app.organization_memberships (
  user_id uuid NOT NULL REFERENCES app.platform_users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES app.organizations(id) ON DELETE CASCADE,
  role app.organization_role NOT NULL,
  status app.membership_status NOT NULL DEFAULT 'active',
  allowed_product_codes text[] NOT NULL DEFAULT '{}'::text[],
  allowed_module_codes text[] NOT NULL DEFAULT '{}'::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_memberships_organization
  ON app.organization_memberships(organization_id, status, role);
CREATE INDEX IF NOT EXISTS idx_memberships_user
  ON app.organization_memberships(user_id, status, role);

DROP TRIGGER IF EXISTS touch_organization_memberships ON app.organization_memberships;
CREATE TRIGGER touch_organization_memberships
BEFORE UPDATE ON app.organization_memberships
FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

REVOKE ALL ON app.organization_memberships FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.organization_memberships TO imdssa_app;

COMMIT;
