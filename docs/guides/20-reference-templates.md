# Guide 20 — Reference Templates

Reference Templates allow you to evaluate a single tenant's configuration against predefined security and compliance standards. This feature is designed to complement Security Templates by providing a broader scope for tenant assessments.

![Reference Templates page](./visuals/guide-reference-templates.png)

_Visual reference: tenant selection, template selection, and assessment summary view._

---

> **Note:** As of v1.1, Reference Templates support only single-tenant selection. Multi-tenant compare and async compare jobs have been removed.

---

## Using Reference Templates

1. Navigate to **Reference Templates** in the MSSP sidebar.
2. Select a tenant from the tenant selection panel.
3. Choose a template or multiple templates to evaluate.
4. Click **Run Template Checks** to assess the selected templates against the chosen tenant.

Results are displayed for the selected tenant. Use the **View details** option to see a detailed breakdown of results.

---

## Key Features

- **Template Selection**: Choose from a library of predefined templates to evaluate tenant configurations.
- **Tenant Selection**: Assess a single tenant at a time (v1.1 and later).
- **Aggregated Results**: View per-template results for a comprehensive overview.
- **Export Options**: Download results in CSV or JSON format for reporting and analysis.
- **Reload Templates**: Refresh the template library to ensure the latest standards are applied.

---

## Result States

| State | Meaning |
|---|---|
| ✅ **Pass** | The tenant configuration meets the template criteria. |
| ❌ **Fail** | The tenant configuration does not meet the template criteria. |
| ⚠ **Unavailable** | Required data or permissions are missing. |

---

## Experimental Feature

The Reference Templates feature is currently under experimental status. While it provides valuable insights, it may occasionally produce false positive results. Use the findings as guidance and verify critical issues manually.

---

## Best Practices

- Regularly refresh templates to ensure assessments align with the latest standards.
- Use results to identify issues within a tenant.
- Export results for detailed analysis and reporting.

---

## Related Guides

- [14 — Security Templates](14-security-templates.md)
- [16 — Intune Endpoint Security](16-intune-endpoint-security.md)