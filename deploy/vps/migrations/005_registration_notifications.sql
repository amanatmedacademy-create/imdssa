BEGIN;

CREATE TABLE IF NOT EXISTS app.registration_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL UNIQUE,
  source_product_code text NOT NULL,
  external_tenant_id text NOT NULL,
  organization_id uuid REFERENCES app.organizations(id) ON DELETE SET NULL,
  company_name text NOT NULL,
  owner_name text NOT NULL,
  owner_email text NOT NULL,
  owner_phone text NOT NULL,
  trial_status text NOT NULL DEFAULT 'trial',
  trial_started_at timestamptz NOT NULL,
  trial_ends_at timestamptz NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  telegram_status text NOT NULL DEFAULT 'pending' CHECK (telegram_status IN ('pending','sent','failed','disabled')),
  telegram_message_id text,
  telegram_error text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (trial_ends_at > trial_started_at)
);

CREATE INDEX IF NOT EXISTS idx_registration_notifications_created
  ON app.registration_notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_registration_notifications_unread
  ON app.registration_notifications(created_at DESC) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_registration_notifications_tenant
  ON app.registration_notifications(external_tenant_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_registration_notifications_touch ON app.registration_notifications;
CREATE TRIGGER trg_registration_notifications_touch
BEFORE UPDATE ON app.registration_notifications
FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

GRANT SELECT, INSERT, UPDATE ON app.registration_notifications TO imdssa_app;

COMMIT;
