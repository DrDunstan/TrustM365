const express = require('express');
const router = express.Router();

const fs = require('fs');
const path = require('path');
const registry = require('../referenceTemplates/registry');
const comparator = require('../referenceTemplates/comparator');
const { compareTemplateResourcesV2, normalizePolicyType } = require('../referenceTemplates/compare-v2');
const genericNormalizer = require('../referenceTemplates/generic-normalizer');
const openintuneNormalizer = require('../referenceTemplates/openintune-normalizer');
const logger = require('../utils/logger');
const { getDb } = require('../database/init');
const { getAccessToken } = require('../services/auth');
const { resolveTenantAuthContext } = require('../services/tenantAuth');
const { getCollector, LicenceUnavailableError } = require('../collectors');
const { createCompareJob, runCompareJob } = require('../engine/sync');

function isOpenIntuneTemplate(tpl) {
  if (!tpl || typeof tpl !== 'object') return false;
  const meta = tpl.metadata || {};
  const owner = String(meta.owner || '').toLowerCase();
  const source = String(meta.source || '').toLowerCase();
  const id = String(tpl.id || '').toLowerCase();
  return owner === 'openintune' || source.includes('openintune') || source.includes('open-intune') || id.startsWith('oib:');
}

function isImportedTemplate(tpl) {
  if (!tpl || typeof tpl !== 'object') return false;
  const meta = tpl.metadata || {};
  const source = String(meta.source || '').toLowerCase();
  return Boolean(meta.importedAt || meta.originalFileName || source === 'uploaded');
}

function findTemplateFileById(baseDir, templateId) {
  const direct = path.join(baseDir, `${templateId}.json`);
  if (fs.existsSync(direct)) return direct;

  function walk(dir) {
    let out = [];
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      try {
        const stat = fs.statSync(full);
        if (stat.isDirectory()) out = out.concat(walk(full));
        else if (stat.isFile() && full.toLowerCase().endsWith('.json')) out.push(full);
      } catch (e) {
        // ignore unreadable entries
      }
    }
    return out;
  }

  const files = walk(baseDir);
  for (const f of files) {
    try {
      const txt = fs.readFileSync(f, 'utf8');
      const parsed = JSON.parse(txt);
      const entries = Array.isArray(parsed) ? parsed : [parsed];
      if (entries.some(e => e && e.id && String(e.id) === String(templateId))) return f;
    } catch (e) {
      // ignore parse errors
    }
  }
  return null;
}

function slugifyText(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function normalizeSettingDefinitionId(value) {
  return String(value || '').trim().toLowerCase();
}

function getTemplateSettingDefinitionIds(tpl) {
  const settings = Array.isArray(tpl && tpl.settings) ? tpl.settings : [];
  const ids = new Set();
  for (const s of settings) {
    const sid = normalizeSettingDefinitionId(s && (s.settingDefinitionId || s.setting_definition_id || s.settingDefinitionID || s.settingDefinition));
    if (sid) ids.add(sid);
  }
  return ids;
}

function getTemplateWatchedPaths(tpl) {
  const paths = new Set();
  const watched = Array.isArray(tpl && tpl.watched_keys) ? tpl.watched_keys : [];
  for (const wk of watched) {
    const pathValue = typeof wk === 'string' ? wk : wk && wk.path;
    if (pathValue) paths.add(String(pathValue));
  }
  const settings = Array.isArray(tpl && tpl.settings) ? tpl.settings : [];
  for (const s of settings) {
    const pathCandidates = [
      s && s.property_path,
      s && s.path,
      s && s.referencePath,
      s && s.collectorPath,
    ].filter(Boolean);
    for (const p of pathCandidates) paths.add(String(p));
    const sid = normalizeSettingDefinitionId(s && (s.settingDefinitionId || s.setting_definition_id || s.settingDefinitionID || s.settingDefinition));
    if (sid) {
      paths.add(`settings[settingDefinitionId=${sid}].value`);
      paths.add(`anchor:settingDefinitionId:${sid}`);
    }
  }
  return paths;
}

function collectMappingCandidates(tpl) {
  const candidates = [];
  const seen = new Set();
  const watchedPaths = getTemplateWatchedPaths(tpl);
  const settings = Array.isArray(tpl && tpl.settings) ? tpl.settings : [];

  const pushCandidate = (candidate) => {
    if (!candidate || !candidate.sourceType || !candidate.sourceKey) return;
    const dedupe = `${candidate.refId || ''}|${candidate.sourceType}|${candidate.sourceKey}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    candidates.push(candidate);
  };

  for (const [idx, s] of settings.entries()) {
    const sid = normalizeSettingDefinitionId(s && (s.settingDefinitionId || s.setting_definition_id || s.settingDefinitionID || s.settingDefinition));
    const title = String((s && (s.title || s.name || s.control_id)) || '').trim();
    const refId = String((s && (s.control_id || s.settingDefinitionId || s.setting_definition_id || s.name)) || title || `setting-${idx + 1}`);

    if (sid) {
      pushCandidate({ id: `${slugifyText(refId || sid)}-anchor`, refId, required: true, sourceType: 'anchor', sourceKey: `anchor:settingDefinitionId:${sid}`, operator: 'equals' });
      continue;
    }

    const directPath = String((s && (s.property_path || s.path || s.referencePath || s.collectorPath)) || '').trim();
    if (directPath) {
      pushCandidate({ id: `${slugifyText(refId || directPath)}-path`, refId, required: true, sourceType: 'path', sourceKey: directPath, operator: 'equals' });
      continue;
    }

    const titleSlug = slugifyText(title);
    const hintPath = Array.from(watchedPaths).find(p => slugifyText(p).includes(titleSlug));
    if (hintPath) {
      pushCandidate({ id: `${slugifyText(refId || hintPath)}-path`, refId, required: true, sourceType: 'path', sourceKey: hintPath, operator: 'equals' });
    }
  }

  for (const p of watchedPaths) {
    const sourceType = String(p).startsWith('anchor:') ? 'anchor' : 'path';
    pushCandidate({ id: `${slugifyText(p)}-${sourceType}`, refId: p, required: true, sourceType, sourceKey: p, operator: 'equals' });
  }

  return candidates;
}

function scaffoldMappingContract(tpl) {
  const candidates = collectMappingCandidates(tpl);
  const settings = Array.isArray(tpl && tpl.settings) ? tpl.settings : [];
  return {
    version: 1,
    enforcementMode: 'warn',
    requiredMappings: candidates,
    thresholds: {
      minRequiredMappedPct: 100,
      minSettingCount: Math.max(1, settings.length || candidates.length || 1),
    },
  };
}

function normalizeAnchorSourceKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('anchor:settingDefinitionId:')) return raw.toLowerCase();
  return `anchor:settingDefinitionId:${raw.toLowerCase()}`;
}

function validateMappingContract(tpl, options = {}) {
  const errors = [];
  const warnings = [];
  const isCustom = Boolean(options && options.isCustom);
  const meta = (tpl && tpl.metadata && typeof tpl.metadata === 'object') ? tpl.metadata : {};
  const contract = meta.mappingContract;

  if (!isCustom) return { ok: true, errors, warnings, diagnostics: null };
  if (!contract || typeof contract !== 'object') {
    errors.push('metadata.mappingContract is required for custom templates.');
    return { ok: false, errors, warnings, diagnostics: null };
  }

  const requiredMappings = Array.isArray(contract.requiredMappings) ? contract.requiredMappings : [];
  if (requiredMappings.length === 0) {
    errors.push('metadata.mappingContract.requiredMappings must contain at least one mapping entry for custom templates.');
  }

  const allowedAnchors = new Set(Array.from(getTemplateSettingDefinitionIds(tpl)).map(sid => `anchor:settingDefinitionId:${sid}`));
  const allowedPaths = getTemplateWatchedPaths(tpl);
  let unresolvedRequired = 0;

  requiredMappings.forEach((m, idx) => {
    if (!m || typeof m !== 'object') {
      errors.push(`requiredMappings[${idx}] must be an object.`);
      unresolvedRequired += 1;
      return;
    }
    const id = String(m.id || '').trim();
    const refId = String(m.refId || '').trim();
    const sourceType = String(m.sourceType || '').trim().toLowerCase();
    const sourceKeyRaw = String(m.sourceKey || '').trim();
    if (!id) errors.push(`requiredMappings[${idx}].id is required.`);
    if (!refId) errors.push(`requiredMappings[${idx}].refId is required.`);
    if (!['anchor', 'path'].includes(sourceType)) errors.push(`requiredMappings[${idx}].sourceType must be 'anchor' or 'path'.`);
    if (!sourceKeyRaw) errors.push(`requiredMappings[${idx}].sourceKey is required.`);

    if (sourceType === 'anchor' && sourceKeyRaw) {
      const normalized = normalizeAnchorSourceKey(sourceKeyRaw);
      if (!allowedAnchors.has(normalized)) {
        warnings.push(`requiredMappings[${idx}] anchor sourceKey does not match template settingDefinitionId values: ${sourceKeyRaw}`);
        unresolvedRequired += 1;
      }
    }
    if (sourceType === 'path' && sourceKeyRaw) {
      if (!allowedPaths.has(sourceKeyRaw)) {
        warnings.push(`requiredMappings[${idx}] path sourceKey is not present in watched/mapped template paths: ${sourceKeyRaw}`);
        unresolvedRequired += 1;
      }
    }
  });

  const thresholds = (contract.thresholds && typeof contract.thresholds === 'object') ? contract.thresholds : {};
  const minSettingCount = Number(thresholds.minSettingCount || 0);
  const minRequiredMappedPct = Number(thresholds.minRequiredMappedPct || 0);
  if (Number.isNaN(minSettingCount) || minSettingCount < 0) errors.push('metadata.mappingContract.thresholds.minSettingCount must be a non-negative number.');
  if (Number.isNaN(minRequiredMappedPct) || minRequiredMappedPct < 0 || minRequiredMappedPct > 100) errors.push('metadata.mappingContract.thresholds.minRequiredMappedPct must be between 0 and 100.');

  const diagnostics = {
    requiredMappingsTotal: requiredMappings.length,
    requiredMappingsUnresolved: unresolvedRequired,
    settingCountExpected: minSettingCount,
    enforcementMode: String(contract.enforcementMode || 'warn').toLowerCase() === 'strict' ? 'strict' : 'warn',
  };

  return { ok: errors.length === 0, errors, warnings, diagnostics };
}

function flattenResourcePaths(value, prefix = '', out = new Set(), depth = 0) {
  if (depth > 10) return out;
  if (Array.isArray(value)) {
    if (prefix) out.add(prefix);
    for (let i = 0; i < value.length; i += 1) {
      const nextPrefix = prefix ? `${prefix}[${i}]` : `[${i}]`;
      flattenResourcePaths(value[i], nextPrefix, out, depth + 1);
    }
    return out;
  }
  if (value && typeof value === 'object') {
    if (prefix) out.add(prefix);
    const keys = Object.keys(value);
    for (const key of keys) {
      const nextPrefix = prefix ? `${prefix}.${key}` : String(key);
      out.add(nextPrefix);
      flattenResourcePaths(value[key], nextPrefix, out, depth + 1);
    }
    return out;
  }
  if (prefix) out.add(prefix);
  return out;
}

function normalizePathForCompare(value) {
  return String(value || '').toLowerCase().replace(/\[(\d+)\]/g, '[]').replace(/\s+/g, '');
}

function hasSourcePathInResources(sourceKey, pathIndex) {
  const wanted = normalizePathForCompare(sourceKey);
  if (!wanted) return false;
  if (pathIndex.has(wanted)) return true;
  // Fallback: allow compatible suffix/prefix matches for minor path-shape differences.
  for (const candidate of pathIndex) {
    if (candidate.includes(wanted) || wanted.includes(candidate)) return true;
  }
  return false;
}

function estimateSettingCount(resources) {
  const json = JSON.stringify(resources || {});
  const matches = json.match(/settingDefinitionId/gi);
  return Array.isArray(matches) ? matches.length : 0;
}

async function preflightTemplateMapping(tpl, resources) {
  const validation = validateMappingContract(tpl, {
    isCustom: String(((tpl && tpl.metadata) || {}).owner || '').toLowerCase() === 'custom',
  });
  const contract = tpl && tpl.metadata && tpl.metadata.mappingContract && typeof tpl.metadata.mappingContract === 'object'
    ? tpl.metadata.mappingContract
    : null;

  if (!contract) {
    return {
      ok: false,
      canCompare: false,
      validation,
      preflight: {
        requiredMappingsTotal: 0,
        requiredMappingsResolved: 0,
        requiredMappingsUnresolved: 0,
        requiredMappingsResolvedPct: 0,
        unresolvedMappings: [],
        failedChecks: ['missing-mapping-contract'],
      },
      comparePreview: { rows: 0, settingSummary: { totalSettings: 0, matchedSettings: 0, partialSettings: 0, noMatchSettings: 0 } },
    };
  }

  const requiredMappings = Array.isArray(contract.requiredMappings) ? contract.requiredMappings : [];
  const pathSet = flattenResourcePaths(resources || {});
  const normalizedPathSet = new Set(Array.from(pathSet).map(p => normalizePathForCompare(p)));
  const resourcesJson = JSON.stringify(resources || {}).toLowerCase();
  const unresolvedMappings = [];
  let resolved = 0;

  for (const m of requiredMappings) {
    if (!m || typeof m !== 'object') continue;
    const sourceType = String(m.sourceType || '').toLowerCase();
    const sourceKey = String(m.sourceKey || '').trim();
    if (!sourceKey) {
      unresolvedMappings.push({ id: m.id || '', refId: m.refId || '', reason: 'missing-source-key' });
      continue;
    }

    let found = false;
    if (sourceType === 'path') {
      found = hasSourcePathInResources(sourceKey, normalizedPathSet);
    } else if (sourceType === 'anchor') {
      const sid = normalizeAnchorSourceKey(sourceKey).replace('anchor:settingdefinitionid:', '');
      found = sid ? resourcesJson.includes(sid) : false;
    }

    if (found) resolved += 1;
    else unresolvedMappings.push({ id: m.id || '', refId: m.refId || '', sourceType, sourceKey, reason: 'not-found-in-snapshot' });
  }

  const requiredMappingsTotal = requiredMappings.length;
  const requiredMappingsResolved = resolved;
  const requiredMappingsUnresolved = Math.max(0, requiredMappingsTotal - requiredMappingsResolved);
  const requiredMappingsResolvedPct = requiredMappingsTotal > 0 ? Math.round((requiredMappingsResolved / requiredMappingsTotal) * 10000) / 100 : 100;

  const thresholdCfg = (contract.thresholds && typeof contract.thresholds === 'object') ? contract.thresholds : {};
  const minRequiredMappedPct = Number(thresholdCfg.minRequiredMappedPct || 0);
  const minSettingCount = Number(thresholdCfg.minSettingCount || 0);
  const observedSettingCount = estimateSettingCount(resources || {});

  let comparePreviewRows = [];
  try {
    const compared = await comparator.compareTemplateResources(tpl, resources || {});
    comparePreviewRows = Array.isArray(compared) ? compared : [];
  } catch (err) {
    logger.warn({ err, templateId: tpl && tpl.id }, 'Preflight compare preview failed');
    comparePreviewRows = [];
  }
  const settingSummary = summarizeSettingCoverage(comparePreviewRows);

  const failedChecks = [];
  if (requiredMappingsResolvedPct < minRequiredMappedPct) failedChecks.push('min-required-mapped-pct');
  if (observedSettingCount < minSettingCount) failedChecks.push('min-setting-count');

  const strict = String(contract.enforcementMode || 'warn').toLowerCase() === 'strict';
  const contractPass = failedChecks.length === 0;
  const validationPass = validation.ok;
  const ok = validationPass && (contractPass || !strict);

  return {
    ok,
    canCompare: ok,
    validation,
    preflight: {
      requiredMappingsTotal,
      requiredMappingsResolved,
      requiredMappingsUnresolved,
      requiredMappingsResolvedPct,
      unresolvedMappings,
      thresholdChecks: {
        minRequiredMappedPct,
        minSettingCount,
        observedSettingCount,
      },
      failedChecks,
      enforcementMode: strict ? 'strict' : 'warn',
    },
    comparePreview: {
      rows: comparePreviewRows.length,
      settingSummary,
    },
  };
}

function summarizeSettingCoverage(items) {
  const safeItems = Array.isArray(items) ? items : [];
  const totalSettings = safeItems.reduce((sum, it) => sum + Number(it?.settingSummary?.totalSettings || 0), 0);
  const matchedSettings = safeItems.reduce((sum, it) => sum + Number(it?.settingSummary?.matchedSettings || 0), 0);
  const partialSettings = safeItems.reduce((sum, it) => sum + Number(it?.settingSummary?.partialSettings || 0), 0);
  const noMatchSettings = safeItems.reduce((sum, it) => sum + Number(it?.settingSummary?.noMatchSettings || 0), 0);
  return { totalSettings, matchedSettings, partialSettings, noMatchSettings };
}

function summarizeRows(rows) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const totalSettings = safeRows.length;
  const matchedSettings = safeRows.filter(r => r && r.status === 'matched').length;
  const partialSettings = 0;
  const extraSettings = safeRows.filter(r => r && r.status === 'extra').length;
  const noMatchSettings = safeRows.filter(r => r && (r.status === 'noMatch' || r.status === 'partial')).length + extraSettings;
  return { totalSettings, matchedSettings, partialSettings, noMatchSettings, extraSettings };
}

function detectReferenceTemplateScope(tpl) {
  const meta = (tpl && tpl.metadata && typeof tpl.metadata === 'object') ? tpl.metadata : {};
  const owner = String(meta.owner || '').toLowerCase();
  const source = String(meta.source || '').toLowerCase();
  const areaKey = String(tpl?.area_key || tpl?.areaKey || meta.area_key || meta.areaKey || '').toLowerCase();
  const policyType = String(meta.policy_type_normalized || meta.policy_type || tpl?.policy_type || tpl?.profile_type || '').toLowerCase();
  const text = [
    owner,
    source,
    areaKey,
    policyType,
    tpl?.id,
    tpl?.name,
    tpl?.display_name,
  ].filter(Boolean).join(' ').toLowerCase();

  const isZeroTrust = owner === 'zerotrust' || text.includes('zero trust') || text.includes('zerotrust');
  const intuneHints = [
    'intune',
    'openintune',
    'endpoint security',
    'settings catalog',
    'configuration profile',
    'compliance policy',
    'devicemanagementconfigurationpolicy',
    'deviceconfiguration',
    'attack surface reduction',
    'asr',
  ];
  const isIntuneLike = intuneHints.some(h => text.includes(h));

  return {
    isZeroTrust,
    isIntuneLike,
    shouldReconcile: isIntuneLike && !isZeroTrust,
  };
}

function normalizeAsrToken(value) {
  if (value === undefined || value === null) return null;

  const numericMap = {
    0: 'disabled',
    1: 'block',
    2: 'audit',
    3: 'warn',
    6: 'warn',
  };

  if (typeof value === 'number' && Number.isFinite(value)) {
    return numericMap[value] || String(value);
  }

  const raw = String(value).trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();

  if (lower.includes('block')) return 'block';
  if (lower.includes('audit')) return 'audit';
  if (lower.includes('warn')) return 'warn';
  if (lower.includes('disable') || lower === 'off' || lower === '0') return 'disabled';

  if (/^-?\d+$/.test(lower)) {
    const n = Number(lower);
    return numericMap[n] || String(n);
  }

  const suffix = lower.match(/(-?\d+)$/);
  if (suffix) {
    const n = Number(suffix[1]);
    return numericMap[n] || String(n);
  }

  return null;
}

const MACHINE_TOKEN_SUFFIX_RE = /_([a-z0-9]+)$/i;

const DEFENDER_ENUM_BY_SETTING_ID = {
  device_vendor_msft_policy_config_defender_cloudblocklevel: ['notconfigured', 'block', 'allow', 'audit'],
  device_vendor_msft_policy_config_defender_puaprotection: ['enabled', 'disabled', 'audit'],
};

function normalizeNotConfiguredToken(value) {
  if (value === undefined || value === null) return null;
  const lower = String(value).trim().toLowerCase();
  if (!lower) return null;
  if (['notconfigured', 'not configured', 'not_configured', 'n/a', 'na'].includes(lower)) return 'notconfigured';
  return null;
}

function extractMachineSuffixToken(value) {
  if (value === undefined || value === null) return null;
  const lower = String(value).trim().toLowerCase();
  if (!lower) return null;
  const suffix = lower.match(MACHINE_TOKEN_SUFFIX_RE);
  if (!suffix) return null;
  const token = suffix[1];
  return {
    token,
    numeric: /^-?\d+$/.test(token) ? Number(token) : null,
    raw: lower,
  };
}

function getRowSettingDefinitionId(row) {
  const joined = [row?.logicalKey, row?.label, row?.referencePath, row?.collectorPath]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const match = joined.match(/device_vendor_msft_policy_config_[a-z0-9_]+/);
  if (!match) return null;
  return match[0].replace(/_[0-9]+$/, '');
}

function normalizeByAllowedEnum(token, enumValues) {
  if (!Array.isArray(enumValues) || enumValues.length === 0) return null;
  if (token === undefined || token === null) return null;

  const raw = String(token).trim().toLowerCase();
  if (!raw) return null;

  if (/^-?\d+$/.test(raw)) {
    const idx = Number(raw);
    if (idx >= 0 && idx < enumValues.length) return String(enumValues[idx]).toLowerCase();
    if (idx - 1 >= 0 && idx - 1 < enumValues.length) return String(enumValues[idx - 1]).toLowerCase();
  }

  const normalizedRaw = raw.replace(/[^a-z0-9]+/g, '');
  const direct = enumValues.find(v => String(v).toLowerCase().replace(/[^a-z0-9]+/g, '') === normalizedRaw);
  return direct ? String(direct).toLowerCase() : null;
}

function normalizeMachineToken(value, row, mode) {
  const notConfigured = normalizeNotConfiguredToken(value);
  if (notConfigured) return notConfigured;

  const suffix = extractMachineSuffixToken(value);
  if (!suffix) return null;

  const rowSettingDefinitionId = getRowSettingDefinitionId(row);
  const bySettingId = rowSettingDefinitionId ? DEFENDER_ENUM_BY_SETTING_ID[rowSettingDefinitionId] : null;
  const bySettingIdNorm = normalizeByAllowedEnum(suffix.token, bySettingId);
  if (bySettingIdNorm) return bySettingIdNorm;

  const lowerJoined = [row?.logicalKey, row?.label, row?.referencePath, row?.collectorPath].filter(Boolean).join(' ').toLowerCase();
  if (lowerJoined.includes('cloudblocklevel')) {
    const cloudBlockNorm = normalizeByAllowedEnum(suffix.token, DEFENDER_ENUM_BY_SETTING_ID.device_vendor_msft_policy_config_defender_cloudblocklevel);
    if (cloudBlockNorm) return cloudBlockNorm;
  }

  if (mode === 'asr') {
    const asr = normalizeAsrToken(suffix.numeric !== null ? suffix.numeric : suffix.token);
    if (asr !== null) return asr;
  }

  if (mode === 'binary') {
    const bin = normalizeBinaryToken(suffix.numeric !== null ? suffix.numeric : suffix.token);
    if (bin !== null) return bin;
  }

  if (suffix.token === 'notconfigured') return 'notconfigured';
  return null;
}

function normalizeBinaryToken(value) {
  if (value === undefined || value === null) return null;
  const notConfigured = normalizeNotConfiguredToken(value);
  if (notConfigured) return notConfigured;
  if (typeof value === 'boolean') return value ? 'enabled' : 'disabled';
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value === 1) return 'enabled';
    if (value === 0) return 'disabled';
    return String(value);
  }

  const raw = String(value).trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();

  if (['true', 'yes', 'on', 'enabled', 'enable', '1', 'allow', 'allowed'].includes(lower)) return 'enabled';
  if (['false', 'no', 'off', 'disabled', 'disable', '0', 'deny', 'denied'].includes(lower)) return 'disabled';

  return null;
}

function normalizeGenericToken(value) {
  if (value === undefined || value === null) return null;
  const notConfigured = normalizeNotConfiguredToken(value);
  if (notConfigured) return notConfigured;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) return value.map(v => normalizeGenericToken(v) || '').join('|');
  const raw = String(value).trim();
  return raw ? raw.toLowerCase() : null;
}

function resolveRowMode(row, tpl) {
  const rowText = [
    tpl?.metadata?.policy_type_normalized,
    tpl?.metadata?.policy_type,
    tpl?.policy_type,
    tpl?.profile_type,
    row?.logicalKey,
    row?.label,
    row?.referencePath,
    row?.collectorPath,
  ].filter(Boolean).join(' ').toLowerCase();

  const expected = row && row.expected;
  const actual = row && row.actual;
  const valueHints = ['0', '1', '2', '3', '6'];
  const hasAsrValueHint = valueHints.includes(String(expected)) || valueHints.includes(String(actual));

  if (rowText.includes('asr') || rowText.includes('attack surface reduction') || hasAsrValueHint) return 'asr';
  if (normalizeBinaryToken(expected) !== null || normalizeBinaryToken(actual) !== null) return 'binary';
  return 'generic';
}

function reconcileIntuneRows(rows, tpl, scope) {
  if (!scope.shouldReconcile || !Array.isArray(rows)) return Array.isArray(rows) ? rows : [];

  return rows.map(row => {
    if (!row || typeof row !== 'object') return row;
    const mode = resolveRowMode(row, tpl);
    const normalizer = mode === 'asr' ? normalizeAsrToken : (mode === 'binary' ? normalizeBinaryToken : normalizeGenericToken);
    const expectedNorm = normalizeMachineToken(row.expected, row, mode) ?? normalizer(row.expected);
    const actualNorm = normalizeMachineToken(row.actual, row, mode) ?? normalizer(row.actual);

    const out = {
      ...row,
      expected: expectedNorm !== null ? expectedNorm : row.expected,
      actual: actualNorm !== null ? actualNorm : row.actual,
    };

    if (out.status !== 'extra' && expectedNorm !== null && actualNorm !== null && expectedNorm === actualNorm) {
      out.status = 'matched';
    } else if (out.status !== 'extra') {
      out.status = 'noMatch';
    }

    const hasActual = out.actual !== undefined && out.actual !== null;
    if (out.status === 'matched') out.comparisonReason = 'match';
    else if (out.status === 'noMatch') out.comparisonReason = hasActual ? 'valueMismatch' : 'missingSetting';
    else if (out.status === 'extra') out.comparisonReason = 'extraInCollector';

    return out;
  });
}

function deriveItemStatusFromSummary(settingSummary, fallbackStatus) {
  const s = settingSummary || {};
  const total = Number(s.totalSettings || 0);
  const matched = Number(s.matchedSettings || 0);
  const partial = 0;
  const noMatch = Number(s.noMatchSettings || 0);
  if (total <= 0) return fallbackStatus;
  if (matched === total && noMatch === 0) return 'matched';
  return 'noMatch';
}

function applyReferencePolicyReconciliation(items, tpl) {
  if (!Array.isArray(items)) return [];
  const scope = detectReferenceTemplateScope(tpl);
  if (!scope.shouldReconcile) return items;

  return items.map(item => {
    const byPolicy = (item && item.settingMappingsByPolicy && typeof item.settingMappingsByPolicy === 'object')
      ? item.settingMappingsByPolicy
      : null;

    let reconciledByPolicy = byPolicy;
    const policySummaries = {};

    if (byPolicy) {
      reconciledByPolicy = {};
      for (const [policyId, rows] of Object.entries(byPolicy)) {
        const reconciledRows = reconcileIntuneRows(rows, tpl, scope);
        reconciledByPolicy[policyId] = reconciledRows;
        policySummaries[policyId] = summarizeRows(reconciledRows);
      }
    }

    const defaultPolicyId = item && item.defaultPolicyId ? item.defaultPolicyId : null;
    const reconciledMappings = (defaultPolicyId && reconciledByPolicy && Array.isArray(reconciledByPolicy[defaultPolicyId]))
      ? reconciledByPolicy[defaultPolicyId]
      : reconcileIntuneRows(item && item.settingMappings ? item.settingMappings : [], tpl, scope);

    const reconciledSummary = summarizeRows(reconciledMappings);
    const counterpartPolicies = Array.isArray(item && item.counterpartPolicies)
      ? item.counterpartPolicies.map(cp => ({
          ...cp,
          summary: policySummaries[cp.id] || cp.summary,
        }))
      : [];

    return {
      ...item,
      settingMappingsByPolicy: reconciledByPolicy,
      settingMappings: reconciledMappings,
      settingSummary: reconciledSummary,
      counterpartPolicies,
      status: deriveItemStatusFromSummary(reconciledSummary, item && item.status),
    };
  });
}

// Reload templates from disk and return the filtered listing
router.post('/reload', (req, res) => {
  try {
    const list = registry.reload();
    return res.json(list);
  } catch (err) {
    logger.error({ err }, 'Failed to reload reference templates');
    return res.status(500).json({ error: 'Failed to reload templates', message: err && err.message });
  }
});

// List templates (supports optional owner filter via ?owner=)
router.get('/', (req, res) => {
  const owner = req.query && req.query.owner ? req.query.owner : undefined;
  const forSecurity = req.query && String(req.query.forSecurity) === 'true';
  const policyType = req.query && req.query.policyType ? String(req.query.policyType) : '';
  try {
    // Default: return lightweight listing
    let list = registry.listTemplates(owner ? { owner } : {});

    // When requested for the Security UI, return full template objects
    // (includes `resources` and `settings`) so the frontend can render
    // flattened control-level cards without extra fetches.
    if (forSecurity) {
      // Convert lightweight entries into full templates
      list = (list || []).map(l => registry.getTemplate(l.id)).filter(Boolean);
      // Ensure a `name` property exists (frontend expects `name` when filtering)
      list = list.map(t => ({ ...t, name: t.name || t.display_name || t.displayName || t.template_id || t.templateId || t.id }));
      // Only include Zero Trust templates with category Identity/Devices
      list = list.filter(t => {
        const meta = t.metadata || {};
        const tplOwner = String(meta.owner || '').toLowerCase();
        const category = String((meta.category || '')).toLowerCase();
        return tplOwner === 'zerotrust' && (category === 'identity' || category === 'devices');
      });
    }

    // Optional policy-type filter for ReferenceTemplates domain.
    // Non-breaking: only applied when explicitly requested.
    if (policyType) {
      const wanted = normalizePolicyType(policyType);
      list = (list || []).filter(t => {
        const meta = t && t.metadata ? t.metadata : {};
        const candidate = normalizePolicyType(
          meta.policy_type_normalized ||
          meta.policy_type ||
          t.policy_type ||
          t.profile_type ||
          ''
        );
        return candidate && (candidate.includes(wanted) || wanted.includes(candidate));
      });
    }

    return res.json(list);
  } catch (err) {
    logger.error({ err }, 'Failed to list reference templates');
    res.status(500).json({ error: 'Failed to list templates' });
  }
});

// Import JSON as global reference templates (accepts single template object or array).
// Behavior: always overwrite the previous template file by id.
router.post('/import', (req, res) => {
  try {
    const requestedTenantId = (req.query && req.query.tenantId) ? String(req.query.tenantId) : (req.body && req.body.tenantId ? String(req.body.tenantId) : undefined);
    if (requestedTenantId) {
      return res.status(400).json({ error: 'Import target is global only. tenantId is not supported for this endpoint.' });
    }
    const payload = req.body;
    if (!payload) return res.status(400).json({ error: 'No JSON body provided' });

    const entries = Array.isArray(payload) ? payload : [payload];
    const slugify = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
    const saved = [];

    // Global (disk) import
    const outDir = path.resolve(__dirname, '../../data/reference-templates');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    for (let t of entries) {
      if (!t || typeof t !== 'object') continue;

      t.metadata = t.metadata || {};
      if (!t.metadata.source) t.metadata.source = t.source || 'Uploaded';
      // Default imported templates to 'custom' owner unless specified
      if (!t.metadata.owner) t.metadata.owner = 'custom';
      if (!t.metadata.owner_display) t.metadata.owner_display = t.metadata.owner === 'openintune' ? 'OpenIntuneBaseline' : (t.metadata.owner_display || 'Custom');
      if (!t.id) t.id = t.template_id || t.templateId || slugify(t.display_name || t.name || (`import-${Date.now()}`));
      t.metadata.scope = 'global';

      const filename = `${t.id}.json`;
      const filePath = path.join(outDir, filename);

      // Format: allow explicit format query (generic|openintune|auto)
      const format = (req.query && req.query.format) ? String(req.query.format).toLowerCase() : (t.metadata && t.metadata.format ? String(t.metadata.format).toLowerCase() : undefined);
      const src = String((t.metadata && t.metadata.source) || t.source || '').toLowerCase();
      try {
        if ((format === 'openintune') || src.includes('openintune') || (t.id && String(t.id).startsWith('oib:'))) {
          if (openintuneNormalizer && typeof openintuneNormalizer.normalize === 'function') {
            const normalized = openintuneNormalizer.normalize(t, filePath);
            if (normalized) t = normalized;
          }
        } else if (format === 'generic') {
          if (genericNormalizer && typeof genericNormalizer.normalize === 'function') {
            const normalized = genericNormalizer.normalize(t, filePath);
            if (normalized) t = normalized;
          }
        } else {
          // Best-effort fallback: try generic normalizer to synthesize structure
          try { if (genericNormalizer && typeof genericNormalizer.normalize === 'function') { const normalized = genericNormalizer.normalize(t, filePath); if (normalized) t = normalized; } } catch (e) { /* ignore */ }
        }
      } catch (e) {
        logger.warn({ err: e, templateId: t.id }, 'Normalizer failed during import');
      }

      // record import provenance
      t.metadata.importedAt = t.metadata.importedAt || new Date().toISOString();
      t.metadata.originalFileName = t.metadata.originalFileName || filename;

      const templateOwner = String((t.metadata && t.metadata.owner) || '').toLowerCase();
      const isCustomTemplate = templateOwner === 'custom';

      if (isCustomTemplate && (!t.metadata.mappingContract || typeof t.metadata.mappingContract !== 'object')) {
        t.metadata.mappingContract = scaffoldMappingContract(t);
      }

      // Basic validation: require resources or settings or watched_keys to be present
      const hasResources = t.resources && Object.keys(t.resources).length > 0;
      const hasSettings = Array.isArray(t.settings) && t.settings.length > 0;
      const hasWatched = Array.isArray(t.watched_keys) && t.watched_keys.length > 0;
      if (!hasResources && !hasSettings && !hasWatched) {
        saved.push({ file: filename, error: 'Template contains no resources, settings, or watched_keys' });
        continue;
      }

      const mappingValidation = validateMappingContract(t, { isCustom: isCustomTemplate });
      if (!mappingValidation.ok) {
        saved.push({
          file: filename,
          id: t.id,
          error: 'Template mapping validation failed',
          mappingErrors: mappingValidation.errors,
          mappingWarnings: mappingValidation.warnings,
          mappingDiagnostics: mappingValidation.diagnostics,
        });
        continue;
      }

      fs.writeFileSync(filePath, JSON.stringify(t, null, 2), 'utf8');
      saved.push({
        file: filename,
        id: t.id,
        skipped: false,
        mappingWarnings: mappingValidation.warnings,
        mappingDiagnostics: mappingValidation.diagnostics,
      });
    }

    // Reload registry so new imports are immediately available
    try { registry.reload(); } catch (e) { logger.warn({ err: e }, 'Registry reload failed after import'); }

    return res.json({ imported: saved });
  } catch (err) {
    logger.error({ err }, 'Import failed');
    return res.status(500).json({ error: 'Import failed', message: err && err.message });
  }
});

// Delete an imported global template by id.
// OIB/OpenIntune templates are protected and cannot be deleted.
router.delete('/:id', (req, res) => {
  try {
    const tpl = registry.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ error: 'Template not found' });

    if (isOpenIntuneTemplate(tpl)) {
      return res.status(403).json({ error: 'OpenIntune/OIB templates are read-only and cannot be deleted' });
    }
    if (!isImportedTemplate(tpl)) {
      return res.status(403).json({ error: 'Only imported templates can be deleted' });
    }

    const outDir = path.resolve(__dirname, '../../data/reference-templates');
    const filePath = findTemplateFileById(outDir, req.params.id);
    if (!filePath) return res.status(404).json({ error: 'Template file not found' });

    const txt = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(txt);

    if (Array.isArray(parsed)) {
      const next = parsed.filter(e => !(e && e.id && String(e.id) === String(req.params.id)));
      if (next.length === parsed.length) return res.status(404).json({ error: 'Template id not present in file' });
      if (next.length === 0) fs.unlinkSync(filePath);
      else fs.writeFileSync(filePath, JSON.stringify(next, null, 2), 'utf8');
    } else {
      if (!parsed || !parsed.id || String(parsed.id) !== String(req.params.id)) {
        return res.status(404).json({ error: 'Template id not present in file' });
      }
      fs.unlinkSync(filePath);
    }

    try { registry.reload(); } catch (e) { logger.warn({ err: e }, 'Registry reload failed after template delete'); }
    return res.json({ deleted: true, id: req.params.id });
  } catch (err) {
    logger.error({ err }, 'Failed to delete imported template');
    return res.status(500).json({ error: 'Failed to delete template', message: err && err.message });
  }
});

// List template owners
router.get('/owners', (req, res) => {
  try {
    let owners = registry.listOwners();
    // For Security Templates UI, only expose the Zero Trust owner
    if (req.query && String(req.query.forSecurity) === 'true') {
      owners = owners.filter(o => String(o.key).toLowerCase() === 'zerotrust')
    }
    return res.json(owners);
  } catch (err) {
    logger.error({ err }, 'Failed to list template owners');
    return res.status(500).json({ error: 'Failed to list owners' });
  }
});

// Aggregated owner summary for a single tenant
router.get('/summary', async (req, res) => {
  const owner = req.query && req.query.owner ? req.query.owner : undefined;
  const tenantId = req.query && req.query.tenantId ? req.query.tenantId : undefined;
  try {
    const list = registry.listTemplates(owner ? { owner } : {});
    // When owner filter omitted, registry.listTemplates returns all known templates
    const templates = Array.isArray(list) ? list : [];

    let token;
    if (tenantId) {
      const db = getDb();
      const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
      if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
      try {
        const authCtx = resolveTenantAuthContext(tenant.id);
        token = await getAccessToken(authCtx.authorityTenantId, authCtx.clientId, authCtx.clientSecret);
      } catch (err) {
        logger.warn({ err, tenantId }, 'Failed to acquire access token for tenant');
        // proceed without token; collectors may fail and we'll return notes per-template
        token = null;
      }
    }

    // Group templates by area_key so we only pull each collector once
    const byArea = new Map();
    for (const tpl of templates) {
      const area = tpl.area_key || 'unknown';
      if (!byArea.has(area)) byArea.set(area, []);
      byArea.get(area).push(tpl);
    }

    const totals = { total: 0, passing: 0, partial: 0, failing: 0 };
    const outTemplates = [];

    for (const [areaKey, tplArr] of byArea.entries()) {
      // attempt to pull live resources for this area
      let liveResources = {};
      let areaNote = null;
      if (tenantId) {
        try {
          const collector = getCollector(areaKey);
          liveResources = await collector.pull(token);
        } catch (err) {
          areaNote = err && err.message ? err.message : 'Collector unavailable';
          logger.warn({ err, areaKey, tenantId }, 'Collector pull failed for summary');
          liveResources = {};
        }
      }

      for (const tpl of tplArr) {
        try {
          const items = await comparator.compareTemplateResources(tpl, liveResources) || [];
          // For frontend convenience, expose partial-match samples under `matchedSamples`
          // so UI can reuse existing sample rendering logic for partial results.
          for (const it of items) {
            if (it && it.status === 'partial' && Array.isArray(it.matchAny)) {
              // Prefer samples that include matchedPaths for richer context, fallback to any
              const seen = new Set();
              const preferred = [];
              const fallback = [];
              for (const m of it.matchAny) {
                const key = (m && (m.displayName || m.id)) || JSON.stringify(m || '')
                if (seen.has(key)) continue
                seen.add(key)
                if (Array.isArray(m.matchedPaths) && m.matchedPaths.length > 0) preferred.push(m)
                else fallback.push(m)
                if (preferred.length >= 3) break
              }
              const chosen = preferred.length > 0 ? preferred.slice(0, 3) : fallback.slice(0, 3)
              if (!it.matchedSamples) it.matchedSamples = chosen
              if (!it.presentInPolicies) it.presentInPolicies = it.matchAny.map(m => m.displayName || m.id)
              it.matchAnyCount = it.matchAny.length
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
          outTemplates.push({ templateId: tpl.id, name: tpl.name || tpl.display_name || tpl.id, area_key: tpl.area_key, note: areaNote || tpl.note || '', summary: { total: tTotal, passing: tPassing, partial: tPartial, failing: tFailing }, settingSummary, items });
        } catch (err) {
          logger.warn({ err, tpl }, 'Comparator failed for template during summary');
          outTemplates.push({ templateId: tpl.id, name: tpl.name || tpl.display_name || tpl.id, area_key: tpl.area_key, note: err && err.message ? err.message : 'Comparator error', summary: { total: 0, passing: 0, partial: 0, failing: 0 }, settingSummary: { totalSettings: 0, matchedSettings: 0, partialSettings: 0, noMatchSettings: 0 }, items: [] });
        }
      }
    }

    return res.json({ summary: totals, templates: outTemplates });
  } catch (err) {
    logger.error({ err }, 'Failed to compute owner summary');
    return res.status(500).json({ error: 'Failed to compute owner summary', message: err && err.message });
  }
});

// List tenant-scoped reference templates (persisted per-tenant)
router.get('/tenant/:tenantId', (req, res) => {
  try {
    const tenantId = req.params.tenantId;
    const db = getDb();
    const rows = db.prepare('SELECT template_id, template_json, uploaded_by, metadata, created_at FROM tenant_reference_templates WHERE tenant_id = ?').all(tenantId);
    const out = (rows || []).map(r => {
      let tpl = null;
      try { tpl = JSON.parse(r.template_json); } catch (e) { tpl = null; }
      return {
        id: tpl && tpl.id ? tpl.id : r.template_id,
        name: tpl && (tpl.name || tpl.display_name) || r.template_id,
        metadata: tpl && tpl.metadata ? tpl.metadata : (r.metadata ? JSON.parse(r.metadata) : {}),
        uploaded_by: r.uploaded_by || '',
        created_at: r.created_at
      };
    });
    return res.json(out);
  } catch (err) {
    logger.error({ err }, 'Failed to list tenant reference templates');
    return res.status(500).json({ error: 'Failed to list tenant templates', message: err && err.message });
  }
});

// Get a tenant-scoped reference template by id
router.get('/tenant/:tenantId/:id', (req, res) => {
  try {
    const db = getDb();
    const row = db.prepare('SELECT template_json FROM tenant_reference_templates WHERE tenant_id = ? AND template_id = ?').get(req.params.tenantId, req.params.id);
    if (!row) return res.status(404).json({ error: 'Template not found' });
    const tpl = JSON.parse(row.template_json);
    return res.json(tpl);
  } catch (err) {
    logger.error({ err }, 'Failed to get tenant reference template');
    return res.status(500).json({ error: 'Failed to get template', message: err && err.message });
  }
});

// Patch template metadata (supports tenant-scoped templates via ?tenantId=)
router.patch('/:id/metadata', (req, res) => {
  try {
    const tenantId = (req.query && req.query.tenantId) ? String(req.query.tenantId) : (req.body && req.body.tenantId ? String(req.body.tenantId) : undefined);
    const metadataPatch = req.body && req.body.metadata ? req.body.metadata : undefined;
    if (!metadataPatch || typeof metadataPatch !== 'object') return res.status(400).json({ error: 'metadata object required in request body' });

    // Basic server-side validation for family_id when present
    if (Object.prototype.hasOwnProperty.call(metadataPatch, 'family_id')) {
      const fid = metadataPatch.family_id == null ? '' : String(metadataPatch.family_id);
      const ok = /^[A-Za-z0-9_\-:.]{1,128}$/.test(fid) || fid === '';
      if (!ok) return res.status(400).json({ error: 'Invalid family_id format. Allowed: letters, numbers, _, -, :, . (max 128 chars)' });
    }

    // Tenant-scoped update: update the DB row
    if (tenantId) {
      const db = getDb();
      const row = db.prepare('SELECT template_json FROM tenant_reference_templates WHERE tenant_id = ? AND template_id = ?').get(tenantId, req.params.id);
      if (!row) return res.status(404).json({ error: 'Template not found' });
      let tpl = null;
      try { tpl = JSON.parse(row.template_json); } catch (e) { return res.status(500).json({ error: 'Failed to parse stored template JSON' }); }
      tpl.metadata = tpl.metadata || {};
      tpl.metadata = { ...tpl.metadata, ...metadataPatch };
      const updatedJson = JSON.stringify(tpl);
      const updatedMeta = JSON.stringify(tpl.metadata || {});
      try {
        db.prepare('UPDATE tenant_reference_templates SET template_json = ?, metadata = ?, updated_at = datetime(\'now\') WHERE tenant_id = ? AND template_id = ?').run(updatedJson, updatedMeta, tenantId, req.params.id);
      } catch (e) {
        logger.warn({ err: e, tenantId, templateId: req.params.id }, 'Failed to update tenant template metadata');
        return res.status(500).json({ error: 'Failed to update tenant template metadata' });
      }
      return res.json({ id: req.params.id, tenantId, metadata: tpl.metadata });
    }

    // Global (disk) update: find file by id (try direct filename then scan files)
    const outDir = path.resolve(__dirname, '../../data/reference-templates');
    const candidate = path.join(outDir, `${req.params.id}.json`);
    let filePath = null;
    if (fs.existsSync(candidate)) filePath = candidate;
    else {
      // Scan files for one that contains a matching id
      function walk(dir) {
        let out = [];
        for (const entry of fs.readdirSync(dir)) {
          const full = path.join(dir, entry);
          try {
            const stat = fs.statSync(full);
            if (stat.isDirectory()) out = out.concat(walk(full));
            else if (stat.isFile() && full.toLowerCase().endsWith('.json')) out.push(full);
          } catch (e) { /* ignore */ }
        }
        return out;
      }
      const files = walk(outDir);
      for (const f of files) {
        try {
          const txt = fs.readFileSync(f, 'utf8');
          const parsed = JSON.parse(txt);
          const entries = Array.isArray(parsed) ? parsed : [parsed];
          for (const e of entries) {
            if (e && e.id && String(e.id) === String(req.params.id)) { filePath = f; break; }
          }
          if (filePath) break;
        } catch (e) { /* ignore parse errors */ }
      }
    }

    if (!filePath) return res.status(404).json({ error: 'Template not found' });

    // Read file, update matching entry, write back
    let fileTxt = null;
    try { fileTxt = fs.readFileSync(filePath, 'utf8'); } catch (e) { return res.status(500).json({ error: 'Failed to read template file' }); }
    let parsed = null;
    try { parsed = JSON.parse(fileTxt); } catch (e) { return res.status(500).json({ error: 'Failed to parse template file' }); }
    const entries = Array.isArray(parsed) ? parsed : [parsed];
    let changed = false;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (e && e.id && String(e.id) === String(req.params.id)) {
        e.metadata = e.metadata || {};
        Object.assign(e.metadata, metadataPatch);
        entries[i] = e;
        changed = true;
        break;
      }
    }
    if (!changed) return res.status(404).json({ error: 'Template id not present in file' });
    const outJson = entries.length === 1 ? JSON.stringify(entries[0], null, 2) : JSON.stringify(entries, null, 2);
    try { fs.writeFileSync(filePath, outJson, 'utf8'); } catch (e) { logger.warn({ err: e, file: filePath }, 'Failed to write template file'); return res.status(500).json({ error: 'Failed to write template file' }); }

    try { registry.reload(); } catch (e) { logger.warn({ err: e }, 'Registry reload failed after metadata patch'); }
    // Return updated template object from registry
    const updated = registry.getTemplate(req.params.id) || null;
    return res.json({ id: req.params.id, metadata: (updated && updated.metadata) || {} });
  } catch (err) {
    logger.error({ err }, 'Failed to patch template metadata');
    return res.status(500).json({ error: 'Failed to patch metadata', message: err && err.message });
  }
});

// Get a single template by id
router.get('/:id', (req, res) => {
  const tpl = registry.getTemplate(req.params.id);
  if (!tpl) return res.status(404).json({ error: 'Template not found' });
  res.json(tpl);
});

// Preflight mapping validation for custom templates before compare.
router.post('/:id/preflight-mapping', async (req, res) => {
  try {
    let { currentResources, tenantId } = req.body || {};
    let tpl = null;

    if (tenantId) {
      try {
        const db = getDb();
        const row = db.prepare('SELECT template_json FROM tenant_reference_templates WHERE tenant_id = ? AND template_id = ?').get(tenantId, req.params.id);
        if (row && row.template_json) tpl = JSON.parse(row.template_json);
      } catch (err) {
        logger.warn({ err, tenantId, templateId: req.params.id }, 'Failed loading tenant template for preflight');
      }
    }

    if (!tpl) tpl = registry.getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ error: 'Template not found' });

    if (!currentResources && tenantId) {
      try {
        const db = getDb();
        const areaKey = tpl.area_key || tpl.areaKey || 'unknown';
        const snap = db.prepare('SELECT resources FROM live_snapshots WHERE tenant_id = ? AND area_key = ? ORDER BY pulled_at DESC LIMIT 1').get(tenantId, areaKey);
        if (snap && snap.resources) currentResources = JSON.parse(snap.resources);
      } catch (err) {
        logger.warn({ err, tenantId, templateId: req.params.id }, 'Failed loading snapshot for preflight');
      }
    }

    const resources = (currentResources && typeof currentResources === 'object') ? currentResources : {};
    const result = await preflightTemplateMapping(tpl, resources);

    return res.json({
      templateId: tpl.id,
      tenantId: tenantId || null,
      templateOwner: String(((tpl.metadata || {}).owner || '')).toLowerCase(),
      hasSnapshot: Object.keys(resources).length > 0,
      ...result,
    });
  } catch (err) {
    logger.error({ err, templateId: req.params.id }, 'Preflight mapping failed');
    return res.status(500).json({ error: 'Preflight mapping failed', message: err && err.message });
  }
});

// List template owners
router.get('/owners', (req, res) => {
  try {
    let owners = registry.listOwners();
    if (req.query && String(req.query.forSecurity) === 'true') {
      owners = owners.filter(o => String(o.key).toLowerCase() === 'zerotrust')
    }
    return res.json(owners);
  } catch (err) {
    logger.error({ err }, 'Failed to list template owners');
    return res.status(500).json({ error: 'Failed to list owners' });
  }
});

// Aggregated owner summary for a single tenant
// (moved above)

// Compare template against provided resources (currentResources) using comparator
router.post('/:id/compare', async (req, res) => {
  try {
    let { currentResources, tenantId } = req.body || {};
    const policyType = (req.body && req.body.policyType) ? String(req.body.policyType) : (req.query && req.query.policyType ? String(req.query.policyType) : '');
    const strictPolicyType = policyType ? !((req.body && req.body.strictPolicyType === false) || (req.query && String(req.query.strictPolicyType).toLowerCase() === 'false')) : false;
    const defaultV2 = String(process.env.REFERENCE_COMPARE_V2_DEFAULT || '').toLowerCase() === 'true';
    const requestV2 = (req.body && req.body.useV2 === true) || (req.query && String(req.query.v2).toLowerCase() === 'true');
    const useV2 = defaultV2 || requestV2;
    let tpl = null;

    // If tenantId provided, attempt to load tenant-scoped template from DB first
    if (tenantId) {
      try {
        const db = getDb();
        const row = db.prepare('SELECT template_json FROM tenant_reference_templates WHERE tenant_id = ? AND template_id = ?').get(tenantId, req.params.id);
        if (row && row.template_json) {
          try { tpl = JSON.parse(row.template_json); } catch (e) { tpl = null; }
        }
      } catch (e) {
        logger.warn({ err: e, tenantId }, 'Failed to load tenant-scoped template during compare');
      }
    }

    // Fallback to global registry
    if (!tpl) {
      tpl = registry.getTemplate(req.params.id);
    }
    if (!tpl) return res.status(404).json({ error: 'Template not found' });

    // If tenantId provided, prefer using the tenant's latest saved live snapshot
    // unless the client explicitly requests a fresh `scan: true`. If a fresh
    // pull is requested we will attempt a collector.pull(token) but fall back
    // to the latest DB snapshot when available to avoid cross-tenant leakage.
    if (tenantId) {
      const db = getDb();
      const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
      if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

      const doScan = req.body && req.body.scan === true;

      // Helper: load latest snapshot from DB (may be undefined)
      const loadSnapshot = () => {
        try {
          const areaKey = tpl.area_key || tpl.areaKey || 'unknown';
          const snap = db.prepare('SELECT resources FROM live_snapshots WHERE tenant_id = ? AND area_key = ? ORDER BY pulled_at DESC LIMIT 1').get(tenantId, areaKey);
          if (snap && snap.resources) return JSON.parse(snap.resources || '{}');
        } catch (e) { /* ignore parse errors */ }
        return {};
      };

      if (!doScan) {
        // Prefer snapshot for deterministic, tenant-scoped compares
        currentResources = loadSnapshot();
        // If no snapshot available, attempt a live pull as a best-effort
        if (!currentResources || Object.keys(currentResources).length === 0) {
          let token = null;
          try {
            const authCtx = resolveTenantAuthContext(tenant.id);
            token = await getAccessToken(authCtx.authorityTenantId, authCtx.clientId, authCtx.clientSecret);
          } catch (err) {
            logger.warn({ err, tenantId }, 'Failed to acquire access token for tenant during compare (fallback pull)');
            token = null;
          }
          if (token) {
            try {
              const areaKey = tpl.area_key || tpl.areaKey || 'unknown';
              const collector = getCollector(areaKey);
              currentResources = await collector.pull(token);
            } catch (err) {
              logger.warn({ err, tenantId }, 'Collector pull failed during compare (fallback pull)');
              currentResources = {};
            }
          }
        }
      } else {
        // Explicit scan requested: try fresh pull first, but fall back to snapshot
        let token = null;
        try {
          const authCtx = resolveTenantAuthContext(tenant.id);
          token = await getAccessToken(authCtx.authorityTenantId, authCtx.clientId, authCtx.clientSecret);
        } catch (err) {
          logger.warn({ err, tenantId }, 'Failed to acquire access token for tenant during compare (scan)');
          token = null; // proceed to fallback
        }

        if (token) {
          try {
            const areaKey = tpl.area_key || tpl.areaKey || 'unknown';
            const collector = getCollector(areaKey);
            currentResources = await collector.pull(token);
          } catch (err) {
            logger.warn({ err, tenantId }, 'Collector pull failed during compare (scan); falling back to latest snapshot');
            currentResources = loadSnapshot();
          }
        } else {
          currentResources = loadSnapshot();
        }
      }
    }

    if (!currentResources || typeof currentResources !== 'object') return res.status(400).json({ error: 'currentResources required' });

    let items = [];
    let compareMeta = null;
    if (useV2) {
      const v2 = await compareTemplateResourcesV2(tpl, currentResources, {
        policyType,
        strictPolicyType,
        fallbackToLegacy: !strictPolicyType,
      });
      items = v2.items || [];
      compareMeta = v2.compareMeta || null;
      // Keep V2 status selection while exposing setting-level coverage fields
      // used by the details drawer and policy selector.
      try {
        const legacyItems = await comparator.compareTemplateResources(tpl, currentResources) || [];
        const legacyByRef = new Map((legacyItems || []).map(it => [it && it.refId, it]));
        items = (items || []).map(it => {
          const legacy = legacyByRef.get(it && it.refId) || {};
          const v2SettingMappings = Array.isArray(it && it.settingMappings) ? it.settingMappings : [];
          const v2Policies = Array.isArray(it && it.counterpartPolicies) ? it.counterpartPolicies : [];
          const v2ByPolicy = (it && it.settingMappingsByPolicy && typeof it.settingMappingsByPolicy === 'object') ? it.settingMappingsByPolicy : null;
          const v2Summary = (it && it.settingSummary && Number(it.settingSummary.totalSettings || 0) > 0) ? it.settingSummary : null;
          return {
            ...it,
            settingMappings: v2SettingMappings.length > 0 ? v2SettingMappings : (legacy.settingMappings || []),
            settingSummary: v2Summary || legacy.settingSummary,
            counterpartPolicies: v2Policies.length > 0 ? v2Policies : (legacy.counterpartPolicies || []),
            settingMappingsByPolicy: (v2ByPolicy && Object.keys(v2ByPolicy).length > 0) ? v2ByPolicy : legacy.settingMappingsByPolicy,
            defaultPolicyId: (it && it.defaultPolicyId) || legacy.defaultPolicyId,
          };
        });
      } catch (enrichErr) {
        logger.warn({ err: enrichErr, templateId: tpl && tpl.id }, 'Failed to enrich V2 compare with setting coverage');
      }
    } else {
      items = await comparator.compareTemplateResources(tpl, currentResources) || [];
    }

    items = applyReferencePolicyReconciliation(items, tpl);

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
    return res.json({ templateId: tpl.id, items, summary, settingSummary, compareMeta });
  } catch (err) {
    logger.error({ err }, 'Compare failed');
    return res.status(500).json({ error: 'Compare failed', message: err && err.message });
  }
});

  // Compare a template across multiple tenants (synchronous, limited)
  router.post('/:id/compare-multi', async (req, res) => {
    try {
      const tpl = registry.getTemplate(req.params.id);
      if (!tpl) return res.status(404).json({ error: 'Template not found' });

      const tenantIds = Array.isArray(req.body && req.body.tenantIds) ? req.body.tenantIds : [];
      if (!tenantIds || tenantIds.length === 0) return res.status(400).json({ error: 'tenantIds required' });

      const MAX = 5;
      const toCheck = tenantIds.slice(0, MAX);
      const results = [];
      const db = getDb();

      for (const tid of toCheck) {
        try {
          const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tid);
          if (!tenant) {
            results.push({ tenantId: tid, error: 'Tenant not found' });
            continue;
          }
          let token = null;
          try {
            const authCtx = resolveTenantAuthContext(tenant.id);
            token = await getAccessToken(authCtx.authorityTenantId, authCtx.clientId, authCtx.clientSecret);
          } catch (err) {
            results.push({ tenantId: tid, error: 'Failed to acquire token', message: err && err.message });
            continue;
          }

          const areaKey = tpl.area_key || tpl.areaKey || 'unknown';
          let liveResources = {};
          try {
            const collector = getCollector(areaKey);
            liveResources = await collector.pull(token);
          } catch (err) {
            results.push({ tenantId: tid, error: 'Collector pull failed', message: err && err.message });
            continue;
          }

          try {
            const items = await comparator.compareTemplateResources(tpl, liveResources) || [];
            const total = items.length;
            const matched = items.filter(i => i.status === 'matched').length;
            const partial = items.filter(i => i.status === 'partial').length;
            const noMatch = Math.max(0, total - matched - partial);
            const settingSummary = summarizeSettingCoverage(items);
            results.push({ tenantId: tid, summary: { total, matched, partial, noMatch }, settingSummary, items });
          } catch (err) {
            results.push({ tenantId: tid, error: 'Comparator failed', message: err && err.message });
          }
        } catch (err) {
          results.push({ tenantId: tid, error: 'Unexpected error', message: err && err.message });
        }
      }

      return res.json({ templateId: tpl.id, checked: toCheck.length, results });
    } catch (err) {
      logger.error({ err }, 'Compare-multi failed');
      return res.status(500).json({ error: 'Compare-multi failed', message: err && err.message });
    }
  });

    // Async job-based compare across many tenants. Returns a jobId to poll via /api/jobs/:id
    router.post('/:id/compare-multi-async', async (req, res) => {
      try {
        const tpl = registry.getTemplate(req.params.id);
        if (!tpl) return res.status(404).json({ error: 'Template not found' });

        const tenantIds = Array.isArray(req.body && req.body.tenantIds) ? req.body.tenantIds : [];
        if (!tenantIds || tenantIds.length === 0) return res.status(400).json({ error: 'tenantIds required' });

        // Hard limit to protect memory — async jobs can handle more than the sync path,
        // but cap to a reasonable maximum per request. Administrators can split requests.
        const MAX_ASYNC = 200;
        const toCheck = tenantIds.slice(0, MAX_ASYNC);

        const jobId = createCompareJob(tpl, toCheck);
        // Run in background
        runCompareJob(jobId).catch(err => logger.error({ err, jobId }, 'Async compare job failed'));

        return res.status(202).json({ jobId, message: `Compare job queued. Poll /api/jobs/${jobId}` });
      } catch (err) {
        logger.error({ err }, 'Async compare multi failed');
        return res.status(500).json({ error: 'Async compare multi failed', message: err && err.message });
      }
    });

module.exports = router;
