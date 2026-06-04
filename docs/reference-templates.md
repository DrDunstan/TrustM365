# Reference Templates - Global import and policy-scoped compare

This document explains how Reference Templates are imported, compared, and filtered by policy scope.

## Overview

- Imports are global only (`POST /api/reference-templates/import`).
- Imported templates are stored on disk under `backend/data/reference-templates` and registry-reloaded immediately.
- OpenIntune/OIB templates remain read-only/non-deletable.
- Imported non-OIB templates are deletable via `DELETE /api/reference-templates/:id`.
- Compare supports policy-type scoping so results can be constrained to only matching tenant policy resources.

## Import API

- Path: `POST /api/reference-templates/import`
- Body: JSON object or JSON array of templates.
- Query params:
  - `format` (optional): `openintune` | `generic` | `auto`.
  - `tenantId` is rejected (imports are not tenant-scoped).

Behavior:

- Existing templates with the same `id` are overwritten.
- Import runs OpenIntune or generic normalization as applicable.
- Import requires at least one of `resources`, `settings`, or `watched_keys`.

Example:

```bash
curl -sS -X POST "http://localhost:3001/api/reference-templates/import" \
  -H "Content-Type: application/json" \
  -d @my-template.json
```

CLI helper:

```bash
npm run reference:import -- ./my-template.json --family compliance-policy
```

Optional flags:

- `--policyType "Compliance Policy"` to override inferred mapping.
- `--api http://127.0.0.1:3001` to target a specific backend.
- `--no-overwrite` to disable overwrite behavior.

## Family ID and policy scope

In the UI (`/security/reference-templates`), import allows selecting a Family ID from a dropdown.

When selected, the import flow persists policy-scope metadata into the template:

- `metadata.family_id`
- `metadata.policy_type`
- `metadata.policy_type_normalized`
- top-level `policy_type`

This lets the compare workflow infer the intended policy class (for example Compliance Policy).

## Compare API

- Path: `POST /api/reference-templates/:id/compare`

Request body supports:

- `tenantId`: tenant to pull/compare against.
- `scan`: `true` for fresh pull, otherwise latest snapshot.
- `useV2`: enables policy-aware compare path.
- `policyType`: policy-type filter string.
- `strictPolicyType` (optional): when true, disables fallback to non-matching resources.

Policy-type behavior:

- With `policyType`, compare v2 filters tenant resources to matching policy types.
- Strict mode is used by default when `policyType` is provided in route handling.
- In strict mode, if zero candidates match, compare does not fallback to unrelated resources.

## Deleting imported templates

- Path: `DELETE /api/reference-templates/:id`
- Allowed only for imported non-OIB templates.
- OIB/OpenIntune templates return `403` (read-only protection).

## Frontend behavior

`frontend/src/pages/ReferenceTemplates.jsx`:

- Intune-focused reference templates UX.
- Always shows full list (no latest-only mode).
- Import supports Family ID dropdown + inference.
- Compare header shows current policy scope.
- Compare requests include strict policy-scope intent when policy type is selected.

## Tests

- New strict policy-scope comparator test: `backend/test/referenceTemplates.compare-v2.test.js`.
- Existing frontend tests for reference templates remain valid:
  - `frontend/src/__tests__/ReferenceTemplates.test.jsx`
  - `frontend/src/__tests__/ReferenceTemplates.multi.test.jsx`
