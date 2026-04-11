const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database/init');
const { getCollector, getAllCollectors } = require('../collectors');
const { createSyncJob, runSync, getJob } = require('../engine/sync');
const { restoreResource } = require('../engine/restore');
const { computeDrift, stableHash } = require('../engine/drift');
const logger = require('../utils/logger');
const router = express.Router();

// GET /api/areas/:tenantId — list all resource areas with latest drift status
router.get('/:tenantId', (req, res) => {
  const db = getDb();
  const areas = db.prepare('SELECT * FROM resource_areas WHERE tenant_id = ? ORDER BY display_name').all(req.params.tenantId);

  const enriched = areas.map(area => {
    const latestDrift = db.prepare('SELECT * FROM drift_results WHERE tenant_id = ? AND area_key = ? ORDER BY checked_at DESC LIMIT 1')
      .get(req.params.tenantId, area.area_key);
    let watchableKeys = [];
    let isCustom = false;
    let monitorOnlyKeys = [];
    try {
      const collector = getCollector(area.area_key);
      watchableKeys    = collector.watchableKeys    || [];
      isCustom         = !!collector.isCustom;
      monitorOnlyKeys  = collector.monitorOnlyKeys  || [];
    } catch { /* unknown area — skip */ }
    return {
      ...area,
      latestDrift: latestDrift ? {
        status:     latestDrift.status,
        driftCount: latestDrift.drift_count,
        checkedAt:  latestDrift.checked_at,
        summary:    JSON.parse(latestDrift.summary || '[]')
      } : null,
      watchableKeys,
      isCustom,
      monitorOnlyKeys,
    };
  });

  res.json(enriched);
});

// POST /api/areas/:tenantId/:areaKey/pull — pull live config from Graph API
router.post('/:tenantId/:areaKey/pull', async (req, res) => {
  const { tenantId, areaKey } = req.params;
  const db = getDb();

  const tenant = db.prepare('SELECT permissions_json FROM tenants WHERE id = ?').get(tenantId);
  if (tenant?.permissions_json) {
    const { areas } = JSON.parse(tenant.permissions_json);
    const area = areas?.find(a => a.areaKey === areaKey);
    if (area && !area.canRead) {
      return res.status(403).json({
        error: 'permission_missing',
        message: `Sync is locked. Add these permissions to your App Registration: ${area.missingRead.join(', ')}`,
        missingPermissions: area.missingRead
      });
    }
  }

  const jobId = createSyncJob(tenantId, areaKey);
  runSync(jobId).catch(err => logger.error({ err, jobId }, 'Sync job error'));
  res.status(202).json({ jobId, message: 'Pull started. Poll /api/jobs/' + jobId });
});

// GET /api/areas/:tenantId/:areaKey/live — get latest live snapshot
router.get('/:tenantId/:areaKey/live', (req, res) => {
  const db = getDb();
  const snap = db.prepare('SELECT * FROM live_snapshots WHERE tenant_id = ? AND area_key = ? ORDER BY pulled_at DESC LIMIT 1')
    .get(req.params.tenantId, req.params.areaKey);
  if (!snap) return res.status(404).json({ error: 'No live snapshot yet. Pull first.' });
  res.json({ ...snap, resources: JSON.parse(snap.resources) });
});

// GET /api/areas/:tenantId/:areaKey/baseline — get current baseline
router.get('/:tenantId/:areaKey/baseline', (req, res) => {
  const db = getDb();
  const baseline = db.prepare('SELECT * FROM baselines WHERE tenant_id = ? AND area_key = ?')
    .get(req.params.tenantId, req.params.areaKey);
  if (!baseline) return res.status(404).json({ error: 'No baseline set for this area' });
  res.json({
    ...baseline,
    resources:          JSON.parse(baseline.resources),
    watched_keys:       JSON.parse(baseline.watched_keys      || '[]'),
    resource_modes:     JSON.parse(baseline.resource_modes    || '{}'),
    resource_hashes:    JSON.parse(baseline.resource_hashes   || '{}'),
    resource_groups:    JSON.parse(baseline.resource_groups   || '[]'),
    excluded_resources: JSON.parse(baseline.excluded_resources || '[]'),
  });
});

// POST /api/areas/:tenantId/:areaKey/baseline — save or update baseline
router.post('/:tenantId/:areaKey/baseline', (req, res) => {
  const { tenantId, areaKey } = req.params;
  const { resources, watchedKeys = [], label, resourceModes = {}, resourceGroups = [], excludedResources = [] } = req.body;
  if (!resources || typeof resources !== 'object') return res.status(400).json({ error: 'resources object required' });

  // Compute stable hashes for every snapshot-mode resource at save time
  const resourceHashes = {};
  for (const [id, resource] of Object.entries(resources)) {
    if (resourceModes[id] === 'snapshot') {
      resourceHashes[id] = stableHash(resource);
    }
  }

  const db = getDb();
  const existing = db.prepare('SELECT id FROM baselines WHERE tenant_id = ? AND area_key = ?').get(tenantId, areaKey);

  if (existing) {
    const prev = db.prepare('SELECT * FROM baselines WHERE tenant_id = ? AND area_key = ?').get(tenantId, areaKey);
    db.prepare('INSERT INTO baseline_history (id,tenant_id,area_key,resources,label,resource_modes,watched_keys) VALUES (?,?,?,?,?,?,?)')
      .run(uuidv4(), tenantId, areaKey, prev.resources, prev.label,
           prev.resource_modes || '{}', prev.watched_keys || '[]');
    db.prepare(`UPDATE baselines
       SET resources=?,watched_keys=?,label=?,resource_modes=?,resource_hashes=?,resource_groups=?,excluded_resources=?,updated_at=datetime('now')
       WHERE tenant_id=? AND area_key=?`)
      .run(JSON.stringify(resources), JSON.stringify(watchedKeys), label || 'Baseline',
           JSON.stringify(resourceModes), JSON.stringify(resourceHashes),
           JSON.stringify(resourceGroups), JSON.stringify(excludedResources),
           tenantId, areaKey);
  } else {
    db.prepare(`INSERT INTO baselines
        (id,tenant_id,area_key,label,resources,watched_keys,resource_modes,resource_hashes,resource_groups,excluded_resources)
        VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(uuidv4(), tenantId, areaKey, label || 'Baseline',
           JSON.stringify(resources), JSON.stringify(watchedKeys),
           JSON.stringify(resourceModes), JSON.stringify(resourceHashes),
           JSON.stringify(resourceGroups), JSON.stringify(excludedResources));
  }

  db.prepare("UPDATE resource_areas SET has_baseline=1, baseline_set_at=datetime('now') WHERE tenant_id=? AND area_key=?")
    .run(tenantId, areaKey);

  logger.info({ tenantId, areaKey }, 'Baseline saved');
  res.json({ message: 'Baseline saved successfully' });
});

// DELETE /api/areas/:tenantId/:areaKey/baseline — delete active baseline (archive first)
router.delete('/:tenantId/:areaKey/baseline', (req, res) => {
  const { tenantId, areaKey } = req.params;
  const db = getDb();
  const existing = db.prepare('SELECT * FROM baselines WHERE tenant_id = ? AND area_key = ?').get(tenantId, areaKey);
  if (!existing) return res.status(404).json({ error: 'No baseline to delete' });

  // Archive it first
  db.prepare('INSERT INTO baseline_history (id,tenant_id,area_key,resources,label,resource_modes,watched_keys) VALUES (?,?,?,?,?,?,?)')
    .run(uuidv4(), tenantId, areaKey, existing.resources,
         `[Deleted] ${existing.label || 'Baseline'}`,
         existing.resource_modes || '{}', existing.watched_keys || '[]');

  db.prepare('DELETE FROM baselines WHERE tenant_id = ? AND area_key = ?').run(tenantId, areaKey);
  db.prepare("UPDATE resource_areas SET has_baseline=0, baseline_set_at=NULL WHERE tenant_id=? AND area_key=?").run(tenantId, areaKey);

  logger.info({ tenantId, areaKey }, 'Baseline deleted (archived)');
  res.json({ message: 'Baseline deleted and archived' });
});

// POST /api/areas/:tenantId/:areaKey/baseline/restore/:historyId — restore from archive
router.post('/:tenantId/:areaKey/baseline/restore/:historyId', (req, res) => {
  const { tenantId, areaKey, historyId } = req.params;
  const db = getDb();
  const historical = db.prepare('SELECT * FROM baseline_history WHERE id = ? AND tenant_id = ? AND area_key = ?')
    .get(historyId, tenantId, areaKey);
  if (!historical) return res.status(404).json({ error: 'Historical baseline not found' });

  const resources = JSON.parse(historical.resources);
  const resourceModes = JSON.parse(historical.resource_modes || '{}');
  const watchedKeys = JSON.parse(historical.watched_keys || '[]');

  // Archive current if exists
  const existing = db.prepare('SELECT * FROM baselines WHERE tenant_id = ? AND area_key = ?').get(tenantId, areaKey);
  if (existing) {
    db.prepare('INSERT INTO baseline_history (id,tenant_id,area_key,resources,label,resource_modes,watched_keys) VALUES (?,?,?,?,?,?,?)')
      .run(uuidv4(), tenantId, areaKey, existing.resources,
           `[Superseded] ${existing.label}`, existing.resource_modes || '{}', existing.watched_keys || '[]');
    db.prepare(`UPDATE baselines SET resources=?,watched_keys=?,label=?,resource_modes=?,resource_hashes='{}',updated_at=datetime('now')
       WHERE tenant_id=? AND area_key=?`)
      .run(JSON.stringify(resources), JSON.stringify(watchedKeys),
           `[Restored] ${historical.label}`, JSON.stringify(resourceModes), tenantId, areaKey);
  } else {
    db.prepare(`INSERT INTO baselines (id,tenant_id,area_key,label,resources,watched_keys,resource_modes) VALUES (?,?,?,?,?,?,?)`)
      .run(uuidv4(), tenantId, areaKey, `[Restored] ${historical.label}`,
           JSON.stringify(resources), JSON.stringify(watchedKeys), JSON.stringify(resourceModes));
    db.prepare("UPDATE resource_areas SET has_baseline=1, baseline_set_at=datetime('now') WHERE tenant_id=? AND area_key=?")
      .run(tenantId, areaKey);
  }

  res.json({ message: 'Baseline restored from archive' });
});

// GET /api/areas/:tenantId/:areaKey/drift — latest drift result with full detail
router.get('/:tenantId/:areaKey/drift', (req, res) => {
  const db = getDb();
  const drift = db.prepare('SELECT * FROM drift_results WHERE tenant_id = ? AND area_key = ? ORDER BY checked_at DESC LIMIT 1')
    .get(req.params.tenantId, req.params.areaKey);
  if (!drift) return res.status(404).json({ error: 'No drift check run yet' });

  const baseline = db.prepare('SELECT watched_keys FROM baselines WHERE tenant_id = ? AND area_key = ?')
    .get(req.params.tenantId, req.params.areaKey);

  res.json({
    ...drift,
    summary: JSON.parse(drift.summary || '[]'),
    watchedKeys: JSON.parse(baseline?.watched_keys || '[]')
  });
});

// POST /api/areas/:tenantId/:areaKey/drift — trigger a fresh drift check
router.post('/:tenantId/:areaKey/drift', async (req, res) => {
  const { tenantId, areaKey } = req.params;
  const db = getDb();
  const baseline = db.prepare('SELECT id FROM baselines WHERE tenant_id = ? AND area_key = ?').get(tenantId, areaKey);
  if (!baseline) return res.status(400).json({ error: 'Set a baseline before running drift checks' });

  const jobId = createSyncJob(tenantId, areaKey);
  runSync(jobId).catch(err => logger.error({ err, jobId }, 'Drift job error'));
  res.status(202).json({ jobId });
});

// POST /api/areas/:tenantId/:areaKey/restore — restore a resource (or property) to baseline
// Query param ?dryRun=true returns the PATCH body without executing it.
router.post('/:tenantId/:areaKey/restore', async (req, res) => {
  const { tenantId, areaKey } = req.params;
  const { resourceId, propertyPath = null, restoreType = null } = req.body;
  const dryRun = req.query.dryRun === 'true';
  if (!resourceId) return res.status(400).json({ error: 'resourceId required' });

  const effectiveType = restoreType || (propertyPath ? 'manual_property' : 'manual_full');

  if (dryRun) {
    // ── Dry-run: compute and return the PATCH body without executing ──────
    try {
      const db = getDb();
      const tenant   = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
      const baseline = db.prepare('SELECT * FROM baselines WHERE tenant_id = ? AND area_key = ?').get(tenantId, areaKey);
      if (!tenant || !baseline) return res.status(404).json({ error: 'Tenant or baseline not found' });

      const resources     = JSON.parse(baseline.resources || '{}');
      const baselineRes   = resources[resourceId];
      if (!baselineRes) return res.status(404).json({ error: 'Resource not found in baseline' });

      const liveSnap = db.prepare(
        'SELECT resources FROM live_snapshots WHERE tenant_id = ? AND area_key = ? ORDER BY pulled_at DESC LIMIT 1'
      ).get(tenantId, areaKey);
      const liveResources = liveSnap ? JSON.parse(liveSnap.resources) : {};
      const liveRes       = liveResources[resourceId];

      const { buildRestorePayload } = require('../engine/restore');

      let patchPayload;
      try {
        patchPayload = await buildRestorePayload(tenantId, areaKey, resourceId, propertyPath, baselineRes, liveRes);
      } catch {
        patchPayload = propertyPath
          ? { [propertyPath]: baselineRes[propertyPath] }
          : { ...baselineRes };
      }

      logger.info({ tenantId, areaKey, resourceId, propertyPath, dryRun: true }, 'Restore dry-run computed');
      return res.json({
        dryRun: true,
        tenantId, areaKey, resourceId, propertyPath,
        resourceName: baselineRes.displayName || resourceId,
        patchUrl: `/api/areas/${tenantId}/${areaKey}/restore`,
        patchBody: patchPayload,
        baselineValues: propertyPath ? { [propertyPath]: baselineRes[propertyPath] } : baselineRes,
        liveValues:     propertyPath ? { [propertyPath]: liveRes?.[propertyPath] } : liveRes,
      });
    } catch (err) {
      logger.warn({ err, tenantId, areaKey, resourceId }, 'Restore dry-run failed');
      return res.status(500).json({ error: 'Dry-run failed', message: err.message });
    }
  }

  try {
    logger.info({ tenantId, areaKey, resourceId, propertyPath, restoreType: effectiveType }, 'Restore initiated');
    const result = await restoreResource(tenantId, areaKey, resourceId, propertyPath, effectiveType);
    logger.info({ tenantId, areaKey, resourceId, propertyPath, result }, 'Restore completed successfully');
    res.json(result);
  } catch (err) {
    logger.error({ err, tenantId, areaKey, resourceId, propertyPath, restoreType: effectiveType }, 'Restore FAILED — Graph PATCH rejected');
    res.status(500).json({ error: 'Restore failed', message: err.message });
  }
});

// PATCH /api/areas/:tenantId/:areaKey/auto-restore — toggle auto-restore
router.patch('/:tenantId/:areaKey/auto-restore', (req, res) => {
  const db = getDb();
  const { enabled } = req.body;
  db.prepare('UPDATE resource_areas SET auto_restore=? WHERE tenant_id=? AND area_key=?')
    .run(enabled ? 1 : 0, req.params.tenantId, req.params.areaKey);
  res.json({ message: `Auto-restore ${enabled ? 'enabled' : 'disabled'}` });
});

// GET /api/areas/:tenantId/:areaKey/restore-log
router.get('/:tenantId/:areaKey/restore-log', (req, res) => {
  const db = getDb();
  const log = db.prepare('SELECT * FROM restore_log WHERE tenant_id=? AND area_key=? ORDER BY restored_at DESC LIMIT 50')
    .all(req.params.tenantId, req.params.areaKey);
  res.json(log);
});

// GET /api/areas/:tenantId/:areaKey/history — baseline version history (with resources for restore)
router.get('/:tenantId/:areaKey/history', (req, res) => {
  const db = getDb();
  const history = db.prepare('SELECT id,label,archived_at,resources,resource_modes,watched_keys FROM baseline_history WHERE tenant_id=? AND area_key=? ORDER BY archived_at DESC LIMIT 20')
    .all(req.params.tenantId, req.params.areaKey);
  res.json(history.map(h => ({
    ...h,
    resources:    JSON.parse(h.resources    || '{}'),
    resourceModes: JSON.parse(h.resource_modes || '{}'),
    watchedKeys:  JSON.parse(h.watched_keys  || '[]'),
  })));
});

module.exports = router;
