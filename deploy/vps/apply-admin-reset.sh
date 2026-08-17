#!/usr/bin/env bash
set -euo pipefail

RESET_DIR=/root/imdssa-admin-reset
RESET_BIN=/tmp/imdssa-reset.bin
RESET_ENV="$RESET_DIR/reset.env"
PRIVATE_KEY="$RESET_DIR/private.pem"

if [ "$(id -u)" -ne 0 ]; then
  echo "apply-admin-reset.sh must run as root" >&2
  exit 1
fi

if [ ! -f "$PRIVATE_KEY" ]; then
  echo "Missing one-time private key" >&2
  exit 1
fi

if [ ! -f "$RESET_BIN" ]; then
  echo "Missing encrypted reset payload" >&2
  exit 1
fi

openssl pkeyutl -decrypt \
  -inkey "$PRIVATE_KEY" \
  -in "$RESET_BIN" \
  -out "$RESET_ENV" \
  -pkeyopt rsa_padding_mode:oaep \
  -pkeyopt rsa_oaep_md:sha256 \
  -pkeyopt rsa_mgf1_md:sha256

chmod 0600 "$RESET_ENV"
# shellcheck disable=SC1090
source "$RESET_ENV"

if [ -z "${EMAIL:-}" ] || [ -z "${PASSWORD_HASH:-}" ]; then
  echo "Decrypted reset payload is incomplete" >&2
  exit 1
fi

sudo -u postgres psql \
  --set=ON_ERROR_STOP=1 \
  --set=admin_email="$EMAIL" \
  --set=password_hash="$PASSWORD_HASH" \
  --dbname=imdssa <<'SQL'
UPDATE app.platform_users
SET email=:'admin_email',
    password_hash=:'password_hash',
    full_name='IMDS Platform Owner',
    global_role='platform_owner',
    is_active=true,
    updated_at=now()
WHERE id=(
  SELECT id
  FROM app.platform_users
  WHERE global_role='platform_owner'
  ORDER BY created_at ASC
  LIMIT 1
);

DELETE FROM app.auth_sessions;
SQL

rm -f "$RESET_ENV" "$PRIVATE_KEY" "$RESET_DIR/public.pem" "$RESET_BIN"
systemctl restart imds-super-admin-api.service
curl -fsS http://127.0.0.1:8788/healthz >/dev/null

echo "IMDS Super Admin credentials updated and active sessions revoked"
