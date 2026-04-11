# Guide 01 — Registering a tenant

> **Before you start:** You must have completed the [App Registration setup](../prerequisites.md). Have your Tenant ID, Client ID, and Client Secret Value ready.

---

## What this does

Registering a tenant connects TrustM365 to a Microsoft 365 tenant via the Microsoft Graph API using the service principal you created in the prerequisites. Once registered, TrustM365 can pull live configuration and begin drift monitoring.

---

## Step 1 — Open the Add Tenant wizard

Click **+ Add Tenant** at the bottom of the left sidebar.

The wizard opens on the App Registration guide step. If you have already completed the App Registration, skip past this step using the tabs at the top.

---

## Step 2 — Enter credentials

Fill in the four fields:

| Field | Where to find it |
|---|---|
| **Display Name** | A friendly label for this tenant, e.g. `Contoso Production` or `Client — Fabrikam` |
| **Directory (Tenant) ID** | Entra ID → App registrations → your app → Overview |
| **Application (Client) ID** | Entra ID → App registrations → your app → Overview |
| **Client Secret Value** | Certificates & secrets → the **Value** column (not the Secret ID) |

> **Important:** Copy the Client Secret *Value*, not the Secret ID. They look similar but are different fields. The Value is only displayed once in Entra — if you navigate away, you must create a new secret.

Click **Validate & Check Permissions**.

---

## Step 3 — Review permission results

TrustM365 authenticates with your credentials and then checks which Graph API permissions have been granted. Results are shown per resource area:

| Badge | Meaning |
|---|---|
| **Full access** | Read + write permissions granted. Drift monitoring and one-click restore are available. |
| **Read only** | Only read permissions granted. Drift monitoring works; restore buttons are hidden. |
| **Locked** | Required read permission missing. This area will be skipped entirely on sync. |
| **Licence required** | Permissions are present but the tenant does not have the required licence (e.g. no Intune). |

A tenant with some Locked areas is still valid and useful — you can add permissions at any time without re-registering.

---

## Step 4 — Save

Click **Register Tenant**. TrustM365 saves the credentials (encrypted), creates resource area records for all collectors, and selects the tenant in the sidebar.

The tenant's dashboard opens automatically.

---

## What happens next

- The dashboard shows all resource areas with **No Baseline** status — no monitoring has started yet.
- Pull live data for any area by clicking **Sync All** in the dashboard header.
- Set a baseline to begin drift detection. See [Guide 02 — Configuring a baseline](02-configuring-a-baseline.md).

---

## Adding permissions later

If you add new permissions to the App Registration in Entra and grant admin consent, TrustM365 detects them automatically on the next sync. No reconfiguration is needed. The Locked badge will clear and monitoring will begin.

---

## Credential rotation

When the client secret expires (typically every 24 months), a red banner appears on the tenant dashboard. See [Guide 17 — Credential rotation](17-credential-rotation.md) for how to update the secret without losing any data.

---

## Removing a tenant

To remove a tenant, open the sidebar, right-click the tenant name (or use the ••• menu), and select **Remove Tenant**.

> **Warning:** Removing a tenant permanently deletes all baselines, drift history, restore logs, and custom collector data for that tenant. This cannot be undone. Export any reports you need before removing.
