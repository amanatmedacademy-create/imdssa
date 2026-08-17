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

if [ -z "${EMAIL:-}" ] || [ -z "${PASSWORD:-}" ] || [ -z "${PASSWORD_HASH:-}" ]; then
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

systemctl restart imds-super-admin-api.service
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8788/healthz >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
curl -fsS http://127.0.0.1:8788/healthz >/dev/null

export EMAIL PASSWORD
node --input-type=module -e '
  const response = await fetch("http://127.0.0.1:8788/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: process.env.EMAIL, password: process.env.PASSWORD })
  });
  if (!response.ok) {
    console.error("LOGIN_VERIFY_FAILED", response.status);
    process.exit(1);
  }
  const payload = await response.json();
  if (payload?.user?.email?.toLowerCase() !== process.env.EMAIL.toLowerCase()) {
    console.error("LOGIN_VERIFY_EMAIL_MISMATCH");
    process.exit(1);
  }
  console.log("LOGIN_VERIFY_OK");
'

sudo -u postgres psql --set=ON_ERROR_STOP=1 --dbname=imdssa --command='DELETE FROM app.auth_sessions;' >/dev/null
rm -f "$RESET_ENV" "$PRIVATE_KEY" "$RESET_DIR/public.pem" "$RESET_BIN"
unset EMAIL PASSWORD PASSWORD_HASH

echo "IMDS Super Admin credentials updated, login verified, and active sessions revoked"
