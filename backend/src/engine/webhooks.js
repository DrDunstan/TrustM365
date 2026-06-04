'use strict';
/**
 * Webhook delivery engine.
 *
 * Called from sync.js after drift is computed. Delivers a JSON payload to
 * each enabled webhook destination. Supports two fire modes:
 *   - 'first'  → fires once per area when drift is FIRST detected, then not
 *                again until that area resolves back to clean.
 *   - 'every'  → fires on every sync that confirms drift for the area.
 *
 * Payload schema (JSON):
 * {
 *   event:       "drift.detected",
 *   timestamp:   "2026-03-20T07:00:00.000Z",
 *   tenant: { id, displayName, tenantUUID },
 *   area:   { key, displayName },
 *   drift:  { count, properties: [{ resourceName, path, baselineValue, liveValue }] },
 *   platform: "TrustM365",
 *   version:  "1.0.0"
 * }
 */

const https  = require('https');
const http   = require('http');
const { getDb } = require('../database/init');
const logger = require('../utils/logger');
const { emitSiemEvent } = require('../services/logAnalytics');

// ── Build the drift payload ──────────────────────────────────────────────────
function buildPayload(tenant, area, driftResult) {
  const summary = JSON.parse(driftResult.summary || '[]');
  const properties = summary
    .filter(s => s.status === 'drifted' || s.status === 'missing')
    .flatMap(s => (s.drifts || []).map(d => ({
      resourceId:    s.resourceId,
      resourceName:  s.resourceName || s.resourceId,
      path:          d.path,
      label:         d.label || d.path,
      baselineValue: d.baselineValue,
      liveValue:     d.liveValue,
    })));

  return {
    event:     'drift.detected',
    timestamp: new Date().toISOString(),
    tenant: {
      id:          tenant.id,
      displayName: tenant.display_name,
      tenantUUID:  tenant.tenant_id,
    },
    area: {
      key:         area.area_key,
      displayName: area.display_name,
    },
    drift: {
      count:      driftResult.drift_count || 0,
      properties: properties.slice(0, 20), // cap to keep payload manageable
    },
    platform: 'TrustM365',
    version:  '1.0.0',
  };
}

// ── HTTP POST delivery ────────────────────────────────────────────────────────
function deliverPayload(url, payload) {
  return new Promise((resolve, reject) => {
    const body    = JSON.stringify(payload);
    const parsed  = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const options = {
      hostname: parsed.hostname,
      port:     parsed.port || (isHttps ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent':     'TrustM365-Webhook/1.0',
      },
    };
    const req = (isHttps ? https : http).request(options, res => {
      res.resume(); // drain response
      if (res.statusCode >= 200 && res.statusCode < 300) {
        resolve({ ok: true, status: res.statusCode });
      } else {
        reject(new Error(`HTTP ${res.statusCode}`));
      }
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Webhook delivery timed out')); });
    req.write(body);
    req.end();
  });
}

// ── Main: fire webhooks for a completed drift result ─────────────────────────
async function fireWebhooksForDrift(tenantDbId, areaKey, driftResult) {
  if (!driftResult || driftResult.status !== 'drifted' || (driftResult.drift_count || 0) === 0) return;

  const db = getDb();
  const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantDbId);
  const area   = db.prepare('SELECT * FROM resource_areas WHERE tenant_id = ? AND area_key = ?').get(tenantDbId, areaKey);
  if (!tenant || !area) return;

  // Fetch webhooks that apply to this tenant (tenant-specific + MSSP-wide)
  const webhooks = db.prepare(`
    SELECT * FROM webhook_destinations
    WHERE enabled = 1
      AND (tenant_id = ? OR tenant_id IS NULL)
  `).all(tenantDbId);

  if (webhooks.length === 0) return;

  const payload = buildPayload(tenant, area, driftResult);

  for (const wh of webhooks) {
    try {
      // 'first' mode: check if already fired for this tenant+area combination
      if (wh.fire_mode === 'first') {
        const alreadyFired = db.prepare(
          'SELECT 1 FROM webhook_fired WHERE webhook_id = ? AND tenant_id = ? AND area_key = ?'
        ).get(wh.id, tenantDbId, areaKey);
        if (alreadyFired) {
          emitSiemEvent('webhooks', 'webhook.delivery.skipped_first_mode', {
            webhookId: wh.id,
            tenantDbId,
            areaKey,
          });
          continue; // Skip — already notified, wait for resolution
        }
      }

      await deliverPayload(wh.url, payload);

      // Record successful delivery
      db.prepare("UPDATE webhook_destinations SET last_fired_at = datetime('now'), last_error = NULL WHERE id = ?")
        .run(wh.id);

      // Mark as fired for 'first' mode
      if (wh.fire_mode === 'first') {
        db.prepare(
          "INSERT OR REPLACE INTO webhook_fired (webhook_id, tenant_id, area_key, fired_at) VALUES (?, ?, ?, datetime('now'))"
        ).run(wh.id, tenantDbId, areaKey);
      }

      logger.info({ webhookId: wh.id, tenantId: tenant.tenant_id, areaKey }, 'Webhook delivered');
      emitSiemEvent('webhooks', 'webhook.delivery.succeeded', {
        webhookId: wh.id,
        tenantDbId,
        tenantId: tenant.tenant_id,
        areaKey,
      });
    } catch (err) {
      db.prepare("UPDATE webhook_destinations SET last_error = ? WHERE id = ?")
        .run(err.message, wh.id);
      logger.warn({ err, webhookId: wh.id, tenantId: tenant.tenant_id }, 'Webhook delivery failed');
      emitSiemEvent('webhooks', 'webhook.delivery.failed', {
        webhookId: wh.id,
        tenantDbId,
        tenantId: tenant.tenant_id,
        areaKey,
        error: err.message,
      });
    }
  }
}

// ── Called when an area resolves to clean — clear 'first' mode fired state ──
function clearWebhookFiredForArea(tenantDbId, areaKey) {
  try {
    const db = getDb();
    db.prepare('DELETE FROM webhook_fired WHERE tenant_id = ? AND area_key = ?')
      .run(tenantDbId, areaKey);
  } catch {}
}

module.exports = { fireWebhooksForDrift, clearWebhookFiredForArea };
