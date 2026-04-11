# Guide 14 — Baseline Templates (Security Checks)

Navigate to **Baseline Templates** in the MSSP sidebar section.

This is a read-only security assessment layer based on [Maester](https://maester.dev) and [CISA SCuBA](https://www.cisa.gov/scuba) guidance. Checks run independently of tenant baselines and make no changes to any configuration.

---

## Running security checks

1. Tick one or more tenants in the tenant selection panel
2. Click **Run Security Checks**
3. Results appear per tenant, per check group

Results are stored per-tenant and update each time you run.

---

## Check groups

| Group | Checks |
|---|---|
| **Multi-Factor Authentication** | MFA enforced for all users · MFA enforced for admins · Legacy authentication blocked |
| **Authentication Methods** | SMS authentication disabled · Voice call disabled · Phishing-resistant method available |
| **Guest & External Access** | Guest invitations restricted to admins · MFA required for B2B guests |
| **Admin Account Protection** | Compliant device required for admin roles · Global Admin count within recommended limit |
| **Conditional Access Hygiene** | No policies permanently in report-only mode · No permanently disabled policies |

---

## Result states

| State | Meaning |
|---|---|
| ✅ **Pass** | The check condition is met |
| ❌ **Fail** | The check condition is not met — review recommended |
| ⚠ **Unavailable** | The required data or permission is not available (e.g. CA policies require Entra P1/P2) |

---

## Check identifiers

Each check references its Maester ID and CISA SCuBA policy number in the result detail. Use these to trace back to the source guidance when discussing findings with clients.

---

## What security checks are not

Security checks are **not** baseline monitoring. They do not:

- Create baselines
- Detect drift from a saved configuration
- Trigger alerts when something changes
- Restore any values

They answer the question: "Does this tenant currently meet these security recommendations?" — not "has anything changed since last time?"

For ongoing drift monitoring of the same controls, use baselines (see [Guide 02](02-configuring-a-baseline.md)).
