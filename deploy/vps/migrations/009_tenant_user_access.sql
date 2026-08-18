BEGIN;

ALTER TABLE app.platform_users
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_platform_users_tenant_accounts
  ON app.platform_users(is_active, created_at DESC)
  WHERE global_role IS NULL;

CREATE OR REPLACE FUNCTION app.clear_must_change_password()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.password_hash IS DISTINCT FROM OLD.password_hash THEN
    NEW.must_change_password := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clear_must_change_password ON app.platform_users;
CREATE TRIGGER clear_must_change_password
BEFORE UPDATE OF password_hash ON app.platform_users
FOR EACH ROW EXECUTE FUNCTION app.clear_must_change_password();

DROP TRIGGER IF EXISTS realtime_organization_memberships ON app.organization_memberships;
CREATE TRIGGER realtime_organization_memberships
AFTER INSERT OR UPDATE OR DELETE ON app.organization_memberships
FOR EACH ROW EXECUTE FUNCTION app.emit_realtime_event();

COMMIT;
