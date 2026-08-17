BEGIN;

CREATE TABLE IF NOT EXISTS app.notification_delivery_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  telegram_bot_token_ciphertext text,
  telegram_chat_id text,
  registration_enabled boolean NOT NULL DEFAULT true,
  trial_expiring_enabled boolean NOT NULL DEFAULT true,
  payment_received_enabled boolean NOT NULL DEFAULT true,
  payment_overdue_enabled boolean NOT NULL DEFAULT true,
  subscription_expired_enabled boolean NOT NULL DEFAULT true,
  last_tested_at timestamptz,
  last_test_status text,
  last_test_error text,
  updated_by uuid REFERENCES app.platform_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO app.notification_delivery_settings(id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

REVOKE ALL ON app.notification_delivery_settings FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON app.notification_delivery_settings TO imdssa_app;

COMMIT;
