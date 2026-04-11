/**
 * Custom Collectors API
 *
 * Allows users to define read-only Graph API collectors via the dashboard UI.
 * Custom collectors support pull + drift detection only — restore is never available.
 *
 * Routes:
 *   GET    /api/custom-collectors              — list all defined custom collectors
 *   POST   /api/custom-collectors              — create a new custom collector
 *   PATCH  /api/custom-collectors/:id          — update an existing custom collector
 *   DELETE /api/custom-collectors/:id          — delete a custom collector (and its area rows)
 *   POST   /api/custom-collectors/test-pull    — test a Graph endpoint against a tenant (not saved)
 *   POST   /api/custom-collectors/:id/deploy/:tenantId  — add this collector to a specific tenant
 *   DELETE /api/custom-collectors/:id/deploy/:tenantId  — remove from a specific tenant
 */

const express  = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb }      = require('../database/init');
const { getAccessToken } = require('../services/auth');
const { decrypt }    = require('../utils/encryption');
const { graphGetAll, graphGet } = require('../services/graph');
const logger   = require('../utils/logger');
const router   = express.Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

// Sanitise a display name into a safe area_key slug
function toAreaKey(name) {
  return 'custom_' + name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
}

// Infer a field type from a sample value
function inferType(value) {
  if (value === null || value === undefined) return 'string';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'json';
  return 'string';
}

// Flatten an object into dot-notation paths (max 2 levels deep to avoid noise)
function flattenPaths(obj, prefix = '', depth = 0) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) || depth > 2) return [];
  return Object.entries(obj).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    const nested = (typeof v === 'object' && v !== null && !Array.isArray(v) && depth < 2)
      ? flattenPaths(v, path, depth + 1)
      : [];
    return [{ path, type: inferType(v), label: k }, ...nested];
  });
}

// ── List all custom collectors ────────────────────────────────────────────────
router.get('/', (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM custom_collectors ORDER BY display_name').all();
  res.json(rows.map(r => ({
    ...r,
    watchable_keys: JSON.parse(r.watchable_keys || '[]'),
  })));
});

// ── Create a custom collector ─────────────────────────────────────────────────
router.post('/', (req, res) => {
  const { display_name, description, graph_endpoint, select_fields, id_field, name_field, watchable_keys } = req.body;

  if (!display_name?.trim()) return res.status(400).json({ error: 'display_name is required' });
  if (!graph_endpoint?.trim()) return res.status(400).json({ error: 'graph_endpoint is required' });

  const db = getDb();
  const id       = uuidv4();
  const area_key = toAreaKey(display_name);

  // Prevent duplicate area keys
  if (db.prepare('SELECT id FROM custom_collectors WHERE area_key = ?').get(area_key)) {
    return res.status(409).json({ error: `A custom collector with the key "${area_key}" already exists. Use a different name.` });
  }

  db.prepare(`
    INSERT INTO custom_collectors
      (id, area_key, display_name, description, graph_endpoint, select_fields, id_field, name_field, watchable_keys)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(
    id, area_key,
    display_name.trim(),
    description?.trim() || '',
    graph_endpoint.trim(),
    select_fields?.trim() || '',
    id_field?.trim() || 'id',
    name_field?.trim() || 'displayName',
    JSON.stringify(watchable_keys || [])
  );

  logger.info({ area_key, display_name }, 'Custom collector created');
  res.status(201).json({ id, area_key, display_name });
});

// ── Update a custom collector ─────────────────────────────────────────────────
router.patch('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM custom_collectors WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Custom collector not found' });

  const {
    display_name   = existing.display_name,
    description    = existing.description,
    graph_endpoint = existing.graph_endpoint,
    select_fields  = existing.select_fields,
    id_field       = existing.id_field,
    name_field     = existing.name_field,
    watchable_keys,
  } = req.body;

  db.prepare(`
    UPDATE custom_collectors
    SET display_name=?, description=?, graph_endpoint=?, select_fields=?,
        id_field=?, name_field=?, watchable_keys=?, updated_at=datetime('now')
    WHERE id=?
  `).run(
    display_name, description, graph_endpoint, select_fields,
    id_field, name_field,
    JSON.stringify(watchable_keys ?? JSON.parse(existing.watchable_keys || '[]')),
    req.params.id
  );

  // Update display_name in all resource_areas rows for this collector
  db.prepare("UPDATE resource_areas SET display_name=?, description=? WHERE area_key=?")
    .run(display_name, description, existing.area_key);

  res.json({ message: 'Custom collector updated' });
});

// ── Delete a custom collector ─────────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM custom_collectors WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Custom collector not found' });

  // Cascade: remove area rows, live snapshots, drift results, baselines for this area_key
  const { area_key } = existing;
  db.prepare('DELETE FROM baselines      WHERE area_key = ?').run(area_key);
  db.prepare('DELETE FROM live_snapshots WHERE area_key = ?').run(area_key);
  db.prepare('DELETE FROM drift_results  WHERE area_key = ?').run(area_key);
  db.prepare('DELETE FROM resource_areas WHERE area_key = ?').run(area_key);
  db.prepare('DELETE FROM custom_collectors WHERE id = ?').run(req.params.id);

  logger.info({ area_key }, 'Custom collector deleted');
  res.json({ message: 'Custom collector deleted' });
});

// ── Test-pull — run against a live tenant to verify and discover fields ───────
router.post('/test-pull', async (req, res) => {
  const { tenantId, graph_endpoint, select_fields, id_field, name_field } = req.body;

  if (!tenantId)       return res.status(400).json({ error: 'tenantId is required' });
  if (!graph_endpoint) return res.status(400).json({ error: 'graph_endpoint is required' });

  const db = getDb();
  const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

  try {
    const secret = decrypt(tenant.client_secret_encrypted);
    const token  = await getAccessToken(tenant.tenant_id, tenant.client_id, secret);

    const endpoint = select_fields?.trim()
      ? `${graph_endpoint}?$select=${select_fields}`
      : graph_endpoint;

    // Try list first
    let raw = [];
    let isSingleton = false;

    try {
      raw = await graphGetAll(token, endpoint);
    } catch (listErr) {
      // May be a singleton resource (no .value array) — try a plain GET
      const single = await graphGet(token, endpoint).catch(() => null);
      if (single && !single.value) {
        raw = [single];
        isSingleton = true;
      } else {
        throw listErr;
      }
    }

    if (!raw || raw.length === 0) {
      return res.json({
        success: true,
        count: 0,
        sample: null,
        discoveredFields: [],
        message: 'Endpoint returned no results. Check the path and try again.',
      });
    }

    // Use first result to discover fields
    const sample = raw[0];
    const idf  = id_field   || 'id';
    const namef = name_field || 'displayName';

    const discoveredFields = flattenPaths(sample)
      .filter(f => !['@odata.type', '@odata.context', '@odata.etag'].includes(f.path))
      .map(f => ({
        path:    f.path,
        label:   f.path.split('.').pop(),
        type:    f.type,
        sample:  typeof sample[f.path.split('.')[0]] === 'object'
                   ? JSON.stringify(sample[f.path.split('.')[0]]).slice(0, 60)
                   : String(sample[f.path.split('.')[0]] ?? ''),
      }));

    res.json({
      success: true,
      count:   raw.length,
      isSingleton,
      sample,
      discoveredFields,
      detectedIdField:   idf   in sample ? idf   : Object.keys(sample).find(k => k === 'id') || null,
      detectedNameField: namef in sample ? namef : Object.keys(sample).find(k => k.toLowerCase().includes('name')) || null,
    });

  } catch (err) {
    logger.warn({ err, graph_endpoint }, 'Custom collector test-pull failed');
    res.status(400).json({
      success: false,
      error: err.message,
      hint: err.message.includes('403')
        ? 'Permission denied — this endpoint requires an API permission not yet granted to your App Registration.'
        : err.message.includes('404')
        ? 'Endpoint not found — check the Graph path is correct.'
        : null,
    });
  }
});

// ── Deploy to a specific tenant ───────────────────────────────────────────────
router.post('/:id/deploy/:tenantId', (req, res) => {
  const db = getDb();
  const collector = db.prepare('SELECT * FROM custom_collectors WHERE id = ?').get(req.params.id);
  if (!collector) return res.status(404).json({ error: 'Custom collector not found' });

  const tenant = db.prepare('SELECT id FROM tenants WHERE id = ?').get(req.params.tenantId);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

  db.prepare('INSERT OR IGNORE INTO resource_areas (id,tenant_id,area_key,display_name,description) VALUES (?,?,?,?,?)')
    .run(uuidv4(), req.params.tenantId, collector.area_key, collector.display_name, collector.description || '');

  res.json({ message: `"${collector.display_name}" added to tenant` });
});

// ── Remove from a specific tenant ────────────────────────────────────────────
router.delete('/:id/deploy/:tenantId', (req, res) => {
  const db = getDb();
  const collector = db.prepare('SELECT * FROM custom_collectors WHERE id = ?').get(req.params.id);
  if (!collector) return res.status(404).json({ error: 'Custom collector not found' });

  db.prepare('DELETE FROM resource_areas WHERE tenant_id = ? AND area_key = ?')
    .run(req.params.tenantId, collector.area_key);
  db.prepare('DELETE FROM baselines      WHERE tenant_id = ? AND area_key = ?')
    .run(req.params.tenantId, collector.area_key);
  db.prepare('DELETE FROM live_snapshots WHERE tenant_id = ? AND area_key = ?')
    .run(req.params.tenantId, collector.area_key);
  db.prepare('DELETE FROM drift_results  WHERE tenant_id = ? AND area_key = ?')
    .run(req.params.tenantId, collector.area_key);

  res.json({ message: `"${collector.display_name}" removed from tenant` });
});

module.exports = router;
