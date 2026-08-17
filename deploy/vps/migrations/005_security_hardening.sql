BEGIN;

ALTER TABLE app.platform_users
  ADD COLUMN IF NOT EXISTS failed_login_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until timestamptz,
  ADD COLUMN IF NOT EXISTS password_changed_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_login_ip inet;

ALTER TABLE app.auth_sessions
  ADD COLUMN IF NOT EXISTS source_ip inet,
  ADD COLUMN IF NOT EXISTS user_agent text;

CREATE TABLE IF NOT EXISTS app.login_attempts (
  id bigserial PRIMARY KEY,
  normalized_email text NOT NULL,
  source_ip inet,
  succeeded boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_email_created
  ON app.login_attempts(normalized_email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_created
  ON app.login_attempts(source_ip, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_users_locked_until
  ON app.platform_users(locked_until)
  WHERE locked_until IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON app.login_attempts TO imdssa_app;
GRANT USAGE, SELECT ON SEQUENCE app.login_attempts_id_seq TO imdssa_app;

COMMIT;
