#!/usr/bin/env bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

APP_DIR=/opt/imds-super-admin
ENV_DIR=/etc/imds-super-admin
ENV_FILE="$ENV_DIR/postgres.env"
MIGRATION_FILE="$APP_DIR/migrations/001_control_plane.sql"
BACKUP_DIR=/var/backups/imds-super-admin/postgres

if [ "$(id -u)" -ne 0 ]; then
  echo "bootstrap-postgres.sh must run as root" >&2
  exit 1
fi

apt-get update
apt-get install -y postgresql postgresql-contrib openssl

if ! command -v pg_lsclusters >/dev/null 2>&1; then
  echo "pg_lsclusters is unavailable after PostgreSQL installation" >&2
  exit 1
fi

cluster_line="$(pg_lsclusters --no-header | head -n 1 || true)"
if [ -z "$cluster_line" ]; then
  pg_version="$(find /usr/lib/postgresql -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -V | tail -n 1)"
  if [ -z "$pg_version" ]; then
    echo "Unable to determine installed PostgreSQL version" >&2
    exit 1
  fi
  pg_createcluster "$pg_version" main --start
  cluster_line="$(pg_lsclusters --no-header | head -n 1)"
fi

PG_VERSION="$(printf '%s\n' "$cluster_line" | awk '{print $1}')"
PG_CLUSTER="$(printf '%s\n' "$cluster_line" | awk '{print $2}')"
CONF_DIR="/etc/postgresql/$PG_VERSION/$PG_CLUSTER"
POSTGRES_CONF="$CONF_DIR/postgresql.conf"

install -d -o root -g postgres -m 0750 "$APP_DIR/migrations"
install -d -m 0750 "$ENV_DIR"
install -d -o postgres -g postgres -m 0750 "$BACKUP_DIR"

if grep -Eq '^[#[:space:]]*listen_addresses[[:space:]]*=' "$POSTGRES_CONF"; then
  sed -ri "s|^[#[:space:]]*listen_addresses[[:space:]]*=.*|listen_addresses = '127.0.0.1,::1'|" "$POSTGRES_CONF"
else
  printf "\nlisten_addresses = '127.0.0.1,::1'\n" >> "$POSTGRES_CONF"
fi

if grep -Eq '^[#[:space:]]*password_encryption[[:space:]]*=' "$POSTGRES_CONF"; then
  sed -ri "s|^[#[:space:]]*password_encryption[[:space:]]*=.*|password_encryption = 'scram-sha-256'|" "$POSTGRES_CONF"
else
  printf "\npassword_encryption = 'scram-sha-256'\n" >> "$POSTGRES_CONF"
fi

systemctl enable postgresql
systemctl restart postgresql

if [ ! -f "$ENV_FILE" ]; then
  DB_PASSWORD="$(openssl rand -hex 32)"
  umask 077
  cat > "$ENV_FILE" <<EOF
PGHOST=127.0.0.1
PGPORT=5432
PGDATABASE=imdssa
PGUSER=imdssa_app
PGPASSWORD=$DB_PASSWORD
DATABASE_URL=postgresql://imdssa_app:$DB_PASSWORD@127.0.0.1:5432/imdssa
EOF
  chmod 0600 "$ENV_FILE"
else
  DB_PASSWORD="$(awk -F= '$1 == "PGPASSWORD" {print substr($0, index($0,"=") + 1)}' "$ENV_FILE")"
fi

if [ -z "$DB_PASSWORD" ]; then
  echo "Database password is missing from $ENV_FILE" >&2
  exit 1
fi

sudo -u postgres psql --set=ON_ERROR_STOP=1 --set=db_password="$DB_PASSWORD" postgres <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'imdssa_owner') THEN
    CREATE ROLE imdssa_owner NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'imdssa_app') THEN
    CREATE ROLE imdssa_app LOGIN;
  END IF;
END
$$;
ALTER ROLE imdssa_app WITH LOGIN PASSWORD :'db_password';
ALTER ROLE imdssa_app SET timezone TO 'UTC';
ALTER ROLE imdssa_owner SET timezone TO 'UTC';
SELECT 'CREATE DATABASE imdssa OWNER imdssa_owner'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'imdssa')\gexec
ALTER DATABASE imdssa OWNER TO imdssa_owner;
REVOKE ALL ON DATABASE imdssa FROM PUBLIC;
GRANT CONNECT ON DATABASE imdssa TO imdssa_app;
SQL

if [ ! -f "$MIGRATION_FILE" ]; then
  echo "Migration file is missing: $MIGRATION_FILE" >&2
  exit 1
fi

chown root:postgres "$MIGRATION_FILE"
chmod 0640 "$MIGRATION_FILE"
sudo -u postgres psql --set=ON_ERROR_STOP=1 --dbname=imdssa --file="$MIGRATION_FILE"

cat > /usr/local/sbin/imds-postgres-backup <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
BACKUP_DIR=/var/backups/imds-super-admin/postgres
install -d -o postgres -g postgres -m 0750 "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
sudo -u postgres pg_dump --format=custom --compress=9 --file="$BACKUP_DIR/imdssa-$stamp.dump" imdssa
find "$BACKUP_DIR" -type f -name 'imdssa-*.dump' -mtime +14 -delete
EOF
chmod 0750 /usr/local/sbin/imds-postgres-backup

cat > /etc/systemd/system/imds-postgres-backup.service <<'EOF'
[Unit]
Description=IMDS Super Admin PostgreSQL backup
After=postgresql.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/imds-postgres-backup
EOF

cat > /etc/systemd/system/imds-postgres-backup.timer <<'EOF'
[Unit]
Description=Daily IMDS Super Admin PostgreSQL backup

[Timer]
OnCalendar=*-*-* 02:30:00 UTC
Persistent=true
RandomizedDelaySec=300

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now imds-postgres-backup.timer

systemctl is-active --quiet postgresql
sudo -u postgres psql --set=ON_ERROR_STOP=1 --dbname=imdssa --tuples-only --no-align --command="select 'database=' || current_database() || ',schema=' || case when to_regnamespace('app') is null then 'missing' else 'ready' end;"

if ss -lnt | awk '$4 ~ /(^|:)5432$/ {print $4}' | grep -Eq '(^|\[)(0\.0\.0\.0|::)(\]|):5432$'; then
  echo "PostgreSQL is unexpectedly exposed on a public wildcard address" >&2
  exit 1
fi

echo "IMDS PostgreSQL is ready on 127.0.0.1:5432"
echo "Credentials: $ENV_FILE"
echo "Backups: $BACKUP_DIR"
