# Guide 02 — Configuring a baseline

> A baseline is your declaration of the correct, intended configuration for a resource area. TrustM365 compares every subsequent sync against it and alerts you when anything drifts.

---

## Concepts

**Resource area** — a category of Microsoft 365 configuration, e.g. User Accounts, Conditional Access Policies, Compliance Policies. Each area has its own baseline.

**Resource** — an individual item within an area, e.g. a specific user, a specific CA policy, a specific compliance policy.

**Watchable property** — a field on a resource that can be monitored, e.g. `accountEnabled`, `state`, `passwordPolicies`.

**Monitoring mode** — how a resource is monitored: Properties (specific fields) or Snapshot (entire resource hash).

---

## Step 1 — Pull live data

Before you can set a baseline, TrustM365 needs the current configuration to work from.

On the tenant dashboard, click **Sync All** to pull all areas at once, or navigate to a specific area and click **Pull Live Data** in the top-right.

Live data is stored in the database — you do not need to be online at baseline-setting time once data has been pulled.

---

## Step 2 — Open the Baseline Editor

From the tenant dashboard, click **Manage** on the area card you want to baseline. Then click **Edit Baseline** (or **Set Baseline** if none exists yet) in the top-right.

Alternatively, navigate directly to an area via the sidebar and click the **Edit Baseline** button.

---

## Step 3 — Include resources

When you first open the Baseline Editor for an area, all resources appear in the **Not in Baseline** section — nothing is monitored by default.

**Include individual resources:** Click **+ Include** next to any resource to add it to the baseline.

**Include all resources:** Click **Select All** to add everything at once. This is the recommended starting point — you can exclude individual items afterwards.

**Exclude a resource:** Expand an included resource and choose **Remove** from the mode selector. The resource moves back to Not in Baseline and is ignored on future syncs.

> **Tip:** Use the search bar above the resource list to find specific resources by name or ID when an area has many resources (e.g. User Accounts in a large tenant).

---

## Step 4 — Choose a monitoring mode

Expand any included resource to choose how it is monitored.

### Properties mode (recommended)

Monitor only specific named fields. Only those fields can trigger drift — all other changes are ignored.

1. Expand the resource
2. Make sure **Properties** is selected in the mode dropdown
3. Tick the fields you want to watch

Choose fields that are security-relevant and unlikely to change for legitimate operational reasons. For example, on a Conditional Access policy you might watch `state` and `grantControls` but not `displayName`.

**When to use:** Most resources. Gives you precise, low-noise drift detection.

### Snapshot mode

Hash the entire resource. Any change to any non-volatile field triggers drift.

Volatile fields (dates, internal metadata like `lastModifiedDateTime`, `@odata.type`) are automatically excluded from the hash.

**When to use:** Resources where any change matters and you want to catch everything — e.g. a specific admin account you never expect to change, or a critical security policy.

> **Warning:** Snapshot mode on frequently-updated resources (e.g. devices, dynamic groups) will cause constant drift. Use Properties mode for those.

---

## Step 5 — Organise with resource groups (optional)

If an area has many resources, group them to keep the Area View tidy.

Click **+ New Group**, enter a name, choose a colour, and then assign resources to it by ticking them in the group card.

Groups appear as collapsible sections in the Area View with their own drift count. They have no effect on what is monitored — they are display only.

---

## Step 6 — Save the baseline

Click **Save Baseline** at the top of the editor.

A **Label** field lets you name this version, e.g. `Production Baseline — March 2026`. The label appears in the Baseline History tab and in reports.

> If you leave the label blank, TrustM365 uses the default baseline label from MSSP Settings (or `"Baseline"` if none is set).

The previous baseline (if any) is automatically archived before the new one is saved. You can restore any previous version from the Baseline History tab.

---

## After saving

The area view updates immediately:

- The header shows **Baseline Active** in green
- The next sync will compute drift against this baseline
- Properties mode: only your selected fields are evaluated
- Snapshot mode: the full resource hash from this save becomes the reference

---

## Editing an existing baseline

Click **Edit Baseline** at any time to return to the editor. Common reasons:

- **Adding a new resource:** A new policy was created in the tenant — include it so it is monitored
- **Removing a resource:** A policy was intentionally deleted — exclude it so the "missing" alert clears
- **Changing which properties to watch:** You realised a field is too noisy — untick it

Always save after editing. The previous baseline is archived automatically.

---

## Baseline version history

The **Baseline History** tab in the Area View shows all archived versions. Click **Restore** on any version to make it the active baseline. Useful when:

- A change was intentional but you want to roll back the baseline to a previous configuration
- You accidentally saved incorrect baseline values

---

## Common baseline configurations

### User Accounts

Recommended properties to watch: `accountEnabled`, `passwordPolicies`, `passwordProfile.forceChangePasswordNextSignIn`

Avoid watching: `displayName`, `jobTitle`, `department` — these change legitimately through HR processes.

### Conditional Access Policies

Recommended properties to watch: `state`, `conditions`, `grantControls`, `sessionControls`

Use Properties mode and watch all four. CA policy drift is one of the most security-critical signals.

### Compliance Policies (Intune)

Recommended properties to watch: `passwordRequired`, `bitLockerEnabled`, `storageRequireEncryption`, `osMinimumVersion`

### Endpoint Security — Firewall

Use Properties mode. Watch the `settings` array — this is the complete settings catalog payload and any change to any firewall rule will surface as drift.

