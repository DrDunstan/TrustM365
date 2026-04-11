# Guide 13 — White-labelling

TrustM365 can be branded for your organisation so that client-facing reports and the dashboard carry your company name, logo, and colours rather than TrustM365 defaults.

Navigate to **MSSP Settings** in the sidebar to configure all branding options.

---

## Organisation name

Sets your company or MSSP name. Appears in:

- The sidebar header (replaces "TrustM365")
- Report cover pages (replaces "TrustM365")
- Report footer on every page
- MSSP commentary labels (reads "Acme Security Commentary" instead of "MSSP Commentary")

---

## Tagline

A short descriptor shown beneath your company name:

- Sidebar header (below the company name, e.g. "Powered by TrustM365")
- Report cover pages (below the logo or company name)
- Report footer (alongside company name)

Examples:
- `Your trusted M365 security partner`
- `Managed Security Services — Melbourne`
- `M365 Configuration Assurance`

Leave blank to show "Powered by TrustM365" as the subtitle in the sidebar, and to omit the tagline from report footers.

---

## Custom logo

Your logo appears in:

- The sidebar header (replaces the TrustM365 shield mark)
- Report cover pages (alongside the company name)

**Uploading a logo:**

Drag and drop or click to browse. Accepted formats: PNG, JPEG, SVG, WebP. Maximum 2 MB.

**Recommended specifications:**
- Square format (e.g. 200×200px) with transparent background
- SVG preferred for crisp rendering at all sizes
- The logo renders at up to 48px height on report covers and 32px in the sidebar

**Removing a logo:**

Click **Remove** on the current logo preview. The TrustM365 shield mark is restored.

---

## Dashboard accent colour

Changes the brand colour used across the **dashboard** — buttons, focus rings, active states, sidebar highlights, and pill borders.

**Preset palettes:** TrustM365 (indigo), Ocean, Teal, Emerald, Amber, Rose, Violet, Slate

**Custom hue:** Use the slider to pick any hue (0–359°) or type a value directly. The colour updates live as you drag — click Save Settings to persist.

This setting is **independent of the report accent colour** — your dashboard can be one colour while your client reports are another.

---

## Report branding

### Report accent colour

All generated reports are always in **light mode** — white background, dark text, professional formatting suitable for printing, PDF, and formal client delivery.

The accent colour controls:

- Section heading underlines
- Table header fill
- MSSP commentary callout border
- Stat value colours

Leave blank to use the dashboard accent colour in reports. Click the colour swatch to open a native colour picker, or type a hex code directly (e.g. `#0ea5e9`).

---


---

**Note:** All timestamps in reports and the UI now use the server's local time (or UTC if not otherwise configured at the OS/container level). The timezone is not configurable in the UI.

---

## "Powered by TrustM365" credit

When a company name is set, the sidebar shows:

```
[Your Logo]  Acme Security Services
             Powered by TrustM365
```

And the report footer shows:

```
Acme Security Services · Your tagline here — TrustM365
```

The "TrustM365" attribution in the footer is intentionally retained — it cannot be removed (this is a condition of the open-source licence).

When running as default TrustM365 (no company name set), the sidebar shows "TrustM365 / by Anto Porter" and the footer shows "TrustM365 — Monitor. Baseline. Restore."

---

## Default baseline label

Sets a template that pre-fills the label field every time a new baseline is created.

Use `{date}` to insert today's date automatically.

Examples:
- `Baseline — {date}` → `Baseline — 20 Mar 2026`
- `Gold Standard Config` → `Gold Standard Config` (static)
- `Post-audit {date}` → `Post-audit 20 Mar 2026`

The label is always editable before saving the baseline, regardless of the template.

---

## Resetting to defaults

Click **Reset to Defaults** in the top-right of MSSP Settings. This removes:

- Company name and tagline
- Custom logo
- Dashboard accent colour
- Report accent colour
- Timezone (resets to UTC)

This cannot be undone. Existing generated reports are not affected — only future reports will use the default TrustM365 branding.
