# Changelog

All notable changes to TrustM365 are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [1.0.0] — 2026-03-20

### Initial Public Release

**Platform foundation**
- React 18 + Vite + Tailwind CSS frontend; Express 4 + MSAL Node + sql.js backend
- SQLite with WAL mode — pure JavaScript driver, no native compilation required on any platform
- AES-256-GCM encryption for all client secrets stored in the database
- JWT-free architecture — no user authentication required; all access via App Registration service principal
- `ENCRYPTION_KEY` environment variable — 64-char hex key, generated with `npm run generate:key`

**Baseline & Drift engine**
- `computeDrift()` — property-level deep diff with `{ path, label }` watched key format
- Snapshot mode — SHA-256 hash of the resource (volatile fields excluded) stored at baseline save; any change detected on next sync
- Properties mode — per-field comparison against baseline values for only the watched fields
- Effective status rule: `drifted + drift_count=0` treated as clean everywhere (prevents post-auto-restore ghost alerts)
- Auto-restore — triggered per-area after drift; post-restore re-pull confirms clean state
- Restore dry-run — `?dryRun=true` returns exact PATCH body without executing

**Resource areas — 15 built-in collectors**

| Area | API | Restorable |
|---|---|---|
| Directory Role Assignments | v1.0 | ✅ |
| User Accounts | v1.0 | ✅ |
| Groups | v1.0 | ✅ |
| App Registrations | v1.0 | ✅ |
| Authentication Policies | v1.0 | ✅ |
| Conditional Access Policies | v1.0 | ✅ |
| Compliance Policies | v1.0 | ✅ |
| Configuration Profiles | v1.0 | ✅ |
| Windows Update Rings | v1.0 | ✅ |
| Mobile Threat Defense Connectors | v1.0 | ✅ |
| App Protection Policies (MAM) | v1.0 | Monitor only |
| Endpoint Security — Antivirus | Beta | ✅ |
| Endpoint Security — Firewall | Beta | ✅ |
| Endpoint Security — Disk Encryption | Beta | ✅ |
| Endpoint Security — Attack Surface Reduction | Beta | ✅ |

**Intune restore fixes**
- Compliance policies — `deviceThreatProtectionEnabled` and `deviceThreatProtectionRequiredSecurityLevel` added to `monitorOnlyKeys`; Graph rejects these fields on tenants without Defender for Endpoint licensing
- Configuration profiles — restore now spreads captured `settings` as top-level PATCH fields on the `deviceConfigurations` endpoint (not nested under `settings`, which does not exist on that resource)
- Endpoint Security policies — `settings` is a navigation property on `configurationPolicies` and cannot be PATCHed in the root body; restore now uses a two-step approach: PATCH the policy metadata, then PATCH each setting individually via `/configurationPolicies/{id}/settings/{settingId}`

**Custom Collectors**
- Define read-only monitoring areas from any Microsoft Graph list endpoint via a three-step wizard
- Auto-detected field types; per-field label editing; per-tenant deployment toggle
- Participate in the same pull, drift, baseline, and history flows as built-in areas

**Reporting**
- HTML tenant reports — Executive Summary, Drift History, Remediation Log, Baseline Coverage, Current Configuration State, Technical Appendix
- Always light mode — clean, professional, print-ready for all reports
- Word (.docx) export — fully structured with proper headings, formatted tables with alternating row shading, MSSP branding throughout, per-page footer with company name
- PDF export via browser print-to-PDF from the in-app viewer
- Report scheduling — weekly or monthly automated generation stored with unread indicator
- MSSP commentary fields per section — label reads `"<CompanyName> Commentary"` when company name is set in MSSP Settings
- MSSP branding applied correctly — `getMsspBranding()` queries `WHERE id = 'singleton'`; company name, tagline, and accent colour appear on report cover pages, section headings, commentary labels, and footers

**Webhook notifications**
- `webhook_destinations` table — per-destination URL, label, scope, fire mode, enabled state
- Fire modes: `first` (fires once per area per incident) or `every` (fires on every confirming sync)
- JSON payload with event, timestamp, tenant, area, drift count and properties
- Test endpoint — sends clearly labelled test payload without affecting fired state

**Permission system**
- `buildAreaPermissionMap` — ReadWrite→Read implication covers all three permission name patterns: `.ReadWrite.` middle, `ReadWrite` compound, `.ReadWrite` suffix
- `POST /api/tenants/:id/refresh-permissions` — live Graph re-check that persists result to `permissions_json` and unlocks newly consented areas immediately
- Client-side permission re-evaluation in `Dashboard.jsx` — stale cached `permissions_json` corrected on load using the same implication logic
- **Permission Sync** button in Settings panel (⚙ → App Registration section) — triggers live refresh and updates area cards without page reload

**Credential rotation**
- `PATCH /api/tenants/:id/credentials` — validates new secret against Graph before saving
- Evicts cached MSAL client on success; clears `last_sync_error`
- Accessible from Settings panel (⚙ → App Registration → Update Secret) at any time

**Auth failure banner**
- Classifies errors: `auth` (401 — expired/revoked secret) shown as dashboard-level banner; 403 per-area permission errors shown as area Locked badge; network errors logged only
- Banner clears automatically on next successful sync

**Settings panel — two-section layout**
- **⚙ → Drift Settings**: automatic drift checks toggle, interval input with quick presets (15m / 30m / 1h / 2h / 6h), Save/Cancel
- **⚙ → App Registration**: Update Secret (credential rotation), Sync Permissions (live permission re-check)
- Re-check Permissions removed from the dashboard header bar — consolidated into the Settings panel

**Portfolio Overview**
- Scorecard view — per-tenant card with coverage bar, area status pills grouped by product
- Matrix view — compact table with one column per area, colour-coded by product group
- Tenant search, status filter, tag filter, and sort (drift count / A–Z / Z–A / recently synced) — all persisted to localStorage

**Sidebar**
- Areas grouped under Microsoft Entra ID (6 areas) and Microsoft Intune (9 areas)
- Per-tenant favourites, collapsible groups, MSSP section
- Company name and tagline shown in sidebar header when set in MSSP Settings ("Powered by TrustM365" as subtitle)
- Logo renders in sidebar header when uploaded

**MSSP Settings**
- Company name, tagline, logo, brand hue (dashboard accent colour)
- Report accent colour — independent of dashboard colour
- Default baseline label template with `{date}` placeholder
- Timezone — IANA timezone select; applied to report scheduler cron and all report timestamps; takes effect immediately on save

**White-labelling**
- Company name drives report title, footer, and commentary label throughout
- Logo renders in sidebar header and on report cover pages
- Brand hue applies a full colour scale to the dashboard

**Baseline Templates (Security Checks)**
- 13 checks across 5 groups referencing Maester and CISA SCuBA identifiers
- MFA, Authentication Methods, Guest & External Access, Admin Account Protection, CA Hygiene
- Per-tenant selection, read-only results, graceful unavailable handling

**Dashboard**
- Per-tenant drift check interval (5 min – 24 hr) with quick presets
- Auto-Restore overview panel with per-area toggles and Enable All / Disable All
- Area group drag-and-drop reordering and collapse state, persisted to localStorage

**Deployment**
- `npm start` → `node backend/src/index.js` (Azure App Service entry point)
- `npm run build` → builds frontend dist (Azure CI step)
- Express serves `frontend/dist/` with SPA catch-all in `NODE_ENV=production`
- Docker Compose with nginx frontend, healthcheck, named volume for SQLite
- `/api/health` endpoint — DB sanity check; used by Docker HEALTHCHECK and `service_healthy`
- GitHub Actions workflow — installs, runs tests, builds frontend, zips artefact, sets Azure startup command, deploys

**Unit tests — 53 passing**
- `test/drift.test.js` — 10 tests: drift engine (properties mode, snapshot mode, none mode, missing resources)
- `test/assembler.test.js` — 28 tests: effectiveStatus, deduplication, outstanding computation
- `test/restore.test.js` — 15 tests: buildRestorePayload, monitor-only field handling, webhook fire-mode logic

**Permissions**
- `AuditLog.Read.All` required for Tenant Insights MFA registration and authentication methods panels (replaces `Reports.Read.All`)
- `DeviceManagementServiceConfig.Read.All` / `ReadWrite.All` required for Mobile Threat Defense connector areas
- `DeviceManagementApps.Read.All` required for App Protection Policies (MAM)
- All ReadWrite permissions imply the corresponding Read — `buildAreaPermissionMap` handles this automatically

**Documentation**
- `README.md` — full feature inventory, all 15 resource areas, complete permissions tables, architecture diagram
- `docs/prerequisites.md` — correct permissions for all areas including MTD `ServiceConfig` and `AuditLog.Read.All` for Tenant Insights
- `docs/deployment.md` — local, Azure App Service, Docker Compose; `TZ` timezone env var documented for all three deployment types
- `docs/guides/` — 18 step-by-step feature guides, all updated to reflect current feature set

---

## Roadmap

### v1.1 — Additional Resource Areas
- [ ] Exchange Online — transport rules, connectors, anti-spam policies
- [ ] Microsoft Teams — meeting policies, external access, app permissions
- [ ] SharePoint / OneDrive — sharing settings, access control

### v1.2 — Access Control
- [ ] Azure AD SSO login for the dashboard
- [ ] Role-based access — read-only vs restore permissions per user
- [ ] Multi-user audit trail
