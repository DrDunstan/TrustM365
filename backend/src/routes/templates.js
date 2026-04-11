const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database/init');
const { getAllCollectors } = require('../collectors');
const logger = require('../utils/logger');
const router = express.Router();

// ── List all templates (optionally filtered by areaKey) ───────────────────────
router.get('/', (req, res) => {
  const db = getDb();
  const { areaKey } = req.query;
  const templates = areaKey
    ? db.prepare('SELECT * FROM baseline_templates WHERE area_key = ? ORDER BY name').all(areaKey)
    : db.prepare('SELECT * FROM baseline_templates ORDER BY area_key, name').all();

  res.json(templates.map(t => ({
    ...t,
    watched_keys: JSON.parse(t.watched_keys),
    // Omit full resources in list view for performance
    resourceCount: Object.keys(JSON.parse(t.resources)).length
  })));
});

// ── Get a single template with full resources ─────────────────────────────────
router.get('/:id', (req, res) => {
  const db = getDb();
  const t = db.prepare('SELECT * FROM baseline_templates WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Template not found' });
  res.json({ ...t, resources: JSON.parse(t.resources), watched_keys: JSON.parse(t.watched_keys) });
});

// ── Save a baseline as a template ─────────────────────────────────────────────
// Can be called with an existing baseline (tenantId + areaKey) or raw resources
router.post('/', (req, res) => {
  const db = getDb();
  const { name, description = '', areaKey, tenantId, resources, watchedKeys } = req.body;

  if (!name || !areaKey) return res.status(400).json({ error: 'name and areaKey required' });

  let templateResources = resources;
  let templateWatchedKeys = watchedKeys || [];

  // If tenantId provided, pull from existing baseline
  if (tenantId && !resources) {
    const baseline = db.prepare('SELECT * FROM baselines WHERE tenant_id = ? AND area_key = ?').get(tenantId, areaKey);
    if (!baseline) return res.status(404).json({ error: 'No baseline found for this tenant and area' });
    templateResources = JSON.parse(baseline.resources);
    templateWatchedKeys = JSON.parse(baseline.watched_keys || '[]');
  }

  if (!templateResources || typeof templateResources !== 'object') {
    return res.status(400).json({ error: 'resources object required (or provide tenantId to copy from existing baseline)' });
  }

  const id = uuidv4();
  db.prepare(`INSERT INTO baseline_templates
    (id, name, description, area_key, resources, watched_keys, created_from_tenant)
    VALUES (?,?,?,?,?,?,?)`)
    .run(id, name, description, areaKey, JSON.stringify(templateResources), JSON.stringify(templateWatchedKeys), tenantId || null);

  logger.info({ id, name, areaKey }, 'Baseline template created');
  res.status(201).json({ id, name, areaKey, message: 'Template saved' });
});

// ── Update a template ─────────────────────────────────────────────────────────
router.patch('/:id', (req, res) => {
  const db = getDb();
  const { name, description, resources, watchedKeys } = req.body;
  const existing = db.prepare('SELECT id FROM baseline_templates WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Template not found' });

  db.prepare(`UPDATE baseline_templates SET
    name        = COALESCE(?, name),
    description = COALESCE(?, description),
    resources   = COALESCE(?, resources),
    watched_keys = COALESCE(?, watched_keys),
    updated_at  = datetime('now')
    WHERE id = ?`)
    .run(name || null, description || null,
      resources ? JSON.stringify(resources) : null,
      watchedKeys ? JSON.stringify(watchedKeys) : null,
      req.params.id);

  res.json({ message: 'Template updated' });
});

// ── Delete a template ─────────────────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM baseline_templates WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Template not found' });
  db.prepare('DELETE FROM baseline_templates WHERE id = ?').run(req.params.id);
  res.json({ message: 'Template deleted' });
});

// ── Apply a template to one or more tenants ───────────────────────────────────
router.post('/:id/apply', (req, res) => {
  const db = getDb();
  const { tenantIds } = req.body; // array of tenant DB IDs
  if (!Array.isArray(tenantIds) || tenantIds.length === 0) {
    return res.status(400).json({ error: 'tenantIds array required' });
  }

  const template = db.prepare('SELECT * FROM baseline_templates WHERE id = ?').get(req.params.id);
  if (!template) return res.status(404).json({ error: 'Template not found' });

  const results = [];
  for (const tenantId of tenantIds) {
    const tenant = db.prepare('SELECT id, display_name FROM tenants WHERE id = ?').get(tenantId);
    if (!tenant) { results.push({ tenantId, success: false, error: 'Tenant not found' }); continue; }

    try {
      const existing = db.prepare('SELECT id FROM baselines WHERE tenant_id = ? AND area_key = ?')
        .get(tenantId, template.area_key);

      if (existing) {
        // Archive old before overwriting
        const old = db.prepare('SELECT * FROM baselines WHERE tenant_id = ? AND area_key = ?')
          .get(tenantId, template.area_key);
        db.prepare('INSERT INTO baseline_history (id,tenant_id,area_key,resources,label) VALUES (?,?,?,?,?)')
          .run(uuidv4(), tenantId, template.area_key, old.resources, old.label + ' (pre-template)');
        db.prepare(`UPDATE baselines SET resources=?,watched_keys=?,label=?,updated_at=datetime('now')
          WHERE tenant_id=? AND area_key=?`)
          .run(template.resources, template.watched_keys, `Template: ${template.name}`, tenantId, template.area_key);
      } else {
        db.prepare('INSERT INTO baselines (id,tenant_id,area_key,label,resources,watched_keys) VALUES (?,?,?,?,?,?)')
          .run(uuidv4(), tenantId, template.area_key, `Template: ${template.name}`, template.resources, template.watched_keys);
      }

      db.prepare(`UPDATE resource_areas SET has_baseline=1, baseline_set_at=datetime('now')
        WHERE tenant_id=? AND area_key=?`).run(tenantId, template.area_key);

      results.push({ tenantId, tenantName: tenant.display_name, success: true });
    } catch (err) {
      results.push({ tenantId, tenantName: tenant.display_name, success: false, error: err.message });
    }
  }

  const applied = results.filter(r => r.success).length;
  logger.info({ templateId: req.params.id, applied, total: tenantIds.length }, 'Template applied');
  res.json({ applied, total: tenantIds.length, results });
});

module.exports = router;
