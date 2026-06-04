/**
 * Drift Engine
 *
 * Two monitor modes per resource:
 *   "snapshot"   — hash the entire resource JSON; any change = drift.
 *                  No property enumeration — just "it changed / it didn't".
 *   "properties" — compare specific watchedKeys (or all non-meta keys if none
 *                  selected). Existing behaviour.
 *
 * resource_modes: { [resourceId]: 'snapshot' | 'properties' }
 * resource_hashes: { [resourceId]: string }  — stored at baseline-save time
 */

const crypto = require('crypto');

// ── Utilities ────────────────────────────────────────────────────────────────

function getByPath(obj, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return a === b;
  return JSON.stringify(sortDeep(a)) === JSON.stringify(sortDeep(b));
}

function sortDeep(obj) {
  if (Array.isArray(obj)) return [...obj].sort().map(sortDeep);
  if (obj !== null && typeof obj === 'object')
    return Object.fromEntries(Object.keys(obj).sort().map(k => [k, sortDeep(obj[k])]));
  return obj;
}

// Stable hash of a resource object — strips volatile meta fields first
const VOLATILE_KEYS = new Set(['createdDateTime','lastModifiedDateTime','modifiedDateTime','renewedDateTime']);

function stableHash(resource) {
  const clean = Object.fromEntries(
    Object.entries(resource).filter(([k]) => !VOLATILE_KEYS.has(k))
  );
  return crypto.createHash('sha256').update(JSON.stringify(sortDeep(clean))).digest('hex').slice(0, 16);
}

// ── Property-level diff (properties mode) ────────────────────────────────────

function diffResource(liveResource, baselineResource, watchedKeys = []) {
  const diffs = [];
  const keysToCheck = watchedKeys.length > 0
    ? watchedKeys
        .map(k => {
          if (typeof k === 'string') return { path: k, label: k };
          if (k && typeof k === 'object' && typeof k.path === 'string') {
            return { path: k.path, label: k.label || k.path };
          }
          return null;
        })
        .filter(Boolean)
    : Object.keys(baselineResource)
        .filter(k => !VOLATILE_KEYS.has(k) && k !== 'id')
        .map(k => ({ path: k, label: k }));

  for (const { path, label } of keysToCheck) {
    const liveVal = getByPath(liveResource, path);
    const baseVal = getByPath(baselineResource, path);
    if (!deepEqual(liveVal, baseVal)) {
      diffs.push({
        path, label,
        baselineValue: baseVal,
        liveValue: liveVal,
        changeType: liveVal === undefined ? 'missing' : baseVal === undefined ? 'unexpected' : 'changed'
      });
    }
  }
  return diffs;
}

// ── Full drift computation ────────────────────────────────────────────────────

/**
 * @param {object} liveResources      { [id]: resourceObject }
 * @param {object} baselineResources  { [id]: resourceObject }
 * @param {array}  watchedKeys        [{ path, label }]  (properties mode)
 * @param {object} resourceModes      { [id]: 'snapshot' | 'properties' | 'none' }
 * @param {object} resourceHashes     { [id]: string }   (snapshot mode baseline hashes)
 */
function computeDrift(liveResources, baselineResources, watchedKeys = [], resourceModes = {}, resourceHashes = {}) {
  const summary = [];
  let totalDriftCount = 0;

  // ── Resources in baseline ──────────────────────────────────────────────────
  for (const [resourceId, baselineResource] of Object.entries(baselineResources)) {
    const liveResource = liveResources[resourceId];
    const mode = resourceModes[resourceId] || 'properties';

    // ── None mode: explicitly not monitored — skip entirely ─────────────────
    if (mode === 'none') {
      summary.push({
        resourceId,
        resourceName: baselineResource.displayName || resourceId,
        status: 'clean',
        monitorMode: 'none',
        message: 'Monitoring disabled for this resource',
        drifts: []
      });
      continue;
    }

    if (!liveResource) {
      summary.push({
        resourceId,
        resourceName: baselineResource.displayName || resourceId,
        status: 'missing',
        monitorMode: mode,
        message: 'Resource exists in baseline but was not found in the live tenant',
        drifts: []
      });
      totalDriftCount++;
      continue;
    }

    if (mode === 'snapshot') {
      // ── Snapshot mode: hash comparison ──────────────────────────────────
      const baseHash = resourceHashes[resourceId];
      const liveHash = stableHash(liveResource);
      if (baseHash && liveHash !== baseHash) {
        // Compute full diff for display purposes — not used for detection, only for UI
        const fullDiffs = diffResource(liveResource, baselineResource, []);
        summary.push({
          resourceId,
          resourceName: liveResource.displayName || resourceId,
          status: 'drifted',
          monitorMode: 'snapshot',
          message: `Resource configuration has changed (${fullDiffs.length} field${fullDiffs.length !== 1 ? 's' : ''} differ)`,
          drifts: fullDiffs,
          baseHash,
          liveHash
        });
        totalDriftCount++;
      } else {
        summary.push({
          resourceId,
          resourceName: liveResource.displayName || resourceId,
          status: 'clean',
          monitorMode: 'snapshot',
          message: 'No changes detected',
          drifts: [],
          baseHash,
          liveHash
        });
      }
    } else {
      // ── Properties mode: key-level comparison ───────────────────────────
      const diffs = diffResource(liveResource, baselineResource, watchedKeys);
      if (diffs.length > 0) {
        summary.push({
          resourceId,
          resourceName: liveResource.displayName || baselineResource.displayName || resourceId,
          status: 'drifted',
          monitorMode: 'properties',
          message: `${diffs.length} property difference${diffs.length !== 1 ? 's' : ''} detected`,
          drifts: diffs
        });
        totalDriftCount += diffs.length;
      } else {
        summary.push({
          resourceId,
          resourceName: liveResource.displayName || resourceId,
          status: 'clean',
          monitorMode: 'properties',
          message: 'Matches baseline',
          drifts: []
        });
      }
    }
  }

  // ── New resources not in baseline ─────────────────────────────────────────
  for (const [resourceId, liveResource] of Object.entries(liveResources)) {
    if (!baselineResources[resourceId]) {
      summary.push({
        resourceId,
        resourceName: liveResource.displayName || resourceId,
        status: 'new',
        monitorMode: 'properties',
        message: 'Resource exists in tenant but is not in the baseline',
        drifts: []
      });
    }
  }

  const overallStatus = totalDriftCount > 0 || summary.some(s => s.status === 'missing' || s.status === 'new')
    ? 'drifted' : 'clean';

  return { status: overallStatus, driftCount: totalDriftCount, summary };
}

module.exports = { computeDrift, diffResource, deepEqual, stableHash };
