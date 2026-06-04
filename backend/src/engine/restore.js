const { getDb } = require('../database/init');
const { getAccessToken } = require('../services/auth');
const { resolveTenantAuthContext } = require('../services/tenantAuth');
const { getCollector } = require('../collectors');
const { graphPatch, graphPost, graphGet } = require('../services/graph');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const { emitSiemEvent } = require('../services/logAnalytics');

function buildPatchForPath(path, value) {
  const keys = path.split('.');
  const body = {};
  let target = body;
  for (let i = 0; i < keys.length - 1; i++) {
    target[keys[i]] = {};
    target = target[keys[i]];
  }
  target[keys[keys.length - 1]] = value;
  return body;
}

function getByPath(obj, path) {
  return path.split('.').reduce((acc, k) => (acc == null ? undefined : acc[k]), obj);
}

/**
 * Restore a single resource to its baseline state.
 *
 * @param {string}      tenantDbId    - Internal tenant UUID
 * @param {string}      areaKey       - e.g. 'entra_users'
 * @param {string}      resourceId    - Resource UUID
 * @param {string|null} propertyPath  - If set, restore only this property. Null = full restore.
 * @param {string}      restoreType   - 'manual_property' | 'manual_full' | 'bulk' | 'auto'
 */
async function restoreResource(tenantDbId, areaKey, resourceId, propertyPath = null, restoreType = null) {
  const db = getDb();
  const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantDbId);
  if (!tenant) throw new Error('Tenant not found');

  const baseline = db.prepare('SELECT * FROM baselines WHERE tenant_id = ? AND area_key = ?').get(tenantDbId, areaKey);
  if (!baseline) throw new Error('No baseline defined for this area');

  const baselineResources = JSON.parse(baseline.resources);
  const baselineResource = baselineResources[resourceId];
  if (!baselineResource) throw new Error(`Resource ${resourceId} not found in baseline`);

  const resourceName = baselineResource.displayName || resourceId;

  const authCtx = resolveTenantAuthContext(tenantDbId);
  const token = await getAccessToken(authCtx.authorityTenantId, authCtx.clientId, authCtx.clientSecret);

  const collector = getCollector(areaKey);
  const logId = uuidv4();

  // Derive restore type from context if not explicitly provided
  const effectiveType = restoreType || (propertyPath ? 'manual_property' : 'manual_full');

  if (propertyPath) {
    // ── Single property restore ──────────────────────────────────────────────

    // Check if the collector has marked this as portal-only for property restore
    if (collector.portalOnlyRestore) {
      db.prepare(`
        INSERT INTO restore_log
          (id,tenant_id,area_key,resource_id,resource_name,property_path,restore_type,restored_by,success,error_message)
        VALUES (?,?,?,?,?,?,?,?,0,?)
      `).run(
        logId, tenantDbId, areaKey, resourceId, resourceName,
        propertyPath, effectiveType, 'manual',
        `Property-level restore is not supported for this area — restore manually via the portal`
      );
      throw new Error(
        `Property-level restore is not supported for "${areaKey}". ` +
        `Use the full resource restore button, or correct the value manually via the Microsoft 365 admin portal.`
      );
    }

    // Check if this property is monitor-only (cannot be patched via Graph)
    const monitorOnly = collector.monitorOnlyKeys || [];
    const topLevelPath = propertyPath.split('.')[0];
    if (monitorOnly.includes(propertyPath) || monitorOnly.includes(topLevelPath)) {
      // Log as skipped and return a clear message — do not attempt a PATCH
      db.prepare(`
        INSERT INTO restore_log
          (id,tenant_id,area_key,resource_id,resource_name,property_path,restore_type,restored_by,success,error_message)
        VALUES (?,?,?,?,?,?,?,?,0,?)
      `).run(
        logId, tenantDbId, areaKey, resourceId, resourceName,
        propertyPath, effectiveType, 'manual',
        `"${propertyPath}" is a monitor-only field and cannot be restored via the Graph API`
      );
      throw new Error(
        `"${propertyPath}" on "${resourceName}" is monitored for changes but cannot be restored via the Graph API. ` +
        `Update this value manually in the Microsoft 365 admin centre.`
      );
    }

    const baselineValue = getByPath(baselineResource, propertyPath);
    const topField      = propertyPath.split('.')[0];

    // Deep nested paths (e.g. 'conditions.users.includeUsers') cannot be PATCHed
    // individually via Graph — the entire top-level object must be sent.
    // Block restore for paths deeper than one level where the top-level field
    // is a known complex object. The full resource restore handles these correctly.
    const complexTopFields = collector.complexRestoreFields || new Set();
    const pathDepth = propertyPath.split('.').length;
    if (pathDepth > 1 && complexTopFields.has(topField)) {
      db.prepare(`
        INSERT INTO restore_log
          (id,tenant_id,area_key,resource_id,resource_name,property_path,restore_type,restored_by,success,error_message)
        VALUES (?,?,?,?,?,?,?,?,0,?)
      `).run(
        logId, tenantDbId, areaKey, resourceId, resourceName,
        propertyPath, effectiveType, 'manual',
        `"${propertyPath}" is part of a complex nested object — restore the full resource instead, or correct it manually in the Microsoft 365 admin centre.`
      );
      throw new Error(
        `Cannot restore nested path "${propertyPath}" on "${resourceName}" individually — ` +
        `"${topField}" is a complex object that must be updated as a whole. ` +
        `Use the full resource restore button instead.`
      );
    }

    // If the baseline value is an empty string and the collector flags this field
    // as one Graph rejects when sent empty, fail gracefully rather than sending
    // a PATCH that will always return "Invalid value specified".
    if (baselineValue === '' && collector.graphRejectsEmpty?.has(topField)) {
      db.prepare(`
        INSERT INTO restore_log
          (id,tenant_id,area_key,resource_id,resource_name,property_path,restore_type,restored_by,success,error_message)
        VALUES (?,?,?,?,?,?,?,?,0,?)
      `).run(
        logId, tenantDbId, areaKey, resourceId, resourceName,
        propertyPath, effectiveType, 'manual',
        `Baseline value for "${propertyPath}" is blank — Graph API does not accept empty strings for this field. Update the baseline to a non-blank value first, or clear the field manually in the Microsoft 365 admin centre.`
      );
      throw new Error(
        `Cannot restore "${propertyPath}" on "${resourceName}" — the baseline captured a blank value, ` +
        `and the Graph API does not accept empty strings for this field. ` +
        `Update the baseline to reflect the desired value, or clear it manually in the Microsoft 365 admin centre.`
      );
    }

    const patchBody = buildPatchForPath(propertyPath, baselineValue);
    const patchPath = collector.restorePath
      ? collector.restorePath(resourceId)
      : `${collector.graphBasePath}/${resourceId}`;

    try {
      await graphPatch(token, patchPath, patchBody);
      db.prepare(`
        INSERT INTO restore_log
          (id,tenant_id,area_key,resource_id,resource_name,property_path,restore_type,restored_by,new_value,restored_properties,success)
        VALUES (?,?,?,?,?,?,?,?,?,?,1)
      `).run(
        logId, tenantDbId, areaKey, resourceId, resourceName,
        propertyPath, effectiveType, 'manual',
        JSON.stringify(baselineValue),
        JSON.stringify([{ path: propertyPath, baselineValue }])
      );
      logger.info({ areaKey, resourceId, propertyPath }, 'Property restored to baseline');
      emitSiemEvent('restore', 'restore.property.succeeded', {
        tenantDbId,
        areaKey,
        resourceId,
        propertyPath,
        restoreType: effectiveType,
      });
      return {
        success: true,
        message: `"${propertyPath}" on "${resourceName}" restored to baseline value`
      };
    } catch (err) {
      db.prepare(`
        INSERT INTO restore_log
          (id,tenant_id,area_key,resource_id,resource_name,property_path,restore_type,restored_by,success,error_message)
        VALUES (?,?,?,?,?,?,?,?,0,?)
      `).run(logId, tenantDbId, areaKey, resourceId, resourceName, propertyPath, effectiveType, 'manual', err.message);
      emitSiemEvent('restore', 'restore.property.failed', {
        tenantDbId,
        areaKey,
        resourceId,
        propertyPath,
        restoreType: effectiveType,
        error: err.message,
      });
      throw new Error(`Restore failed for property "${propertyPath}" on "${resourceName}": ${err.message}`);
    }
  } else {
    // ── Full resource restore — delegate to collector ──────────────────────────

    // Check if the collector has marked all restore as portal-only
    if (collector.portalOnlyRestore) {
      db.prepare(`
        INSERT INTO restore_log
          (id,tenant_id,area_key,resource_id,resource_name,restore_type,restored_by,success,error_message)
        VALUES (?,?,?,?,?,?,?,0,?)
      `).run(
        logId, tenantDbId, areaKey, resourceId, resourceName,
        restoreType || 'manual_full', 'manual',
        `${areaKey} cannot be restored via the Graph API — use the portal`
      );
      // Still delegate to the collector's restore() which has the detailed portal message
      await collector.restore(token, resourceId, baselineResource);
    }

    // Detect whether the resource is missing from the live tenant so we can
    // pick the right restore path (PATCH for drifted, POST/recreate for missing).
    const liveSnap = db.prepare(
      'SELECT resources FROM live_snapshots WHERE tenant_id = ? AND area_key = ? ORDER BY pulled_at DESC LIMIT 1'
    ).get(tenantDbId, areaKey);
    const liveResources = liveSnap ? JSON.parse(liveSnap.resources) : {};
    const isMissing = !liveResources[resourceId];
    const effectiveRestoreType = isMissing ? 'recreate' : (restoreType || 'manual_full');

    // Build the list of properties that will be restored for the audit log
    const restoredProps = Object.entries(baselineResource)
      .filter(([k]) => !['id', 'createdDateTime', 'lastModifiedDateTime', 'modifiedDateTime', 'renewedDateTime'].includes(k))
      .map(([path, baselineValue]) => ({ path, baselineValue }));

    try {
      await collector.restore(token, resourceId, baselineResource);
      db.prepare(`
        INSERT INTO restore_log
          (id,tenant_id,area_key,resource_id,resource_name,restore_type,restored_by,new_value,restored_properties,success)
        VALUES (?,?,?,?,?,?,?,?,?,1)
      `).run(
        logId, tenantDbId, areaKey, resourceId, resourceName,
        effectiveRestoreType, effectiveRestoreType === 'auto' ? 'auto' : 'manual',
        JSON.stringify(baselineResource),
        JSON.stringify(restoredProps)
      );
      logger.info({ areaKey, resourceId, restoreType: effectiveRestoreType, isMissing }, 'Full resource restored to baseline');
      emitSiemEvent('restore', 'restore.resource.succeeded', {
        tenantDbId,
        areaKey,
        resourceId,
        restoreType: effectiveRestoreType,
        isMissing,
      });
      return {
        success: true,
        message: isMissing
          ? `"${resourceName}" recreated from baseline`
          : `"${resourceName}" fully restored to baseline state`
      };
    } catch (err) {
      db.prepare(`
        INSERT INTO restore_log
          (id,tenant_id,area_key,resource_id,resource_name,restore_type,restored_by,success,error_message)
        VALUES (?,?,?,?,?,?,?,0,?)
      `).run(
        logId, tenantDbId, areaKey, resourceId, resourceName,
        effectiveRestoreType, effectiveRestoreType === 'auto' ? 'auto' : 'manual',
        err.message
      );
      emitSiemEvent('restore', 'restore.resource.failed', {
        tenantDbId,
        areaKey,
        resourceId,
        restoreType: effectiveRestoreType,
        isMissing,
        error: err.message,
      });
      throw new Error(`Restore failed for "${resourceName}": ${err.message}`);
    }
  }
}

// ── buildRestorePayload — used by the dry-run endpoint ───────────────────────
// Returns what WOULD be PATCHed without executing it.
async function buildRestorePayload(tenantId, areaKey, resourceId, propertyPath, baselineRes, liveRes) {
  if (propertyPath) {
    return { [propertyPath]: baselineRes[propertyPath] };
  }
  // Full restore: strip read-only and metadata fields
  const readOnly = ['id', 'createdDateTime', 'lastModifiedDateTime', 'modifiedDateTime',
    'renewedDateTime', 'deletedDateTime', '@odata.type', '@odata.context'];
  const patch = {};
  for (const [k, v] of Object.entries(baselineRes)) {
    if (!readOnly.includes(k)) patch[k] = v;
  }
  return patch;
}

module.exports = { restoreResource, buildRestorePayload };
