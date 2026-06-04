# TrustM365 Log Analytics and Microsoft Sentinel Integration

This integration allows TrustM365 telemetry to be ingested into Azure Log Analytics and operationalized in Microsoft Sentinel.

## Objectives

- Ingest TrustM365 security telemetry into custom Log Analytics tables.
- Retain and query drift/remediation/job activity with KQL.
- Trigger Sentinel incidents through scheduled analytic rules.
- Visualize monthly telemetry trends with a workbook.

## Architecture

1. TrustM365 emits SIEM events from backend runtime categories.
2. Events are signed with the Log Analytics shared key and posted to Azure Monitor Data Collector API.
3. Custom tables are created automatically by Log Analytics based on Log-Type.
4. Sentinel analytic rules query those tables and create incidents.
5. Workbook queries the same tables for reporting and trend analysis.

## Event Categories

- Drift lifecycle
- Remediation and restore outcomes
- Job and scheduler health
- Webhook delivery outcomes
- API request logs

Each category can be enabled or disabled independently in MSSP Settings for cost control.

## Configuration in TrustM365

Navigate to MSSP Settings and configure:

- Enable Log Analytics export
- Workspace ID
- Shared key
- Table prefix
- Schema version
- Per-category ingestion toggles

Use Test Connection before saving.

## Table Naming

TrustM365 uses the configured table prefix and category suffix:

- <Prefix>Drift_CL
- <Prefix>Restore_CL
- <Prefix>Jobs_CL
- <Prefix>Webhooks_CL
- <Prefix>Api_CL

Default prefix is TrustM365.

## Security Notes

- Shared key is encrypted at rest in TrustM365 settings storage.
- Shared key is never returned in plaintext from MSSP settings APIs.
- Connection tests can use a temporary key input without persisting it.

## Sentinel Content Pack

Included assets:

- KQL library: data/sentinel/kql/trustm365-queries.kql
- Analytic rules: data/sentinel/analytics-rules/
- Workbook: data/sentinel/workbooks/TrustM365-Drift-Monthly.workbook.json
- Deployment helper: scripts/sentinel/deploy/deploy_content_pack.ps1
- Validation helper: scripts/sentinel/validate/validate_sentinel_assets.js

## Deployment Steps

1. Validate assets.
2. Deploy analytic rules.
3. Import workbook JSON.
4. Run drift checks in TrustM365.
5. Confirm records in Log Analytics and incidents in Sentinel.

## Cost Management Guidance

- Keep API request logs disabled unless needed for diagnostics.
- Start with drift and restore categories enabled as minimum SOC signal.
- Review ingestion volume weekly and tune categories accordingly.
- Use table-level retention policies in Log Analytics for optimization.

## Troubleshooting

- 403/401 from ingestion endpoint: verify workspace ID and shared key.
- No incidents: confirm table prefix matches rule query templates.
- Empty workbook: check that telemetry categories are enabled and events have been emitted.
- Excessive cost: disable API logs and shorten retention on high-volume tables.
