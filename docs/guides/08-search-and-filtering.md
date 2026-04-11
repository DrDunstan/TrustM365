# Guide 08 — Search and filtering

TrustM365 has contextual filter controls on each main page. All filters are local to their page and designed to help you navigate large amounts of data quickly.

---

## Portfolio — tenant search and filters

The Portfolio page has a search input and filter pills above the tenant list.

| Control | Function |
|---|---|
| Search input | Filter by tenant **display name**, **tenant ID**, or **tags** |
| Status pills | Filter to Drift Detected, Healthy, or Not Yet Monitored |
| Sort | Most drifted first (default), A→Z, Z→A, Recently synced |
| **Clear** | Removes all active filters |

- Results update as you type — no Enter required
- All filter and sort preferences are saved in your browser and restored on your next visit
- An empty-state message appears when the active filters return zero results

---

## Area View — resource filter

When an area has more than 4 resources, a filter bar appears above the resource list.

| Control | Function |
|---|---|
| Search input | Filter by resource display name or ID |
| **All** | Show all monitored resources |
| **Drifted** | Show only resources that are currently drifted or missing |
| **Clean** | Show only resources that match the baseline |
| Result count | Shows "X of Y" when a filter is active |
| **Clear** | Removes both search and status filter |

The filter is local to the current session — it resets when you navigate away.

---

## Baseline Editor — resource search

When an area has more than 4 resources, a search input appears above both the "In Baseline" and "Not in Baseline" sections.

- Searches by display name or resource ID
- Filters both sections simultaneously with the same query
- "In Baseline" shows `X of Y resources` when filtered
- "Not in Baseline" shows a "no results" message when the search matches nothing in that section

This is most useful for areas with many resources, such as User Accounts in a large tenant or Compliance Policies across a fleet with many per-platform policies.

---

## Reports — filters

The Reports page has filter controls below the report list header.

| Filter | Function |
|---|---|
| Search input | Filter by report title |
| Tenant dropdown | Filter to reports for a specific tenant |
| Date range | Filter by the report's covered period (from → to) |

All filters combine with AND logic. A result count ("X of Y reports") appears when any filter is active. **Clear filters** removes all active filters at once.

> The date filter matches against the report's *covered period*, not its generation date. A report generated today covering January–February will not appear when filtering for March.
