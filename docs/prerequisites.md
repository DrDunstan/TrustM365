# Prerequisites — Entra ID App Registration

> **Complete this before deploying TrustM365.** All deployment options (Local, Azure, Docker) require a working App Registration.

TrustM365 connects to Microsoft 365 using an **App Registration** with the OAuth 2.0 client credentials flow — no user sign-in is required. The application uses a service principal that you grant specific, least-privilege permissions to read and optionally restore your tenant configuration.

---

## What you will need

- Access to [entra.microsoft.com](https://entra.microsoft.com) as a **Global Administrator**
- About 10 minutes

At the end of this guide you will have three values ready:

| Value | Where to find it |
|---|---|
| **Directory (Tenant) ID** | Entra → App registrations → your app → Overview |
| **Application (Client) ID** | Entra → App registrations → your app → Overview |
| **Client Secret Value** | Created in Step 3 below — copy immediately, shown only once |

---

## Step 1 — Create the App Registration

1. Sign in to [entra.microsoft.com](https://entra.microsoft.com)
2. Navigate to **Identity → Applications → App registrations**
3. Click **New registration**
4. Set **Name** to `TrustM365`, set **Supported account types** to `Accounts in this organizational directory only`, leave **Redirect URI** blank
5. Click **Register**

On the **Overview** page, copy and save your **Application (client) ID** and **Directory (tenant) ID**.

---

## Step 2 — Add API Permissions

TrustM365 uses **Application permissions** (not delegated) — it acts as itself, not on behalf of a signed-in user.

1. Click **API permissions**
2. Click **Add a permission → Microsoft Graph → Application permissions**
3. Search for and add the permissions from the tables below

### Core monitoring permissions (read-only)

These are required for baseline drift detection across the main resource areas.

| Permission | Covers |
|---|---|
| `Policy.Read.All` | Conditional Access policies and authentication policies |
| `RoleManagement.Read.Directory` | Entra directory role assignments |
| `User.Read.All` | User accounts |
| `Group.Read.All` | Security groups and Microsoft 365 groups |
| `Application.Read.All` | App registrations and credential expiry |

### Microsoft Intune (optional — requires Intune licence)

| Permission | Covers |
|---|---|
| `DeviceManagementConfiguration.Read.All` | Intune compliance policies, configuration profiles, update rings, and endpoint security monitoring |
| `DeviceManagementConfiguration.ReadWrite.All` | Intune restore capability (compliance, config profiles, update rings, endpoint security) |
| `DeviceManagementServiceConfig.Read.All` | Mobile Threat Defense connector monitoring |
| `DeviceManagementServiceConfig.ReadWrite.All` | Mobile Threat Defense connector restore |
| `DeviceManagementApps.Read.All` | App Protection Policies (MAM) — iOS/Android data protection monitoring |

### Tenant Insights panel (optional — requires Entra ID P1 or P2)

| Permission | Covers |
|---|---|
| `AuditLog.Read.All` | MFA registration rates and authentication method breakdown in the Tenant Insights panel |

Without `AuditLog.Read.All`, the MFA Registration and Authentication Methods panels in Tenant Insights will show as unavailable. All other panels (Users & Guests, Devices) use `User.Read.All` which is already required for monitoring.

> **Licence note:** The MFA registration report API (`/reports/credentialUserRegistrationDetails`) requires a Microsoft Entra ID P1 or P2 licence on the tenant. On tenants with only Entra ID Free, this panel will show as unavailable regardless of permissions.

### SharePoint & Microsoft Teams (optional — collaboration and content)

These areas pull data from Microsoft Graph endpoints that expose SharePoint site collections, drives, sharing links and Microsoft Teams metadata (teams, members, owners and team settings). These endpoints can be subject to stricter throttling and polling guidance from Microsoft Graph; TrustM365 treats SharePoint and Teams as best-effort areas and may poll them less frequently to avoid excessive Graph usage.

Note: TrustM365 surfaces a small set of summarised signals for SharePoint and Teams to aid triage and reporting. These summary keys are monitor-only (displayed in the Area view and included in exports), while supported policy and membership fields can still be restored where write permissions are granted.

- SharePoint watchable/summary keys: `anonymousLinkCount`, `anonymousLinks`, `externalShareCount`, `externalShareSamples`, `topExternallyShared`.
- Teams watchable/summary keys: `guestCount`, `guestSamples`, `installedAppCount`, `installedApps`, `privilegedInstalledApps`.

Detailed samples (e.g. installed apps or permission entries) are fetched on a best-effort basis and may require additional Graph permissions or be subject to throttling. If you need full coverage for drive-level or app-level details, ensure the App Registration includes the appropriate Graph permissions and monitor the polling behaviour to stay within API rate limits.

| Permission | Covers |
|---|---|
| `Sites.Read.All` | Read site collections, drive metadata and sharing entries (SharePoint monitoring) |
| `Sites.Manage.All` | Manage site properties and drive-level sharing (SharePoint restore) |
| `SharePointTenantSettings.Read.All` | Read SharePoint tenant-level security and sharing settings |
| `SharePointTenantSettings.ReadWrite.All` | Restore SharePoint tenant-level security and sharing settings |
| `Team.ReadBasic.All` | Read basic Teams metadata, members and owners (Teams monitoring) |
| `TeamSettings.ReadWrite.All` | Team settings write operations (Teams restore) |
| `TeamworkAppSettings.Read.All` | Read Teams organization app settings |
| `TeamworkAppSettings.ReadWrite.All` | Restore Teams organization app settings |
| `GroupMember.ReadWrite.All` | Team membership write operations (restore members and owners) |

> Note: TrustM365 separates Teams policy restore and membership restore. Policy restore uses `TeamSettings.ReadWrite.All`; membership restore uses `GroupMember.ReadWrite.All`.

### Restore permissions (write — optional)

Add these to enable the one-click restore feature. You can add them at any time — TrustM365 re-checks permissions on every sync and enables restore automatically without any reconfiguration.

| Permission | Enables restore for |
|---|---|
| `Policy.ReadWrite.ConditionalAccess` | Conditional Access policies |
| `Policy.ReadWrite.AuthenticationMethod` | Authentication method policies |
| `RoleManagement.ReadWrite.Directory` | Directory role assignments |
| `User.ReadWrite.All` | User account properties |
| `Group.ReadWrite.All` | Group settings |
| `GroupMember.ReadWrite.All` | Team and Microsoft 365 group membership (members and owners) |
| `Application.ReadWrite.All` | App registration settings |

> **Read-only deployment:** Omit all `ReadWrite` permissions if you only need drift detection. Restore buttons are hidden automatically. Tenant Insights MFA panels require `AuditLog.Read.All` separately.
> **Entra ID Free tenants:** `Policy.ReadWrite.ConditionalAccess` and the Intune permissions can be omitted — those areas are automatically shown as **Licence required** and are never counted as errors.

### Custom collectors

Custom collectors can pull from any Microsoft Graph endpoint. If the endpoint you choose requires a permission not listed above (for example, `/identity/conditionalAccess/namedLocations` requires `Policy.Read.All` which is already in the list), you will need to add that permission separately. TrustM365's test-pull step will return a clear 403 error if a required permission is missing.

---

## Step 3 — Grant Admin Consent

All Application permissions require admin consent before they take effect.

1. Click **Grant admin consent for [your organisation name]**
2. Click **Yes** when prompted
3. All added permissions should show a green **✓ Granted** under Status

> If the button is greyed out, you do not have Global Administrator rights. Ask your Entra admin to grant consent.

---

## Step 4 — Create a Client Secret

1. Click **Certificates & secrets**
2. Click **New client secret**
3. Set a description (`TrustM365`) and expiry (`24 months` recommended)
4. Click **Add**
5. **Copy the Value column immediately** — Azure never shows this value again once you navigate away

---

## You are ready

You now have everything needed to register a tenant in TrustM365:

- ✅ Directory (Tenant) ID
- ✅ Application (Client) ID
- ✅ Client Secret Value

→ **Next: [Deploy TrustM365](deployment.md)**

---

## Rotating your client secret

When your secret is approaching expiry (visible in **Certificates & secrets**, and flagged in TrustM365's Tenant Overview when within 30 days):

1. In Entra, create a new secret with a fresh expiry date and copy the value
2. In TrustM365, click the tenant in the sidebar → edit → update the **Client Secret** field
3. TrustM365 validates the new secret immediately
4. Delete the old secret from Entra once confirmed working

---

## Permissions summary

| Permission | Read | Write | Required for |
|---|:---:|:---:|---|
| `Policy.Read.All` | ✅ | — | Auth policies · CA policies |
| `RoleManagement.Read.Directory` | ✅ | — | Role assignment monitoring |
| `User.Read.All` | ✅ | — | User monitoring · Tenant Insights |
| `Group.Read.All` | ✅ | — | Group monitoring |
| `Application.Read.All` | ✅ | — | App registration monitoring |
| `DeviceManagementConfiguration.Read.All` | ✅ | — | Intune compliance, config, update rings, endpoint security |
| `DeviceManagementServiceConfig.Read.All` | ✅ | — | Mobile Threat Defense connector monitoring |
| `DeviceManagementApps.Read.All` | ✅ | — | App Protection Policies (MAM) — iOS/Android |
| `AuditLog.Read.All` | ✅ | — | Tenant Insights — MFA registration + auth method breakdown (requires Entra ID P1/P2) |
| `Sites.Read.All` | ✅ | — | SharePoint site monitoring (site collections, drives, sharing links) |
| `Sites.Manage.All` | — | ✅ | SharePoint site management / restore |
| `Team.ReadBasic.All` | ✅ | — | Microsoft Teams metadata and members monitoring |
| `TeamSettings.ReadWrite.All` | — | ✅ | Teams settings restore |
| `GroupMember.ReadWrite.All` | — | ✅ | Teams membership restore (members and owners) |
| `Policy.ReadWrite.ConditionalAccess` | — | ✅ | CA policy restore |
| `Policy.ReadWrite.AuthenticationMethod` | — | ✅ | Auth policy restore |
| `RoleManagement.ReadWrite.Directory` | — | ✅ | Role assignment restore |
| `User.ReadWrite.All` | — | ✅ | User property restore |
| `Group.ReadWrite.All` | — | ✅ | Group setting restore |
| `Application.ReadWrite.All` | — | ✅ | App registration restore |
| `DeviceManagementConfiguration.ReadWrite.All` | — | ✅ | Intune policy restore (compliance, config, update rings, endpoint security) |
| `DeviceManagementServiceConfig.ReadWrite.All` | — | ✅ | Mobile Threat Defense connector restore |

### Exchange Online (optional — mailboxes)

Exchange collectors fetch mailbox-level settings (automatic replies, language/timezone), forwarding indicators, and policy/routing snapshots where available through Graph beta endpoints.

- Exchange watchable/summary keys include mailbox settings and forwarding indicators, plus connector/transport-rule payload summaries when those endpoints are available.

| Permission | Covers |
|---|---|
| `MailboxSettings.Read` | Read user mailbox settings (automatic replies, time zone, language) |
| `MailboxSettings.ReadWrite` | Restore mailbox security settings in the `exchange_mailbox_security` collector |
| `Policy.Read.All` | Read Exchange connector and transport-rule snapshots (best effort via Graph beta endpoints) |

Collectors with no Graph ReadWrite capability (read-only only):

- `exchange_connectors` (`Policy.Read.All`)
- `exchange_transport_rules` (`Policy.Read.All`)
- `intune_app_protection` (`DeviceManagementApps.Read.All`)

In tenant screens, these collectors are shown as `ReadWrite: Not available for this collector`.

**Enabling the Mailboxes area:**

- Grant `MailboxSettings.Read` (application permission) and then use **Grant admin consent** so the permission takes effect. The Mailboxes area will unlock for monitoring once the permission is present. TrustM365 accepts legacy `.All` variants (for example `MailboxSettings.Read.All`) for compatibility.
- Add `MailboxSettings.ReadWrite` to enable restore actions in the `exchange_mailbox_security` collector.
- Add `Policy.Read.All` if you want connector and transport-rule collectors to populate when the tenant exposes those Graph beta endpoints.
- After granting permissions and consent, refresh the tenant's permissions in TrustM365 (click ⚙ → **Sync Permissions** in the tenant view) or call:

```bash
POST /api/tenants/:id/refresh-permissions
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Authentication failed when registering tenant | Re-copy each value fresh from Entra. Check for trailing spaces or newlines. |
| Admin consent button greyed out | You need Global Administrator. Ask your Entra admin to grant consent. |
| 403 errors on sync after successful registration | Admin consent may not have propagated. Wait 5 minutes and try again. Verify all permissions show ✓ Granted. |
| Restore returns 403 | The matching `ReadWrite` permission is missing or consent was not granted for it. |
| Tenant Insights MFA panel shows unavailable | `AuditLog.Read.All` not granted, or tenant lacks Entra ID P1/P2. Add permission and grant admin consent. |
| MTD Connectors area locked after adding permission | Cached permissions are stale — click ⚙ → **Sync Permissions** on the tenant dashboard to re-check from Graph immediately. |
| Custom collector test-pull returns 403 | The endpoint requires a permission not yet granted. Check the Graph API documentation for the endpoint's required permissions, add it, and grant consent. |
