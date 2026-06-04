# 22 - Sentinel Content Pack Operations

This guide covers operating the TrustM365 Sentinel content pack over time.

## Validate assets before deployment

Run:

node scripts/sentinel/validate/validate_sentinel_assets.js

Validation checks required files and JSON parsing.

For deeper static checks (event-type parity, duration formats, workbook prefix warnings, and Azure CLI deploy prerequisites), run:

npm run sentinel:preflight

## Deploy or redeploy rules

Run:

scripts/sentinel/deploy/deploy_content_pack.ps1 -SubscriptionId [subId] -ResourceGroup [rg] -WorkspaceName [workspace] -TablePrefix TrustM365

Safe to run repeatedly when templates are updated.

## Update KQL for custom table prefix

If MSSP Settings table prefix changes, update the KQL in:

- data/sentinel/kql/trustm365-queries.kql
- data/sentinel/analytics-rules/*.json (placeholder {TablePrefix} is replaced by deploy script)
- workbook JSON queries if they are hard-coded

## Recommended SOC operating model

- Daily: review repeated drift and restore-failure incidents.
- Weekly: review workbook trend lines and top drifted tenants/areas.
- Monthly: tune ingestion categories and retention policy based on volume.

## Versioning and change control

- Keep content pack artifacts in source control.
- Update CHANGELOG when rules/workbook/query logic changes.
- Re-run validation and redeploy after every change.

## Incident enrichment recommendations

Include custom details in rules:

- tenantId
- areaKey
- driftCount or failedRestoreCount
- eventType

This improves downstream ITSM ticket routing and automation.
