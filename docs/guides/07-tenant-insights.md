# Guide 07 — Tenant Insights

The Tenant Insights panel appears on the tenant dashboard below the Overview tiles. It provides real-time security telemetry fetched from Microsoft Graph.

---

## Panels

| Panel | Shows | Permission required |
|---|---|---|
| **MFA Registration** | % of users registered, count not registered, passwordless count | `AuditLog.Read.All` + Entra ID P1/P2 |
| **Authentication Methods** | Method breakdown by type with phishable-method warnings | `AuditLog.Read.All` + Entra ID P1/P2 |
| **Users & Guests** | Member vs guest vs disabled with high-guest-ratio alert | `User.Read.All` |
| **Groups** | Total groups by type (Security, M365, Distribution, Dynamic) | `Group.Read.All` |
| **App Registrations** | Credential health — valid, expiring, expired | `Application.Read.All` |
| **Devices** | Managed device count, join type, OS breakdown | `User.Read.All` |

---

## MFA Registration panel

Shows:

- A donut chart: registered vs not registered
- Count of passwordless-capable users
- Warning: "⚠ X users without MFA — review and enforce" when any users lack registration

A red banner appears when the count of unregistered users exceeds your configured threshold.

> **Requires** `AuditLog.Read.All` permission in the App Registration, and a **Microsoft Entra ID P1 or P2** licence on the tenant. Without either, the panel shows "Requires additional Graph permissions" with a link to the prerequisites guide.

---

## Authentication Methods panel

Shows a horizontal bar chart for each method in use:

| Method | Category |
|---|---|
| Microsoft Authenticator (Push) | ✅ Phishing-resistant |
| FIDO2 Security Key | ✅ Phishing-resistant |
| Windows Hello for Business | ✅ Phishing-resistant |
| Software TOTP | ⚠ Acceptable |
| SMS | 🔴 Phishable |
| Voice Call | 🔴 Phishable |

A yellow warning banner appears when SMS or Voice methods are in active use.

> **Requires** `AuditLog.Read.All` permission and Entra ID P1/P2.

---

## Users & Guests panel

Shows:

- Members / Guests / Disabled counts with progress bars
- Guest ratio percentage
- Warning when guest ratio exceeds 20%

No additional permissions beyond `User.Read.All` (already required for User Accounts monitoring).

---

## Refreshing insights

Insights are fetched on demand, not on every sync (to avoid excessive API calls). Click **Refresh** in the panel header to pull updated data.

Insights are cached in memory — they persist for the current session but reset on server restart. For scheduled insights, use the reporting feature.

---

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| MFA/Auth Methods show "unavailable" | `AuditLog.Read.All` not granted, or tenant lacks Entra ID P1/P2 | Add `AuditLog.Read.All` in Entra → grant admin consent. Confirm tenant has Entra ID P1/P2 licence. |
| Devices panel empty | Tenant has no managed devices | Expected for cloud-only or unmanaged device tenants |
| Guest ratio panel not shown | No guest users exist | Expected — the panel only appears when guest data is present |
