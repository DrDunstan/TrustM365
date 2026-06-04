const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database/init');
const { getAllCollectors } = require('../collectors');
const comparator = require('../referenceTemplates/comparator');
const registry = require('../referenceTemplates/registry');
const logger = require('../utils/logger');
const router = express.Router();

function summarizeSettingCoverage(items) {
  const safeItems = Array.isArray(items) ? items : [];
  const totalSettings = safeItems.reduce((sum, it) => sum + Number(it?.settingSummary?.totalSettings || 0), 0);
  const matchedSettings = safeItems.reduce((sum, it) => sum + Number(it?.settingSummary?.matchedSettings || 0), 0);
  const partialSettings = safeItems.reduce((sum, it) => sum + Number(it?.settingSummary?.partialSettings || 0), 0);
  const noMatchSettings = safeItems.reduce((sum, it) => sum + Number(it?.settingSummary?.noMatchSettings || 0), 0);
  return { totalSettings, matchedSettings, partialSettings, noMatchSettings };
}

// ── List all security templates (optionally filtered by areaKey) ──────────────
router.get('/', (req, res) => {
  const db = getDb();
  const { areaKey } = req.query;
  const includeFull = req.query && String(req.query.full) === 'true';
  let templates = areaKey
    ? db.prepare('SELECT * FROM baseline_templates WHERE area_key = ? ORDER BY name').all(areaKey)
    : db.prepare('SELECT * FROM baseline_templates ORDER BY area_key, name').all();

  // Hide OpenIntuneBaseline saved templates from the Security Templates list by default
  templates = templates.filter(t => {
    const name = (t.name || '').toLowerCase();
    const desc = (t.description || '').toLowerCase();
    const resources = (t.resources || '').toLowerCase();
    if (name.includes('openintune') || name.includes('open-intune')) return false;
    if (desc.includes('openintune') || desc.includes('open-intune')) return false;
    if (resources.includes('openintune') || resources.includes('open-intune')) return false;
    return true;
  });

  if (includeFull) {
    // If no security templates are stored in DB, fall back to the registry
    if (!templates || templates.length === 0) {
      try {
        let regList = registry.listTemplates();
        // Convert lightweight entries into full templates
        regList = (regList || []).map(l => registry.getTemplate(l.id)).filter(Boolean);
        // Only include Zero Trust templates in categories Identity / Devices
        regList = regList.filter(t => {
          const meta = t.metadata || {};
          const tplOwner = String(meta.owner || '').toLowerCase();
          const category = String((meta.category || '')).toLowerCase();
          return tplOwner === 'zerotrust' && (category === 'identity' || category === 'devices');
        });
        return res.json(regList.map(t => ({ ...t })));
      } catch (e) {
        // fallback to empty list if registry access fails
        return res.json([]);
      }
    }
    return res.json(templates.map(t => ({ ...t, resources: JSON.parse(t.resources || '{}'), watched_keys: JSON.parse(t.watched_keys || '[]') })));
  }
  return res.json(templates.map(t => ({
    ...t,
    watched_keys: JSON.parse(t.watched_keys || '[]'),
    // Omit full resources in list view for performance
    resourceCount: Object.keys(JSON.parse(t.resources || '{}')).length
  })));
});

// ── Get a single security template with full resources ───────────────────────
router.get('/:id', (req, res) => {
  const db = getDb();
  const t = db.prepare('SELECT * FROM baseline_templates WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Template not found' });
  res.json({ ...t, resources: JSON.parse(t.resources), watched_keys: JSON.parse(t.watched_keys) });
});

// ── Compare a security template to a tenant's latest saved live snapshot (snapshot-only)
router.post('/:id/compare', async (req, res) => {
  try {
    const { tenantId } = req.body || {};
    if (!tenantId) return res.status(400).json({ error: 'tenantId required' });

    const db = getDb();
    const tplRow = db.prepare('SELECT * FROM baseline_templates WHERE id = ?').get(req.params.id);
    if (!tplRow) return res.status(404).json({ error: 'Template not found' });

    const areaKey = tplRow.area_key || tplRow.areaKey || 'unknown';
    const snap = db.prepare('SELECT resources FROM live_snapshots WHERE tenant_id = ? AND area_key = ? ORDER BY pulled_at DESC LIMIT 1').get(tenantId, areaKey);
    if (!snap || !snap.resources) return res.status(404).json({ error: 'No live snapshot found for tenant/area. Pull a snapshot before comparing.' });

    const currentResources = JSON.parse(snap.resources || '{}');
    const tpl = { ...tplRow, resources: JSON.parse(tplRow.resources || '{}'), watched_keys: JSON.parse(tplRow.watched_keys || '[]') };

    const items = await comparator.compareTemplateResources(tpl, currentResources) || [];

    // For frontend convenience, expose partial-match samples under `matchedSamples`
    for (const it of items) {
      if (it && it.status === 'partial' && Array.isArray(it.matchAny)) {
        const seen = new Set();
        const preferred = [];
        const fallback = [];
        for (const m of it.matchAny) {
          const key = (m && (m.displayName || m.id)) || JSON.stringify(m || '');
          if (seen.has(key)) continue;
          seen.add(key);
          if (Array.isArray(m.matchedPaths) && m.matchedPaths.length > 0) preferred.push(m);
          else fallback.push(m);
          if (preferred.length >= 3) break;
        }
        const chosen = preferred.length > 0 ? preferred.slice(0, 3) : fallback.slice(0, 3);
        if (!it.matchedSamples) it.matchedSamples = chosen;
        if (!it.presentInPolicies) it.presentInPolicies = it.matchAny.map(m => m.displayName || m.id);
        it.matchAnyCount = it.matchAny.length;
      }
    }

    const total = items.length;
    const matched = items.filter(i => i.status === 'matched').length;
    const partial = items.filter(i => i.status === 'partial').length;
    const noMatch = Math.max(0, total - matched - partial);
    const summary = { total, matched, partial, noMatch };
    const settingSummary = summarizeSettingCoverage(items);
    return res.json({ templateId: tpl.id, items, summary, settingSummary });
  } catch (err) {
    logger.error({ err }, 'Security template compare failed');
    return res.status(500).json({ error: 'Compare failed', message: err && err.message });
  }
});

// Aggregated summary for security templates for a single tenant (snapshot-only)
router.get('/summary', async (req, res) => {
  try {
    const tenantId = req.query && req.query.tenantId ? req.query.tenantId : undefined;
    const db = getDb();
    const list = db.prepare('SELECT * FROM baseline_templates ORDER BY area_key, name').all() || [];

    const totals = { total: 0, passing: 0, partial: 0, failing: 0 };
    const outTemplates = [];

    for (const tplRow of list) {
      try {
        let liveResources = {};
        if (tenantId) {
          const snap = db.prepare('SELECT resources FROM live_snapshots WHERE tenant_id = ? AND area_key = ? ORDER BY pulled_at DESC LIMIT 1').get(tenantId, tplRow.area_key);
          if (snap && snap.resources) liveResources = JSON.parse(snap.resources || '{}');
        }

        const tpl = { ...tplRow, resources: JSON.parse(tplRow.resources || '{}'), watched_keys: JSON.parse(tplRow.watched_keys || '[]') };
        const items = await comparator.compareTemplateResources(tpl, liveResources) || [];

        // expose partial-match samples for UI convenience
        for (const it of items) {
          if (it && it.status === 'partial' && Array.isArray(it.matchAny)) {
            const seen = new Set();
            const preferred = [];
            const fallback = [];
            for (const m of it.matchAny) {
              const key = (m && (m.displayName || m.id)) || JSON.stringify(m || '');
              if (seen.has(key)) continue;
              seen.add(key);
              if (Array.isArray(m.matchedPaths) && m.matchedPaths.length > 0) preferred.push(m);
              else fallback.push(m);
              if (preferred.length >= 3) break;
            }
            const chosen = preferred.length > 0 ? preferred.slice(0, 3) : fallback.slice(0, 3);
            if (!it.matchedSamples) it.matchedSamples = chosen;
            if (!it.presentInPolicies && Array.isArray(it.matchAny)) it.presentInPolicies = it.matchAny.map(m => m.displayName || m.id);
            it.matchAnyCount = Array.isArray(it.matchAny) ? it.matchAny.length : 0;
          }
        }

        const tTotal = items.length;
        const tPassing = items.filter(i => i.status === 'matched').length;
        const tPartial = items.filter(i => i.status === 'partial').length;
        const tFailing = Math.max(0, tTotal - tPassing - tPartial);
        totals.total += tTotal;
        totals.passing += tPassing;
        totals.partial += tPartial;
        totals.failing += tFailing;

        const settingSummary = summarizeSettingCoverage(items);

        outTemplates.push({ templateId: tpl.id, name: tpl.name || tpl.display_name || tpl.id, area_key: tpl.area_key, note: tpl.note || '', summary: { total: tTotal, passing: tPassing, partial: tPartial, failing: tFailing }, settingSummary, items });
      } catch (err) {
        outTemplates.push({ templateId: tplRow.id, name: tplRow.name || tplRow.id, area_key: tplRow.area_key, note: err && err.message ? err.message : 'Comparator error', summary: { total: 0, passing: 0, partial: 0, failing: 0 }, settingSummary: { totalSettings: 0, matchedSettings: 0, partialSettings: 0, noMatchSettings: 0 }, items: [] });
      }
    }

    return res.json({ summary: totals, templates: outTemplates });
  } catch (err) {
    logger.error({ err }, 'Failed to compute security templates summary');
    return res.status(500).json({ error: 'Failed to compute summary', message: err && err.message });
  }
});

// ── Save a baseline as a security template ─────────────────────────────────
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

  logger.info({ id, name, areaKey }, 'Security template created');
  res.status(201).json({ id, name, areaKey, message: 'Template saved' });
});

// ── Update a template ─────────────────────────────────────────────────────
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

// ── Delete a template ─────────────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM baseline_templates WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Template not found' });
  db.prepare('DELETE FROM baseline_templates WHERE id = ?').run(req.params.id);
  res.json({ message: 'Template deleted' });
});

// ── Apply a template to one or more tenants ─────────────────────────────────
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
