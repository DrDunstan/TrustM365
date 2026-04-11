# Guide 05 — The Dashboard

The tenant dashboard is the operational centre for a single tenant. Open it by clicking any tenant name in the sidebar.

---

## Layout

```
┌─────────────────────────────────────────────────────┐
│  Tenant Name                     [Auto-Restore] [⚙]  │
│  tenant-id                       [Report] [Sync All]  │
├─────────────────────────────────────────────────────┤
│  Auth failure banner (if last sync failed)            │
├─────────────────────────────────────────────────────┤
│  Tenant Overview tiles (Groups / Apps / Devices)      │
├─────────────────────────────────────────────────────┤
│  Tenant Insights panel                                │
├─────────────────────────────────────────────────────┤
│  BASELINE STATUS strip (Drifted / Clean / No Baseline)│
├─────────────────────────────────────────────────────┤
│  RESOURCE AREAS                          Reset order  │
│  ▼ Microsoft Entra ID                                 │
│    Role Assignments  ·  User Accounts  ·  Groups …    │
│  ▼ Microsoft Intune                                   │
│    Compliance  ·  Config Profiles  ·  Update Rings …  │
└─────────────────────────────────────────────────────┘
```

---

## Header actions

| Button | Action |
|---|---|
| **Sync All** | Pulls live data and runs drift checks for all areas in parallel |
| **Report** | Opens the Generate Report modal for this tenant |
| **Auto-Restore** | Opens the Auto-Restore panel showing toggle state per area |
| **⚙ Settings** | Opens the per-tenant settings panel (Drift Settings and App Registration) |

---

## Auth failure banner

If the last sync failed, a banner appears at the top of the dashboard identifying the error type:

- 🔴 **Authentication failed** — client secret has likely expired. An **Update Secret** button opens an inline rotation form.
- 🟡 **Permission denied** — the App Registration is missing a Graph permission.
- 🟡 **Network error** — Graph could not be reached. The next scheduled sync will retry.

The banner clears automatically on the next successful sync.

---

## Baseline Status strip

Shows the count of areas in each state for this tenant:

| Tile | Meaning |
|---|---|
| **Drifted** | Areas where monitored config differs from baseline |
| **Clean** | Areas where all monitored config matches baseline |
| **No Baseline** | Areas pulled but never baselined |
| **Unchecked** | Areas with a baseline but not yet synced |

---

## Resource area cards

Each area card shows:

- Area name and description
- Status badge (Clean / Drifted / No Baseline / Unavailable)
- Drift count (when drifted)
- Last checked time (from the most recent sync of that area — **per-area**, not tenant-wide)
- **Sync** — pulls only this area
- **Manage** — opens the Area View

### Reordering areas

Drag the ⠿ grip handle on any area card group header to reorder the groups. Click a group header to collapse it. Both preferences are saved to your browser.

Click **Reset order** above the area grid to restore the default ordering.

---

## Per-tenant settings panel

Click **⚙** in the dashboard header to open the settings panel. It is divided into two sections:

### Drift Settings

| Setting | Description |
|---|---|
| **Automatic drift checks** | Enable or disable scheduled syncs for this tenant, independently of the global `DRIFT_CHECK_INTERVAL_MINUTES` env var |
| **Check interval** | Minimum 5 minutes, maximum 1440 (24 hours). Quick presets: 15m, 30m, 1h, 2h, 6h |

Click **Save** to persist drift settings. Changes take effect on the next cron cycle — no restart required.

### App Registration

| Option | Description |
|---|---|
| **Update Secret** | Rotate the App Registration client secret. Paste the new value from Entra and click **Save & Validate** — TrustM365 authenticates against Graph before saving. If validation fails, the existing secret is left unchanged. Always accessible here, not only when an auth error is showing. |
| **Sync Permissions** | Re-checks all granted permissions live from Microsoft Graph, rebuilds the area permission map, and unlocks any newly consented areas immediately. Use this after adding new permissions to the App Registration in Entra ID. |

---

## Auto-Restore panel

Click **Auto-Restore** in the dashboard header to see the auto-restore state for all areas.

- Toggle individual areas on or off
- View the current drift status per area
- **Enable All** / **Disable All** for bulk operation

When enabled, TrustM365 reverts drift on the next sync cycle automatically.

> Always update the baseline before enabling auto-restore for a configuration you have intentionally changed.
