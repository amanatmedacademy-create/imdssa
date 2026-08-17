BEGIN;

ALTER TABLE app.platform_users
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_platform_users_tenant_accounts
  ON app.platform_users(is_active, created_at DESC)
  WHERE global_role IS NULL;

DROP TRIGGER IF EXISTS realtime_organization_memberships ON app.organization_memberships;
CREATE TRIGGER realtime_organization_memberships
AFTER INSERT OR UPDATE OR DELETE ON app.organization_memberships
FOR EACH ROW EXECUTE FUNCTION app.emit_realtime_event();

COMMIT;
