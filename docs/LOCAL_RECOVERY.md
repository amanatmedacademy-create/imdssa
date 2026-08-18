# IMDS Local Recovery

Control Center can keep running and can be recovered on the VPS without GitHub.

## Runtime

- Control Center frontend: `/var/www/imds-super-admin/current`
- Control Center API: `/opt/imds-super-admin/api`
- Local Release Manager: `imds-release-manager.service` on `127.0.0.1:8791`
- Recovery store: `/opt/imds-super-admin/release-bundles`
- Deploy jobs: `/opt/imds-super-admin/local-deploy-jobs`

## Recovery snapshot

`/opt/imds-super-admin/snapshot-control-plane.sh` stores:

- current frontend;
- compiled API and production dependencies;
- migrations;
- Nginx configuration;
- systemd/timer deployment files;
- `imdssa` PostgreSQL custom-format dump;
- Marketing PostgreSQL dump when the local Marketing database container is available;
- SHA-256 checksums for database dumps.

Only the 10 most recent `recovery-*` snapshots are retained.

## Local deploy / rollback

Use **Инфраструктура → Релизы и восстановление** in Control Center. A platform owner/admin can:

1. Create a recovery snapshot.
2. Upload a prepared `.tar.gz` release.
3. Deploy a stored local release.
4. Roll back to a recovery release.
5. Inspect the deployment job log.

Before a local release switch, the runner attempts to create a fresh recovery snapshot of the currently active release.

Application rollback does not automatically overwrite PostgreSQL data. Database dumps are preserved for explicit disaster recovery so a normal application rollback cannot silently destroy newer data.

## Verification

The `Deploy Local Release Manager` workflow verifies on the VPS that:

- the release manager service is active;
- `/release-api/healthz` works directly and through Nginx;
- a recovery snapshot exists;
- frontend and compiled API files are present;
- the `imdssa` database dump is non-empty;
- SHA-256 verification succeeds;
- recovery retention stays within 10 snapshots.

A successful verification publishes commit status `imdssa/local-recovery = success`.

## Operating policy

GitHub remains the preferred development delivery channel, but it is not part of the production runtime dependency chain. Keep at least one verified recovery snapshot on the VPS before major upgrades. Use application rollback first; restore a database dump only as an explicit disaster-recovery action after verifying that newer production data may be discarded.
