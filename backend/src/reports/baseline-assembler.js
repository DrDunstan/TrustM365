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

// Helpers to produce human-friendly labels and summaries for common object shapes
function humanizeLabel(s) {
  if (!s) return '';
  const t = String(s).replace(/[_-]+/g, ' ').trim();
  const spaced = t.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2');
  return spaced.split(' ').filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function splitKnownWords(token) {
  if (!token) return token;
  const dict = ['require','allow','configure','recovery','password','rotation','warning','other','disk','encryption','device','msft','bitlocker','allowwarning','for'];
  const lower = token.toLowerCase();
  const parts = [];
  let pos = 0;
  const sorted = [...dict].sort((a,b) => b.length - a.length);
  while (pos < lower.length) {
    let matched = false;
    for (const w of sorted) {
      if (lower.startsWith(w, pos)) { parts.push(w); pos += w.length; matched = true; break; }
    }
    if (!matched) { parts.push(lower.slice(pos)); break; }
  }
  return parts.map(p => p === 'msft' ? 'Microsoft' : (p === 'bitlocker' ? 'BitLocker' : humanizeLabel(p))).join(' ');
}

function humanizeSettingDefinitionId(id) {
  if (!id) return '';
  const tokens = String(id).split(/[_-]+/).filter(Boolean);
  if (tokens.length === 1) return splitKnownWords(tokens[0]);
  return tokens.map(t => (t.toLowerCase() === 'msft' ? 'Microsoft' : humanizeLabel(t))).join(' ');
}

function humanizeChoiceValue(val) {
  if (val === undefined || val === null) return '';
  const cleaned = String(val).replace(/_\d+$/, '').replace(/_/g, ' ');
  return humanizeLabel(cleaned);
}

function summarizeAdminConsentPolicy(policy) {
  if (!policy || typeof policy !== 'object') return null;
  const enabled = policy.isEnabled === true ? 'Enabled' : (policy.isEnabled === false ? 'Disabled' : 'Configured');
  const reminders = policy.remindersEnabled === true ? 'Yes' : (policy.remindersEnabled === false ? 'No' : '—');
  const duration = policy.requestDurationInDays ?? '—';
  const notify = Array.isArray(policy.notifyReviewers) ? policy.notifyReviewers.length : (policy.notifyReviewers && policy.notifyReviewers.reviewers ? policy.notifyReviewers.reviewers.length : 0);
  return `${enabled} · Reminders: ${reminders} · Duration: ${duration}d · Reviewers: ${notify}`;
}

function summarizeAuthMethodsPolicy(policy) {
  if (!policy || typeof policy !== 'object') return null;
  const cfgs = Array.isArray(policy.authenticationMethodConfigurations) ? policy.authenticationMethodConfigurations : (Array.isArray(policy.authenticationMethodsConfigurations) ? policy.authenticationMethodsConfigurations : []);
  const reg = policy.registrationEnforcement || null;
  const regState = reg?.state || null;
  const snooze = reg?.snoozeDurationInDays ?? null;
  const campaign = reg?.authenticationMethodsRegistrationCampaign || null;
  const parts = [];
  if (campaign) parts.push(`Campaign: ${humanizeLabel(campaign)}`);
  if (regState) parts.push(`State: ${humanizeLabel(regState)}`);
  if (snooze !== null) parts.push(`Snooze: ${snooze}d`);
  parts.push(`${cfgs.length} config${cfgs.length!==1?'s':''}`);
  return parts.join(' · ');
}

// Flatten nested objects for the export (up to a max depth) to present per-field rows
function flattenForReport(obj, prefix = '', depth = 0, maxDepth = 2) {
  const out = [];
  if (!obj || typeof obj !== 'object') return out;
  for (const key of Object.keys(obj)) {
    if (key === 'id') continue;
    const path = prefix ? `${prefix}.${key}` : key;
    const val = obj[key];
    if (val === null || val === undefined) {
      out.push({ key: path, value: '—' });
    } else if (typeof val === 'object' && !Array.isArray(val) && depth < maxDepth) {
      out.push(...flattenForReport(val, path, depth + 1, maxDepth));
    } else if (Array.isArray(val)) {
      // Always serialize arrays as JSON so renderers can expand them
      try {
        out.push({ key: path, value: JSON.stringify(val) });
      } catch (e) {
        out.push({ key: path, value: String(val) });
      }
    } else if (typeof val === 'object') {
      // At max depth, stringify objects to preserve structure instead of "[object Object]"
      try {
        out.push({ key: path, value: JSON.stringify(val) });
      } catch (e) {
        out.push({ key: path, value: String(val) });
      }
    } else {
      out.push({ key: path, value: String(val) });
    }
  }
  return out;
}

// Pretty-print a raw value for display
function fmtValue(val) {
  if (val === null || val === undefined) return '—';
  if (typeof val === 'boolean') return val ? 'Yes' : 'No';
  if (typeof val === 'object') {
    // Admin Consent Request Policy — concise summary
    if (val.notifyReviewers !== undefined || val.remindersEnabled !== undefined || val.requestDurationInDays !== undefined || val.reviewers !== undefined) {
      return summarizeAdminConsentPolicy(val);
    }
    // Authentication Methods Policy
    if (val.registrationEnforcement || Array.isArray(val.authenticationMethodConfigurations) || Array.isArray(val.authenticationMethodsConfigurations)) {
      return summarizeAuthMethodsPolicy(val) || JSON.stringify(val);
    }
    // Settings Catalog / choice setting instance
    const sd = val.settingDefinitionId || (val.settingInstance && val.settingInstance.settingDefinitionId);
    if (sd) {
      const defLabel = humanizeSettingDefinitionId(sd);
      const choiceVal = val.choiceSettingValue?.value || val.settingInstance?.choiceSettingValue?.value || null;
      const choiceLabel = choiceVal ? humanizeChoiceValue(choiceVal) : null;
      return choiceLabel ? `${defLabel} — ${choiceLabel}` : defLabel;
    }
    if (Array.isArray(val)) {
      if (val.length === 0) return '[]';
      if (val.length <= 3) return JSON.stringify(val);
      return `Array[${val.length}]`;
    }
    try { return JSON.stringify(val); } catch { return String(val); }
  }
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

    // Full config — flatten nested fields up to two levels and present scalar values
    const fullConfig = flattenForReport(res, '', 0, 2)
      .map(({ key, value }) => ({ key, value: fmtValue(value === undefined ? null : value) }));

    // EP Security areas: expose settings as raw settingDefinitionId list
    let epSettings = null;
    if (isEpSecurity) {
      epSettings = res.settings.map(s => {
        const defId = s.settingInstance?.settingDefinitionId || '—';
        const inst = s.settingInstance || null;
        let val = '—';
        if (inst) {
          if (inst.choiceSettingValue && inst.choiceSettingValue.value) val = humanizeChoiceValue(inst.choiceSettingValue.value);
          else if (inst.simpleSettingValue) val = fmtValue(inst.simpleSettingValue);
          else val = fmtValue(inst);
        }
        return {
          settingDefinitionId: defId,
          label: humanizeSettingDefinitionId(defId),
          value: val,
        };
      });
    }

    const extra = {};
    if (res.anonymousLinkCount !== undefined) extra.anonymousLinkCount = res.anonymousLinkCount;
    if (res.anonymousLinks !== undefined) extra.anonymousLinks = res.anonymousLinks;
    if (res.externalShareCount !== undefined) extra.externalShareCount = res.externalShareCount;
    if (res.externalShareSamples !== undefined) extra.externalShareSamples = res.externalShareSamples;
    if (res.topExternallyShared !== undefined) extra.topExternallyShared = res.topExternallyShared;
    // Exchange-specific summaries
    if (res.forwardingRules !== undefined) extra.forwardingRules = res.forwardingRules;
    if (res.messageRules !== undefined) extra.messageRules = res.messageRules;
    if (res.mailboxSettings !== undefined) extra.mailboxSettings = res.mailboxSettings;
    if (res.inferenceClassification !== undefined) extra.inferenceClassification = res.inferenceClassification;
    if (res.raw !== undefined) extra.raw = res.raw;

    return Object.assign({
      id,
      displayName: res.displayName || res.name || id,
      mode,
      watchedProps,   // monitored properties with labels
      fullConfig,     // every field in the stored baseline
      epSettings,     // null unless EP Security settings catalog area
    }, extra);
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
