'use strict';
// Report assembler — queries all SQLite data for a tenant + date range.
// Config state is fetched fresh from Graph at report generation time (using
// stored credentials), ensuring Groups, Apps and Devices are always populated.
// No dependency on in-memory caches.

const { getDb }             = require('../database/init');
const { decrypt }           = require('../utils/encryption');
const { getAccessToken }    = require('../services/auth');
const { fetchTenantOverview } = require('../collectors/overview');

function iso(dt) { return dt ? new Date(dt).toISOString() : null; }
function safeJson(val, fallback = null) {
  if (val == null) return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}
function effectiveStatus(status, driftCount) {
  return (status === 'drifted' && (driftCount || 0) === 0) ? 'clean' : status;
}

// ── Derive user counts from live_snapshots ────────────────────────────────────
function deriveUserCounts(tenantId) {
  const db = getDb();
  const row = db.prepare(
    'SELECT resources FROM live_snapshots WHERE tenant_id = ? AND area_key = ? ORDER BY pulled_at DESC LIMIT 1'
  ).get(tenantId, 'entra_users');
  if (!row) return null;
  const res = safeJson(row.resources, {});
  const all = Object.values(res);
  if (all.length === 0) return null;
  const total    = all.length;
  const guests   = all.filter(u => u.userType === 'Guest').length;
  const disabled = all.filter(u => u.accountEnabled === false).length;
  const members  = total - guests;
  return { total, members, guests, disabled, guestPercent: total > 0 ? Math.round((guests / total) * 100) : 0 };
}

// ── Fetch fresh overview data (groups, apps, devices) from Graph ─────────────
async function fetchFreshOverview(tenantId) {
  const db = getDb();
  try {
    const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
    if (!tenant) return null;
    const clientSecret = decrypt(tenant.client_secret_encrypted);
    const token = await getAccessToken(tenant.tenant_id, tenant.client_id, clientSecret);
    return await fetchTenantOverview(token);
  } catch {
    // If Graph call fails at report time, fall back to null — report shows "not available"
    return null;
  }
}

// ── Security Defaults from live snapshot ──────────────────────────────────────
function deriveSecurityDefaults(tenantId) {
  const db = getDb();
  const row = db.prepare(
    'SELECT resources FROM live_snapshots WHERE tenant_id = ? AND area_key = ? ORDER BY pulled_at DESC LIMIT 1'
  ).get(tenantId, 'entra_auth_policies');
  if (!row) return null;
  const res = safeJson(row.resources, {});
  const sd = res['security_defaults'];
  return sd != null ? sd.isEnabled : null;
}

// ── CA policies from live snapshot ────────────────────────────────────────────
function deriveCAPolicies(tenantId) {
  const db = getDb();
  const row = db.prepare(
    'SELECT resources FROM live_snapshots WHERE tenant_id = ? AND area_key = ? ORDER BY pulled_at DESC LIMIT 1'
  ).get(tenantId, 'entra_ca');
  if (!row) return [];
  const res = safeJson(row.resources, {});
  return Object.values(res).map(p => ({ name: p.displayName, state: p.state }));
}

// ── Outstanding: areas currently still drifted ────────────────────────────────
function computeOutstanding(tenantId, driftedAreaKeys) {
  if (driftedAreaKeys.length === 0) return 0;
  const db = getDb();
  let outstanding = 0;
  for (const areaKey of driftedAreaKeys) {
    const latest = db.prepare(
      'SELECT status, drift_count FROM drift_results WHERE tenant_id = ? AND area_key = ? ORDER BY checked_at DESC LIMIT 1'
    ).get(tenantId, areaKey);
    if (!latest) continue;
    if (effectiveStatus(latest.status, latest.drift_count) === 'drifted') outstanding++;
  }
  return outstanding;
}

// ── Main tenant report assembler ──────────────────────────────────────────────
async function assembleTenantReport(tenantId, dateStart, dateEnd, notes = {}) {
  const db = getDb();
  const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
  if (!tenant) throw new Error(`Tenant not found: ${tenantId}`);
  const areas = db.prepare('SELECT * FROM resource_areas WHERE tenant_id = ?').all(tenantId);

  // ── Drift history: query all rows, filter genuine drifts, deduplicate by area ──
  // Each unique (area, sync-session) produces one drift result row. Multiple sync
  // rows for the same config change = same event, not multiple events.
  // Deduplication: group by area_key and take the row with the highest drift_count
  // within the period — that represents the full extent of the drift.
  const driftRows = db.prepare(`
    SELECT dr.*, ra.display_name as area_display_name
    FROM drift_results dr
    LEFT JOIN resource_areas ra ON ra.tenant_id = dr.tenant_id AND ra.area_key = dr.area_key
    WHERE dr.tenant_id = ?
      AND dr.checked_at >= ? AND dr.checked_at <= ?
    ORDER BY dr.checked_at ASC
  `).all(tenantId, dateStart, dateEnd);

  // Deduplicate: one entry per area (the first detection of drift for that area)
  const seenAreas = new Set();
  const driftEvents = [];
  for (const r of driftRows) {
    if (r.status !== 'drifted' || (r.drift_count || 0) === 0) continue;
    if (seenAreas.has(r.area_key)) continue; // already counted this area
    seenAreas.add(r.area_key);
    const summary = safeJson(r.summary, []);
    driftEvents.push({
      id:         r.id,
      areaKey:    r.area_key,
      areaName:   r.area_display_name || r.area_key,
      checkedAt:  iso(r.checked_at),
      driftCount: r.drift_count,
      properties: summary.filter(s => s.status === 'drifted' || s.status === 'missing')
        .map(s => ({
          resourceId:   s.resourceId,
          resourceName: s.resourceName || s.resourceId,
          status:       s.status,
          drifts: (s.drifts || []).map(d => ({
            path:          d.path,
            label:         d.label || d.path,
            baselineValue: d.baselineValue,
            liveValue:     d.liveValue,
          })),
        })),
    });
  }

  // Drift trend by day (all rows, not deduplicated — shows activity pattern)
  const driftByDay = {};
  driftRows.forEach(r => {
    const day = (r.checked_at || '').slice(0, 10);
    if (!driftByDay[day]) driftByDay[day] = { drifted: 0, clean: 0 };
    const eff = effectiveStatus(r.status, r.drift_count);
    driftByDay[day][eff === 'drifted' ? 'drifted' : 'clean']++;
  });

  // ── Remediation log ──────────────────────────────────────────────────────────
  const restoreRows = db.prepare(`
    SELECT rl.*, ra.display_name as area_display_name
    FROM restore_log rl
    LEFT JOIN resource_areas ra ON ra.tenant_id = rl.tenant_id AND ra.area_key = rl.area_key
    WHERE rl.tenant_id = ?
      AND rl.restored_at >= ? AND rl.restored_at <= ?
    ORDER BY rl.restored_at ASC
  `).all(tenantId, dateStart, dateEnd);

  const remediations = restoreRows.map(r => ({
    id:           r.id,
    areaKey:      r.area_key,
    areaName:     r.area_display_name || r.area_key,
    resourceId:   r.resource_id,
    resourceName: r.resource_name || r.resource_id,
    propertyPath: r.property_path || null,
    restoredAt:   iso(r.restored_at),
    trigger:      r.restored_by === 'auto' ? 'Auto-restore' : 'Manual',
    success:      r.success === 1,
    errorMessage: r.error_message || null,
    oldValue:     r.old_value || null,
    newValue:     r.new_value || null,
  }));

  const remSucceeded = remediations.filter(r => r.success).length;
  const remFailed    = remediations.filter(r => !r.success).length;
  const remAuto      = remediations.filter(r => r.trigger === 'Auto-restore' && r.success).length;
  const remManual    = remediations.filter(r => r.trigger === 'Manual' && r.success).length;

  // ── Baseline coverage ────────────────────────────────────────────────────────
  const baselineCoverage = areas.map(area => {
    const latestDrift = db.prepare(
      'SELECT status, drift_count, checked_at FROM drift_results WHERE tenant_id = ? AND area_key = ? ORDER BY checked_at DESC LIMIT 1'
    ).get(tenantId, area.area_key);
    const eff = latestDrift ? effectiveStatus(latestDrift.status, latestDrift.drift_count) : null;
    return {
      areaKey:       area.area_key,
      areaName:      area.display_name,
      hasBaseline:   area.has_baseline === 1,
      lastChecked:   latestDrift ? iso(latestDrift.checked_at) : null,
      currentStatus: eff,
    };
  });

  const baselined   = baselineCoverage.filter(a => a.hasBaseline).length;
  const cleanNow    = baselineCoverage.filter(a => a.currentStatus === 'clean').length;
  const coveragePct = baselined > 0 ? Math.round((cleanNow / baselined) * 100) : null;
  const outstanding = computeOutstanding(tenantId, [...seenAreas]);

  // ── Config state: fetch fresh from Graph ─────────────────────────────────────
  const overview  = await fetchFreshOverview(tenantId);
  const userCounts = deriveUserCounts(tenantId);  // from snapshot as fallback

  const deviceTotal = overview?.devices
    ? (overview.devices.registered || 0) + (overview.devices.joined || 0) + (overview.devices.hybrid || 0)
    : null;

  const configState = {
    users:   userCounts,
    groups:  overview?.groups  || null,
    apps:    overview?.apps    || null,
    devices: overview?.devices ? {
      total:      deviceTotal,
      joined:     overview.devices.joined      || 0,
      hybrid:     overview.devices.hybrid      || 0,
      registered: overview.devices.registered  || 0,
      byOS:       overview.devices.byOS        || {},
    } : null,
  };

  // ── Security controls (lightweight — from live snapshots only) ───────────────
  const securityControls = {
    securityDefaults: deriveSecurityDefaults(tenantId),
    caPolicies:       deriveCAPolicies(tenantId),
    guestPercent:     userCounts?.guestPercent ?? null,
  };

  return {
    meta: {
      tenantId,
      tenantName:  tenant.display_name,
      tenantUUID:  tenant.tenant_id,
      dateStart,
      dateEnd,
      generatedAt: new Date().toISOString(),
      notes,
    },
    summary: {
      coveragePct,
      baselined,
      totalAreas:   areas.length,
      driftEvents:  driftEvents.length,
      remediations: remSucceeded,
      outstanding,
    },
    driftHistory:   { events: driftEvents, byDay: driftByDay },
    remediationLog: { items: remediations, succeeded: remSucceeded, failed: remFailed, auto: remAuto, manual: remManual },
    baselineCoverage,
    configState,
    securityControls,
  };
}

// ── Portfolio report assembler ────────────────────────────────────────────────
async function assemblePortfolioReport(dateStart, dateEnd, notes = {}) {
  const db = getDb();
  const tenants = db.prepare('SELECT * FROM tenants ORDER BY display_name').all();
  const tenantReports = [];
  for (const t of tenants) {
    try {
      tenantReports.push(await assembleTenantReport(t.id, dateStart, dateEnd, {}));
    } catch { /* skip unavailable */ }
  }
  return {
    meta: { reportType: 'portfolio', dateStart, dateEnd, generatedAt: new Date().toISOString(), notes },
    summary: {
      tenantCount:    tenants.length,
      driftedTenants: tenantReports.filter(t => t.summary.driftEvents > 0).length,
      totalDrifts:    tenantReports.reduce((s, t) => s + t.summary.driftEvents, 0),
      totalFixed:     tenantReports.reduce((s, t) => s + t.summary.remediations, 0),
    },
    tenants: tenantReports,
  };
}

module.exports = { assembleTenantReport, assemblePortfolioReport };
