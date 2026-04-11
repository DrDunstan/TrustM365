/**
 * Baseline Policies
 *
 * A policy is a named grouping of resource areas for a tenant.
 * It has no effect on how drift is computed — it's a presentation layer
 * that lets you view and report on multiple areas together.
 *
 * Routes:
 *   GET    /api/policies/:tenantId           — list all policies for a tenant
 *   POST   /api/policies/:tenantId           — create a policy
 *   GET    /api/policies/:tenantId/:id       — get a single policy with drift summary
 *   PATCH  /api/policies/:tenantId/:id       — update name/description/color/area_keys
 *   DELETE /api/policies/:tenantId/:id       — delete a policy (areas are unaffected)
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database/init');
const logger = require('../utils/logger');
const router = express.Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function enrichPolicy(policy, db) {
  const areaKeys = JSON.parse(policy.area_keys || '[]');

  // For each included area, grab the latest drift result
  const areaDetails = areaKeys.map(areaKey => {
    const area = db.prepare('SELECT * FROM resource_areas WHERE tenant_id=? AND area_key=?')
      .get(policy.tenant_id, areaKey);
    const latestDrift = db.prepare(
      'SELECT status, drift_count, checked_at FROM drift_results WHERE tenant_id=? AND area_key=? ORDER BY checked_at DESC LIMIT 1'
    ).get(policy.tenant_id, areaKey);
    return {
      areaKey,
      displayName: area?.display_name || areaKey,
      hasBaseline: area?.has_baseline === 1,
      lastPulledAt: area?.last_pulled_at || null,
      drift: latestDrift ? {
        status:     latestDrift.status,
        driftCount: latestDrift.drift_count,
        checkedAt:  latestDrift.checked_at,
      } : null,
    };
  });

  // Roll up to a policy-level status
  const driftedAreas  = areaDetails.filter(a => a.drift?.status === 'drifted').length;
  const cleanAreas    = areaDetails.filter(a => a.drift?.status === 'clean').length;
  const uncheckedAreas= areaDetails.filter(a => !a.drift).length;
  const totalDrift    = areaDetails.reduce((sum, a) => sum + (a.drift?.driftCount || 0), 0);

  const overallStatus = driftedAreas > 0 ? 'drifted'
    : uncheckedAreas === areaDetails.length ? 'unchecked'
    : cleanAreas === areaDetails.length ? 'clean'
    : 'partial';

  return {
    ...policy,
    area_keys: areaKeys,
    areas: areaDetails,
    summary: { driftedAreas, cleanAreas, uncheckedAreas, totalDrift, overallStatus },
  };
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/policies/:tenantId — list
router.get('/:tenantId', (req, res) => {
  const db = getDb();
  const policies = db.prepare('SELECT * FROM baseline_policies WHERE tenant_id=? ORDER BY name').all(req.params.tenantId);
  res.json(policies.map(p => enrichPolicy(p, db)));
});

// POST /api/policies/:tenantId — create
router.post('/:tenantId', (req, res) => {
  const { tenantId } = req.params;
  const { name, description = '', color = '#6366f1', area_keys = [] } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });

  const db = getDb();
  const id = uuidv4();
  db.prepare(`INSERT INTO baseline_policies (id,tenant_id,name,description,color,area_keys) VALUES (?,?,?,?,?,?)`)
    .run(id, tenantId, name.trim(), description, color, JSON.stringify(area_keys));

  const created = db.prepare('SELECT * FROM baseline_policies WHERE id=?').get(id);
  logger.info({ tenantId, policyId: id, name }, 'Baseline policy created');
  res.status(201).json(enrichPolicy(created, db));
});

// GET /api/policies/:tenantId/:id — single policy with full drift breakdown
router.get('/:tenantId/:id', (req, res) => {
  const db = getDb();
  const policy = db.prepare('SELECT * FROM baseline_policies WHERE id=? AND tenant_id=?')
    .get(req.params.id, req.params.tenantId);
  if (!policy) return res.status(404).json({ error: 'Policy not found' });
  res.json(enrichPolicy(policy, db));
});

// PATCH /api/policies/:tenantId/:id — update
router.patch('/:tenantId/:id', (req, res) => {
  const { tenantId, id } = req.params;
  const db = getDb();
  const policy = db.prepare('SELECT * FROM baseline_policies WHERE id=? AND tenant_id=?').get(id, tenantId);
  if (!policy) return res.status(404).json({ error: 'Policy not found' });

  const name       = req.body.name       ?? policy.name;
  const description= req.body.description?? policy.description;
  const color      = req.body.color      ?? policy.color;
  const area_keys  = req.body.area_keys  !== undefined ? req.body.area_keys : JSON.parse(policy.area_keys);

  db.prepare(`UPDATE baseline_policies SET name=?,description=?,color=?,area_keys=?,updated_at=datetime('now') WHERE id=?`)
    .run(name, description, color, JSON.stringify(area_keys), id);

  const updated = db.prepare('SELECT * FROM baseline_policies WHERE id=?').get(id);
  res.json(enrichPolicy(updated, db));
});

// DELETE /api/policies/:tenantId/:id — delete (areas unaffected)
router.delete('/:tenantId/:id', (req, res) => {
  const { tenantId, id } = req.params;
  const db = getDb();
  const policy = db.prepare('SELECT * FROM baseline_policies WHERE id=? AND tenant_id=?').get(id, tenantId);
  if (!policy) return res.status(404).json({ error: 'Policy not found' });
  db.prepare('DELETE FROM baseline_policies WHERE id=?').run(id);
  logger.info({ tenantId, policyId: id }, 'Baseline policy deleted');
  res.json({ message: 'Policy deleted' });
});

module.exports = router;
