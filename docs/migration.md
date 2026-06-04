# Migration Guide - v1.0 to v1.1

This guide is for organisations already running TrustM365 v1.0 and upgrading in place to v1.1.

## Will existing v1.0 data carry over?

Yes. v1.1 startup migrations are designed to be additive and idempotent:

- new tables are created with `CREATE TABLE IF NOT EXISTS`
- new columns are added only when missing
- new built-in area rows are backfilled with `INSERT OR IGNORE`

Your existing tenants, baselines, drift history, restore log, reports, and custom collectors are preserved.

One intentional exception exists:

- legacy `entra_security_defaults` rows are removed during migration because this area is no longer used in v1.1.

## Low-impact upgrade strategy (recommended)

Use a short maintenance window and complete these steps in order.

### 1) Pre-upgrade backup (mandatory)

```bash
npm run db:backup
```

Also back up:

- your `.env` file
- any deployment-specific startup/config files
- for Docker: verify the database volume name and host backup policy

Backup output location from `npm run db:backup`:

- timestamped `.db` files are written under `data/backups/` in the repository
- keep at least one copy outside the app host (for example secure file share or object storage)

### Backup file placement and restore target paths

| Deployment type | Active DB path (`DATABASE_PATH`) | Where to keep backup files | Restore destination before starting v1.1 |
| --- | --- | --- | --- |
| Local / VM | `./data/trustm365.db` | `./data/backups/` and off-host copy | `./data/trustm365.db` |
| Docker Compose | `/data/trustm365.db` (inside container, backed by volume) | host backup location outside container plus optional `/data/backups/` copy | `/data/trustm365.db` in the same persistent volume |
| Azure App Service | `/home/data/trustm365.db` | `/home/data/backups/` and external copy | `/home/data/trustm365.db` |

Rule: restore the chosen backup file to the exact `DATABASE_PATH` used by the deployment. Do not restore to `data/backups/` and start the service from there.

### Restore examples (perform with services stopped)

Local / VM (PowerShell):

```powershell
Copy-Item ".\\data\\backups\\<backup-file>.db" ".\\data\\trustm365.db" -Force
```

Local / VM (bash):

```bash
cp ./data/backups/<backup-file>.db ./data/trustm365.db
```

Docker Compose (copy backup into mounted DB path, then start):

```bash
docker compose down
docker run --rm \
  -v trustm365-data:/data \
  -v "$(pwd)/data/backups:/backup" \
  alpine sh -c "cp /backup/<backup-file>.db /data/trustm365.db"
docker compose up -d
```

If you run PowerShell, use `${PWD}.Path` in place of `$(pwd)`.

Azure App Service:

- place restored database at `/home/data/trustm365.db`
- ensure App Service storage remains enabled: `WEBSITES_ENABLE_APP_SERVICE_STORAGE=true`
- restart the app after restore

### 2) Staging rehearsal (strongly recommended)

- restore a copy of production DB into staging
- deploy v1.1 in staging
- start backend once (this executes migrations)
- verify tenants, baselines, drift history, and reports

### 3) Upgrade binaries/code to v1.1

```bash
git pull
npm run install:all
cd frontend && npm run build && cd ..
```

For Docker deployments, use your normal update flow:

```bash
git pull
docker compose down
docker compose up -d --build
```

### 4) Controlled cutover

- stop scheduled sync/restore actions (or pause user activity briefly)
- take one final DB backup immediately before cutover
- start v1.1 services

### 5) Post-cutover validation

Run these checks before declaring success:

```bash
npm --prefix frontend test
npm run go-live:smoke
```

Recommended pass criteria:

- frontend tests pass
- smoke report shows `Failed: 0`
- key UI routes load (Dashboard, Reports, Custom Collectors, MSSP Settings)

## Rollback plan (if needed)

If any critical issue appears after cutover:

1. stop v1.1 services
2. restore the pre-upgrade DB backup to the active `DATABASE_PATH` location
3. redeploy/start v1.0 build
4. verify login/tenant/configuration visibility

Because backup is taken before migration, rollback restores v1.0 state without configuration loss.

## Deployment-specific notes

- Azure App Service: keep `DATABASE_PATH` on persistent `/home` storage to preserve data across restarts/deployments.
- Docker Compose: keep `DATABASE_PATH=/data/trustm365.db` and persistent volume mapping intact.
- Local/VM installs: do not change `DATABASE_PATH` during upgrade unless intentionally migrating data location.
