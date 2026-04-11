# Guide 17 — Credential rotation

App Registration client secrets expire. When one expires, TrustM365 can no longer authenticate with Microsoft Graph — all syncs fail silently, and drift monitoring stops. This guide explains how to rotate the secret without losing any data.

---

## When rotation is needed

TrustM365 detects authentication failures automatically. When a sync returns a 401 Unauthorized error, a red banner appears on the tenant dashboard:

```
🔴 Authentication failed — client secret may have expired

TrustM365 could not authenticate with Microsoft Graph. This usually means the App
Registration client secret has expired or been deleted. Enter a new secret below
to restore monitoring.

                                                        [Update Secret]
```

The banner also shows the timestamp of the last failed sync.

> You do not need to wait for the banner. You can rotate credentials proactively before a secret expires by following the same steps.

---

## Step 1 — Create a new secret in Entra ID

1. Open [entra.microsoft.com](https://entra.microsoft.com)
2. Navigate to **Identity → Applications → App registrations**
3. Select the App Registration used for this tenant
4. Click **Certificates & secrets → Client secrets**
5. Click **+ New client secret**
6. Set a description (e.g. `TrustM365 — rotated March 2026`) and expiry (`24 months` recommended)
7. Click **Add**
8. **Copy the Value immediately** — it is only shown once

> Copy the **Value** column, not the Secret ID. They look similar but are different.

---

## Step 2 — Update the secret in TrustM365

On the tenant dashboard, click **Update Secret** in the authentication failure banner.

An inline form appears below the banner:

```
New Client Secret Value  [_____________________]

                         [Save & Validate]  [Cancel]
```

Paste the new secret value and click **Save & Validate**.

TrustM365 will:

1. Authenticate with Microsoft Graph using the new secret
2. If authentication succeeds: save the encrypted secret, evict the cached MSAL client, clear the error banner
3. If authentication fails: return an error and leave the current (failing) secret unchanged

---

## Step 3 — Verify

The authentication failure banner disappears immediately on success.

Run **Sync All** on the dashboard to confirm monitoring has resumed. The dashboard should show fresh sync timestamps per area.

---

## Step 4 — Delete the old secret

Once you have confirmed the new secret works:

1. Return to Entra ID → Certificates & secrets
2. Find the old secret (it will show as expired or will expire soon)
3. Click **Delete** and confirm

> Never delete the old secret before confirming the new one works in TrustM365.

---

## Proactive rotation (before expiry)

Do not wait for secrets to expire — expired secrets cause monitoring gaps.

**Recommended practice:** Rotate secrets at least 30 days before their expiry date. Set a calendar reminder when you create a secret.

Secret expiry is visible in Entra ID under **Certificates & secrets**. The expiry date is also shown in the TrustM365 tenant overview (where credential health is surfaced in the App Registrations panel).

---

## Rotating without downtime

App Registrations can have multiple active client secrets simultaneously. This means you can:

1. Create the new secret (it is immediately active)
2. Update TrustM365 to use the new secret
3. Verify monitoring works
4. Delete the old secret

There is zero monitoring downtime using this approach.

---

## What is not affected by rotation

Rotating credentials does not affect:

- ✅ Baselines — all baseline data is preserved
- ✅ Drift history — all historical drift results are preserved
- ✅ Restore logs — all restore audit records are preserved
- ✅ Reports — all generated reports are preserved
- ✅ Custom collectors — definitions and data are preserved
- ✅ MSSP settings — branding and webhook configuration are preserved

---

## If rotation fails

| Error | Cause | Fix |
|---|---|---|
| "Credential validation failed: Authentication failed" | New secret value is incorrect or was copied with whitespace | Re-copy the secret from Entra (click the copy icon, do not select manually) |
| "Credential validation failed: 401" | Admin consent may not have been re-applied | Grant admin consent for all permissions in Entra ID |
| Form does not appear | The banner is not showing (no error detected yet) | The tenant may still be using a working but near-expiry secret — rotation is still recommended |

---

## Changing the Client ID or Tenant ID

These values cannot be changed after tenant registration. If the App Registration itself needs to change (e.g. the old one was deleted), you must:

1. Remove the tenant from TrustM365 (**Warning:** this deletes all baselines and history)
2. Re-register the tenant with the new App Registration credentials

Export any reports you need before removing the tenant.
