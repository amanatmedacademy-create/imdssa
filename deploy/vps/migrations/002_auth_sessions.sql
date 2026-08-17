BEGIN;

CREATE TABLE IF NOT EXISTS app.auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.platform_users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_token ON app.auth_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry ON app.auth_sessions(expires_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON app.auth_sessions TO imdssa_app;
ALTER DEFAULT PRIVILEGES FOR ROLE imdssa_owner IN SCHEMA app GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO imdssa_app;

COMMIT;
