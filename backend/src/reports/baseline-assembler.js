'use strict';
/**
 * baseline-assembler.js
 *
 * Assembles a baseline export payload from the baselines table (or
 * baseline_history for a specific archived version) for all areas that
 * have an active baseline for the given tenant.
 *
 * The payload is consumed by baseline-renderer.js (HTML) and the docx
 * renderer for Word export.
 */

const { getDb } = require('../database/init');
const { COLLECTORS, getCollector } = require('../collectors/index');

// Pretty-print a raw value for display
function fmtValue(val) {
  if (val === null || val === undefined) return '—';
  if (typeof val === 'boolean') return val ? 'Yes' : 'No';
  if (typeof val === 'object') return JSON.stringify(val, null, 2);
  return String(val);
}

// Build a label→value list for the monitored (watched) properties of a resource
function buildWatchedProps(resource, watchedKeys) {
  return watchedKeys.map(wk => {
    const path  = wk.path || wk;
    const label = wk.label || path;
    const parts = path.split('.');
    let val = resource;
    for (const p of parts) {
      if (val == null) break;
      val = val[p];
    }
    return { path, label, value: fmtValue(val) };
  });
}

// Build area-level export for one baseline row
function assembleArea(baseline, areaKey) {
  const collector   = getCollector(areaKey);
  const resources   = JSON.parse(baseline.resources   || '{}');
  const watchedKeys = JSON.parse(baseline.watched_keys || '[]');
  const resModes    = JSON.parse(baseline.resource_modes || '{}');

  const resourceList = Object.entries(resources).map(([id, res]) => {
    const mode = resModes[id] || 'properties';
    const isEpSecurity = Array.isArray(res.settings) &&
      res.settings.length > 0 &&
      res.settings[0]?.settingInstance !== undefined;

    // Monitored properties (for properties mode)
    let watchedProps = [];
    if (mode === 'properties' && watchedKeys.length > 0) {
      watchedProps = buildWatchedProps(res, watchedKeys);
    }

    // Full config — flatten all scalar fields, keep arrays/objects as JSON
    const fullConfig = Object.entries(res)
      .filter(([k]) => k !== 'id')
      .map(([k, v]) => ({
        key: k,
        value: fmtValue(v),
      }));

    // EP Security areas: expose settings as raw settingDefinitionId list
    let epSettings = null;
    if (isEpSecurity) {
      epSettings = res.settings.map(s => ({
        settingDefinitionId: s.settingInstance?.settingDefinitionId || '—',
        value: fmtValue(
          s.settingInstance?.choiceSettingValue ??
          s.settingInstance?.simpleSettingValue ??
          s.settingInstance
        ),
      }));
    }

    return {
      id,
      displayName: res.displayName || res.name || id,
      mode,
      watchedProps,   // monitored properties with labels
      fullConfig,     // every field in the stored baseline
      epSettings,     // null unless EP Security settings catalog area
    };
  });

  return {
    areaKey,
    areaDisplayName: collector?.displayName || areaKey,
    areaDescription: collector?.description || '',
    label:           baseline.label,
    savedAt:         baseline.updated_at || baseline.archived_at || baseline.created_at,
    monitorMode:     watchedKeys.length > 0 ? 'properties' : 'snapshot',
    watchedKeyCount: watchedKeys.length,
    resourceCount:   resourceList.length,
    resources:       resourceList,
  };
}

/**
 * assembleBaselineExport(tenantId, versionOverrides?)
 *
 * versionOverrides: { [areaKey]: historyId } — use an archived version for
 * that area instead of the current active baseline.
 *
 * Returns { meta, areas[] }
 */
async function assembleBaselineExport(tenantId, versionOverrides = {}) {
  const db = getDb();

  const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
  if (!tenant) throw new Error(`Tenant ${tenantId} not found`);

  // All active baselines for this tenant
  const activeBaselines = db.prepare(
    'SELECT * FROM baselines WHERE tenant_id = ? ORDER BY area_key'
  ).all(tenantId);

  const areas = [];

  for (const active of activeBaselines) {
    const { area_key } = active;

    // Check if a history override is requested for this area
    const historyId = versionOverrides[area_key];
    let baseline = active;

    if (historyId) {
      const hist = db.prepare(
        'SELECT * FROM baseline_history WHERE id = ? AND tenant_id = ? AND area_key = ?'
      ).get(historyId, tenantId, area_key);
      if (hist) baseline = hist;
    }

    try {
      areas.push(assembleArea(baseline, area_key));
    } catch (err) {
      // Don't let one bad area break the whole export
      areas.push({
        areaKey:         area_key,
        areaDisplayName: area_key,
        areaDescription: '',
        label:           baseline.label,
        savedAt:         baseline.updated_at || baseline.archived_at,
        error:           err.message,
        resources:       [],
      });
    }
  }

  return {
    meta: {
      tenantName:    tenant.display_name,
      tenantUUID:    tenant.tenant_id,
      generatedAt:   new Date().toISOString(),
      totalAreas:    areas.length,
      totalResources: areas.reduce((n, a) => n + (a.resources?.length || 0), 0),
    },
    areas,
  };
}

/**
 * listBaselineHistory(tenantId)
 *
 * Returns { [areaKey]: [ { id, label, archived_at } ] } for every area
 * that has history records, most recent first.
 */
function listBaselineHistory(tenantId) {
  const db = getDb();
  const rows = db.prepare(
    `SELECT id, area_key, label, archived_at
     FROM baseline_history
     WHERE tenant_id = ?
     ORDER BY area_key, archived_at DESC`
  ).all(tenantId);

  const map = {};
  for (const row of rows) {
    if (!map[row.area_key]) map[row.area_key] = [];
    map[row.area_key].push({ id: row.id, label: row.label, archivedAt: row.archived_at });
  }
  return map;
}

module.exports = { assembleBaselineExport, listBaselineHistory };
