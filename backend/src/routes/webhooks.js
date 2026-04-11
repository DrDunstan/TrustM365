'use strict';
const express  = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database/init');
const { fireWebhooksForDrift } = require('../engine/webhooks');
const logger = require('../utils/logger');
const router = express.Router();

// ── GET /api/webhooks — list all destinations ─────────────────────────────────
router.get('/', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT w.*, t.display_name as tenant_name
    FROM webhook_destinations w
    LEFT JOIN tenants t ON t.id = w.tenant_id
    ORDER BY w.created_at DESC
  `).all();
  res.json(rows);
});

// ── POST /api/webhooks — create destination ───────────────────────────────────
router.post('/', (req, res) => {
  const { label, url, tenantId, fireMode = 'first', enabled = true } = req.body;
  if (!url?.trim()) return res.status(400).json({ error: 'url is required' });
  try { new URL(url) } catch { return res.status(400).json({ error: 'url must be a valid URL' }) }
  const db = getDb();
  const id = uuidv4();
  db.prepare(`
    INSERT INTO webhook_destinations (id, tenant_id, label, url, fire_mode, enabled)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, tenantId || null, label?.trim() || '', url.trim(), fireMode, enabled ? 1 : 0);
  logger.info({ id, url: url.trim(), fireMode }, 'Webhook destination created');
  res.status(201).json({ id, message: 'Webhook created' });
});

// ── PATCH /api/webhooks/:id — update destination ──────────────────────────────
router.patch('/:id', (req, res) => {
  const db = getDb();
  const wh = db.prepare('SELECT * FROM webhook_destinations WHERE id = ?').get(req.params.id);
  if (!wh) return res.status(404).json({ error: 'Webhook not found' });
  const { label, url, tenantId, fireMode, enabled } = req.body;
  if (url) { try { new URL(url) } catch { return res.status(400).json({ error: 'Invalid URL' }) } }
  db.prepare(`
    UPDATE webhook_destinations SET
      label     = COALESCE(?, label),
      url       = COALESCE(?, url),
      tenant_id = CASE WHEN ? THEN ? ELSE tenant_id END,
      fire_mode = COALESCE(?, fire_mode),
      enabled   = COALESCE(?, enabled)
    WHERE id = ?
  `).run(
    label?.trim() ?? null,
    url?.trim()   ?? null,
    tenantId !== undefined ? 1 : 0, tenantId || null,
    fireMode ?? null,
    enabled  !== undefined ? (enabled ? 1 : 0) : null,
    req.params.id
  );
  res.json({ message: 'Webhook updated' });
});

// ── DELETE /api/webhooks/:id — remove destination ─────────────────────────────
router.delete('/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM webhook_destinations WHERE id = ?').run(req.params.id);
  db.prepare('DELETE FROM webhook_fired WHERE webhook_id = ?').run(req.params.id);
  res.json({ message: 'Webhook deleted' });
});

// ── POST /api/webhooks/:id/test — send a test payload ────────────────────────
router.post('/:id/test', async (req, res) => {
  const db = getDb();
  const wh = db.prepare('SELECT * FROM webhook_destinations WHERE id = ?').get(req.params.id);
  if (!wh) return res.status(404).json({ error: 'Webhook not found' });

  const testPayload = {
    event:     'drift.test',
    timestamp: new Date().toISOString(),
    tenant:    { id: 'test-tenant-id', displayName: 'Test Tenant', tenantUUID: '00000000-0000-0000-0000-000000000000' },
    area:      { key: 'entra_users', displayName: 'User Accounts' },
    drift:     { count: 1, properties: [{ resourceName: 'Test User', path: 'displayName', label: 'Display Name', baselineValue: 'Test User', liveValue: 'Modified User' }] },
    platform:  'TrustM365',
    version:   '1.0.0',
    note:      'This is a test delivery from TrustM365.',
  };

  const { deliverPayload } = (() => {
    // Inline delivery for test (same logic as engine/webhooks.js)
    const https = require('https'); const http = require('http');
    return { deliverPayload: (url, payload) => new Promise((resolve, reject) => {
      const body = JSON.stringify(payload); const parsed = new URL(url);
      const isHttps = parsed.protocol === 'https:';
      const req2 = (isHttps ? https : http).request({
        hostname: parsed.hostname, port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'User-Agent': 'TrustM365-Webhook/1.0' }
      }, r => { r.resume(); r.statusCode < 300 ? resolve({ status: r.statusCode }) : reject(new Error(`HTTP ${r.statusCode}`)); });
      req2.on('error', reject); req2.setTimeout(10000, () => { req2.destroy(); reject(new Error('Timed out')); });
      req2.write(body); req2.end();
    })};
  })();

  try {
    const result = await deliverPayload(wh.url, testPayload);
    db.prepare("UPDATE webhook_destinations SET last_fired_at = datetime('now'), last_error = NULL WHERE id = ?").run(wh.id);
    logger.info({ webhookId: wh.id }, 'Test webhook delivered');
    res.json({ message: 'Test delivery successful', status: result.status });
  } catch (err) {
    db.prepare('UPDATE webhook_destinations SET last_error = ? WHERE id = ?').run(err.message, wh.id);
    res.status(502).json({ error: `Delivery failed: ${err.message}` });
  }
});

module.exports = router;
