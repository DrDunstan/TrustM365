# Deployment

> **Before deploying:** Complete the [App Registration setup](prerequisites.md) — you will need your Tenant ID, Client ID, and Client Secret before TrustM365 can connect to Microsoft 365.

TrustM365 runs anywhere Node.js runs. Three deployment options are available.

| Option | Best for | Complexity |
|---|---|---|
| [**Option 1 — Local Quickstart**](#option-1--local-quickstart) | Evaluation, testing, single administrator | Minimal |
| [**Option 2 — Azure App Service**](#option-2--azure-app-service) | Enterprise teams in the Microsoft ecosystem | Low |
| [**Option 3 — Docker Compose**](#option-3--docker-compose) | Any server with Docker (on-premises or cloud VM) | Low |

---

## Migration

If you are upgrading an existing TrustM365 installation from v1.0 to v1.1, use the dedicated migration runbook:

- [Migration Guide - v1.0 to v1.1](migration.md)

The migration guide includes backup file placement, restore target paths, staging rehearsal, cutover, validation, rollback, and deployment-specific notes.

---

## Option 1 — Local Quickstart

The fastest way to get TrustM365 running. No cloud account, no containers — just Node.js on your machine.

### Prerequisites

- [Node.js 20 LTS](https://nodejs.org) — download the **LTS** version
- [Git](https://git-scm.com/download/win) — or download the zip from [GitHub Releases](https://github.com/AntoPorter/trustm365/releases)

> **Windows users:** TrustM365 uses a pure JavaScript SQLite driver (`sql.js`) — no Visual Studio, no C++ build tools, no native compilation required.

### Setup

```bash
# 1. Clone the repository
git clone https://github.com/AntoPorter/trustm365.git
cd trustm365

# 2. Install all dependencies (frontend + backend)
npm run install:all

# 3. Generate your encryption key
npm run generate:key
# Copy the entire output line — it looks like:
# ENCRYPTION_KEY=a1b2c3d4e5f6...  (64 hex characters)

# 4. Create your environment file
cp .env.example .env

# 5. Open .env and paste your key
# Windows:
notepad .env
# Mac/Linux:
nano .env

# 6. Start TrustM365
npm run dev
```

Open **[http://localhost:5173](http://localhost:5173)** in your browser.

> The terminal must stay open — closing it stops the server. See [Run as a background service](#run-as-a-background-service) below to persist it.

### Environment file (local)

```env
ENCRYPTION_KEY=your_64_char_hex_key_here
DATABASE_PATH=./data/trustm365.db
PORT=3001
NODE_ENV=development
LOG_LEVEL=info
```

`FRONTEND_URL` is not needed locally — leave it blank or omit it.

### Run as a background service

**Windows — PM2:**

```bash
npm install -g pm2
pm2 start backend/src/index.js --name trustm365-api
pm2 start "npm run dev:frontend" --name trustm365-ui
pm2 save
pm2 startup
```

**Linux — systemd:**

Create `/etc/systemd/system/trustm365.service`:

```ini
[Unit]
Description=TrustM365
After=network.target

[Service]
Type=simple
User=trustm365
WorkingDirectory=/opt/trustm365
ExecStart=/usr/bin/node backend/src/index.js
Restart=on-failure
EnvironmentFile=/opt/trustm365/.env

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable trustm365
sudo systemctl start trustm365
```

### Backup

```bash
npm run db:backup
```

Creates a timestamped copy of your database in `data/backups/`.

### Optional SIEM enablement (Log Analytics + Sentinel)

After deployment, you can enable direct TrustM365 telemetry ingestion to Azure Log Analytics and use Sentinel analytics/workbooks.

1. Configure workspace settings in **MSSP Settings -> Log Analytics and Sentinel**.
2. Validate bundled assets:

```bash
npm run sentinel:validate
```

3. Deploy bundled analytic rules:

```powershell
npm run sentinel:deploy -- -SubscriptionId <subId> -ResourceGroup <rg> -WorkspaceName <workspace> -TablePrefix TrustM365
```

4. Import workbook JSON from `data/sentinel/workbooks/TrustM365-Drift-Monthly.workbook.json`.

See `docs/integrations/sentinel-log-analytics.md` for full architecture and operations guidance.

---

## Option 2 — Azure App Service

Recommended for enterprise teams already in the Microsoft ecosystem. Azure App Service hosts the Node.js backend directly and persists SQLite on the App Service filesystem.

**Free tier (F1)** works for evaluation. **Basic B1 (~$13 USD/month)** is recommended for production.

### Prerequisites

- [Azure CLI](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli) installed and signed in (`az login`)
- An Azure subscription
- Node.js 20 LTS installed locally (for the build step)

### Deploy

```bash
# 1. Clone and build
git clone https://github.com/AntoPorter/trustm365.git
cd trustm365
npm run install:all
cd frontend && npm run build && cd ..

# 2. Generate your encryption key
npm run generate:key

# 3. Create Azure infrastructure
az group create \
  --name trustm365-rg \
  --location australiaeast

az appservice plan create \
  --name trustm365-plan \
  --resource-group trustm365-rg \
  --sku B1 \
  --is-linux

# 4. Create the web app (app name must be globally unique)
az webapp create \
  --name trustm365-yourorg \
  --resource-group trustm365-rg \
  --plan trustm365-plan \
  --runtime "NODE:20-lts"

# 5. Set application settings
az webapp config appsettings set \
  --name trustm365-yourorg \
  --resource-group trustm365-rg \
  --settings \
    ENCRYPTION_KEY="your_64_char_hex_key_here" \
    NODE_ENV="production" \
    PORT="8080" \
    LOG_LEVEL="info" \
    DATABASE_PATH="/home/data/trustm365.db" \
    WEBSITES_ENABLE_APP_SERVICE_STORAGE="true"

# 6. Set startup command (recommended for this monorepo layout)
az webapp config set \
  --name trustm365-yourorg \
  --resource-group trustm365-rg \
  --startup-file "cd backend && npm install && node src/index.js"

# 7. Deploy
az webapp up \
  --name trustm365-yourorg \
  --resource-group trustm365-rg \
  --runtime "NODE:20-lts"
```

Dashboard available at: `https://trustm365-yourorg.azurewebsites.net`

Setting `NODE_ENV=production` causes the backend to bind on `0.0.0.0` (required for Azure's platform routing) and serves the built `frontend/dist/` directory directly — no separate nginx container needed. `PORT=8080` is required by Azure App Service — do not change this.

The startup command above is recommended when deploying this repository as a monorepo so Azure starts the backend from the correct working directory and installs backend dependencies during startup.

> **Single-process deployment:** In production mode, Express automatically serves the React frontend from `frontend/dist/` and handles the SPA catch-all for React Router. Run `npm run build` to produce this directory before deploying.

### Persistent storage

`DATABASE_PATH=/home/data/trustm365.db` stores the database on the persistent `/home` filesystem. The database is created automatically on first run.

### Restrict access to your organisation

```bash
az webapp config access-restriction add \
  --name trustm365-yourorg \
  --resource-group trustm365-rg \
  --rule-name "CorporateOnly" \
  --action Allow \
  --ip-address YOUR.CORP.IP.RANGE/24 \
  --priority 100
```

### Separate frontend and backend App Services

If you deploy the frontend and backend as two separate App Services, set `FRONTEND_URL` in the backend's application settings so CORS is correctly configured:

```bash
az webapp config appsettings set \
  --name trustm365-yourorg-api \
  --resource-group trustm365-rg \
  --settings FRONTEND_URL="https://trustm365-yourorg-ui.azurewebsites.net"
```

This is not needed when both are served from the same App Service (the default `az webapp up` deployment).

### Continuous deployment

No deployment workflow is included in this repository by default. If you want CI/CD deployment, add your own pipeline in your target platform (for example GitHub Actions, Azure DevOps, or another orchestrator) and ensure it runs `npm run build` before publishing.

### Updating

```bash
git pull
npm run install:all
cd frontend && npm run build && cd ..
az webapp up \
  --name trustm365-yourorg \
  --resource-group trustm365-rg \
  --runtime "NODE:20-lts"
```

---

## Option 3 — Docker Compose

Best for any server running Docker — on-premises Windows Server, Linux, a home lab NAS, or a cloud VM. No Node.js installation required on the host.

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/) installed
- No Node.js needed on the host

### Deploy

```bash
# 1. Clone the repository
git clone https://github.com/AntoPorter/trustm365.git
cd trustm365

# 2. Generate an encryption key (uses Docker — no Node.js required)
docker run --rm node:20-alpine node \
  -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 3. Create your environment file
cp .env.example .env
# Edit .env — paste your key as ENCRYPTION_KEY
# Set DATABASE_PATH=/data/trustm365.db
# Set NODE_ENV=production

# 4. Build and start TrustM365
docker compose up -d --build
```

Dashboard available at: `http://your-server-ip`

The `docker-compose.yml` builds the frontend image from source, bakes in nginx configuration from `nginx.conf`, and sets `NODE_ENV=production` for the backend automatically. The SQLite database is stored in a named Docker volume and persists across restarts and rebuilds.

### Environment file (Docker)

```env
ENCRYPTION_KEY=your_64_char_hex_key_here
DATABASE_PATH=/data/trustm365.db
NODE_ENV=production
LOG_LEVEL=info
```

`PORT` and `FRONTEND_URL` do not need to be set — Docker Compose configures these internally.

### Updating

```bash
git pull
docker compose down
docker compose up -d --build
```

Your data volume is untouched by rebuilds.

### HTTPS

Place your SSL certificate and private key in a `certs/` folder at the repo root, then uncomment the HTTPS server block in `nginx.conf`. For a free certificate, [Certbot with Let's Encrypt](https://certbot.eff.org/) works alongside the included nginx container.

---

## Environment Variables Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `ENCRYPTION_KEY` | ✅ | — | 64-char hex key. Generate with `npm run generate:key` |
| `DATABASE_PATH` | No | `./data/trustm365.db` | Path to the SQLite database file |
| `PORT` | No | `3001` | Backend API port. Azure App Service requires `8080` |
| `NODE_ENV` | No | `development` | Set to `production` for any hosted deployment. Controls network binding and CORS. |
| `LOG_LEVEL` | No | `info` | `error` \| `warn` \| `info` \| `debug` |
| `FRONTEND_URL` | No | — | Required only when frontend and backend run on separate origins (e.g. two separate Azure App Services). Example: `https://trustm365.yourdomain.com`. Not needed for Docker or single-App-Service deployments. |

### How `NODE_ENV` affects network behaviour

| `NODE_ENV` | Backend binds to | CORS |
|---|---|---|
| `development` (default) | `127.0.0.1` — localhost only, not accessible from the network | Restricted to `localhost:5173` (Vite dev server) |
| `production` | `0.0.0.0` — all interfaces, required for Docker and Azure | Unrestricted (nginx same-origin) or locked to `FRONTEND_URL` if set |

---

## Troubleshooting

| Problem | Likely cause | Fix |
|---|---|---|
| `node is not recognised` | Node.js not installed or terminal not restarted | Restart terminal after installing Node.js |
| `Cannot find module` on startup | Dependencies not installed | Run `npm run install:all` from the root folder |
| `ENCRYPTION_KEY must be 64 hex chars` | `.env` not configured | Run `npm run generate:key` and paste the full output |
| Port already in use | Another process on 3001 | Change `PORT=3002` in `.env`. Update the proxy in `frontend/vite.config.js` |
| Azure — app not starting | PORT not set to 8080 | Set `PORT=8080` in App Service application settings |
| Azure — frontend shows 404 | `frontend/dist/` not built | Run `npm run build` from the repo root before deploying |
| Docker — health check failing | `/api/health` returning non-200 | Check database path is writable; review backend logs |
| Azure — API calls failing from browser | FRONTEND_URL not set on split deployment | Set `FRONTEND_URL` to the frontend App Service URL |
| Docker — backend unreachable from nginx | Docker network or backend health issue | Check `docker compose ps` and `docker compose logs backend`; verify backend is `healthy` and listening on port 3001 |
| Docker — database lost on restart | Volume not mounted | Set `DATABASE_PATH=/data/trustm365.db` and confirm the volume in `docker-compose.yml` |

→ **Next: [Register your first tenant and set a baseline](usage.md)**

---

## Drift Check Intervals

TrustM365 supports one drift check scheduling method (currently):

**Per-tenant interval** — set via the **⚙ Settings** panel on each tenant's dashboard. When enabled, the tenant's own interval takes precedence over the global setting. The sync engine checks whether enough time has elapsed since that tenant's last sync before triggering a check — so a 5-minute global cron will not over-poll a tenant configured for hourly checks.

Changes to per-tenant settings are saved to the database immediately and take effect on the next cron cycle — no restart required in any deployment scenario.
