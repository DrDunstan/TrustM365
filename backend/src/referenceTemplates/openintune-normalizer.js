const path = require('path');

const slugify = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
const normalizePolicyType = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function inferPolicyTypeNormalized(tpl) {
  const raw = tpl.policy_type || tpl.profile_type || tpl.category || tpl.display_name || tpl.name || '';
  const n = normalizePolicyType(raw);
  if (!n) return '';
  if (n.includes('compliance')) return 'compliance policy';
  if (n.includes('settings catalog') || n.includes('settingscatalog') || n.includes('config profile') || n.includes('configuration profile')) return 'settings catalog';
  if (n.includes('antivirus')) return 'endpoint security antivirus';
  if (n.includes('firewall')) return 'endpoint security firewall';
  if (n.includes('attack surface') || n.includes('asr')) return 'endpoint security asr';
  if (n.includes('disk encryption') || n.includes('bitlocker')) return 'endpoint security disk encryption';
  return n;
}

function inferAreaKey(tpl) {
  const text = (tpl.profile_type || tpl.policy_type || tpl.display_name || tpl.template_id || tpl.name || tpl.category || tpl.description || '').toString().toLowerCase();
  if (text.includes('bitlocker') || text.includes('disk encryption')) return 'intune_ep_disk_encryption';
  if (text.includes('defender') || text.includes('antivirus') || text.includes('mde') || text.includes('endpoint')) return 'intune_ep_antivirus';
  if (text.includes('firewall')) return 'intune_ep_firewall';
  if (text.includes('attack surface') || text.includes('asr') || text.includes('attack-surface')) return 'intune_ep_asr';
  if (text.includes('compliance') || text.includes('device compliance') || text.includes('compliance policy')) return 'intune_compliance';
  return 'intune_config_profiles';
}

function normalize(template, filePath) {
  if (!template || typeof template !== 'object') return template;
  const tpl = Object.assign({}, template);
  tpl.metadata = tpl.metadata || {};

  // Ensure source/owner metadata for OIB
  if (!tpl.metadata.source) tpl.metadata.source = tpl.source || 'OpenIntuneBaseline';
  const src = String(tpl.metadata.source || '').toLowerCase();
  if (!tpl.metadata.owner) {
    if (src.includes('openintune') || src.includes('open-intune') || (tpl.id && String(tpl.id).startsWith('oib:'))) tpl.metadata.owner = 'openintune';
    else tpl.metadata.owner = 'community';
  }
  if (!tpl.metadata.owner_display) tpl.metadata.owner_display = tpl.metadata.owner === 'openintune' ? 'OpenIntuneBaseline' : tpl.metadata.owner;

  // First-class, normalized policy-type metadata for v2 compare filtering.
  const policyTypeNormalized = inferPolicyTypeNormalized(tpl);
  if (policyTypeNormalized) {
    tpl.metadata.policy_type_normalized = policyTypeNormalized;
    if (!tpl.metadata.policy_type) tpl.metadata.policy_type = tpl.policy_type || tpl.profile_type || policyTypeNormalized;
  }

  // Ensure id
  if (!tpl.id) tpl.id = tpl.template_id || tpl.templateId || slugify(tpl.display_name || tpl.name || path.basename(filePath || '', '.json'));

  // Infer area_key when missing
  if (!tpl.area_key) tpl.area_key = tpl.metadata.area_key || inferAreaKey(tpl);

  // If settings exist but watched_keys/resources are absent, synthesize watched keys
  // with heuristics that prefer property-style keys used by collectors (camelCase)
  if ((!Array.isArray(tpl.watched_keys) || tpl.watched_keys.length === 0) && Array.isArray(tpl.settings) && tpl.settings.length > 0) {
    tpl.watched_keys = [];
    const resourceKey = `oib:${tpl.id}:settings`;

    if (!tpl.resources) tpl.resources = {};
    if (!tpl.resources[resourceKey]) {
      tpl.resources[resourceKey] = {
        id: resourceKey,
        displayName: `${tpl.display_name || tpl.name || tpl.id} settings`,
        settings: {}
      };
    }

    // Ensure settings is an object for easier property-style matching
    if (Array.isArray(tpl.resources[resourceKey].settings)) {
      const obj = {};
      for (const s of tpl.resources[resourceKey].settings) {
        const n = s.name || s.title || s.Name || '';
        if (n) obj[n] = s.value;
      }
      tpl.resources[resourceKey].settings = obj;
    } else if (!tpl.resources[resourceKey].settings || typeof tpl.resources[resourceKey].settings !== 'object') {
      tpl.resources[resourceKey].settings = {};
    }

    const resSettings = tpl.resources[resourceKey].settings;

    const splitWords = (txt) => String(txt || '').replace(/[()\[\]\/\\]/g, ' ').replace(/[^a-zA-Z0-9\s]/g, ' ').trim().split(/\s+/).filter(Boolean);
    const camelCaseFromWords = (words) => {
      if (!words || words.length === 0) return '';
      const first = String(words[0] || '').toLowerCase();
      const rest = (words.slice(1) || []).map(w => String(w).charAt(0).toUpperCase() + String(w).slice(1).toLowerCase());
      return first + rest.join('');
    };
    const lowerNoPunct = (txt) => String(txt || '').replace(/[^a-z0-9]/gi, '').toLowerCase();

    const generateCandidates = (label, controlId) => {
      const out = [];
      if (!label && controlId) {
        const last = String(controlId).split(':').pop() || controlId;
        const words = last.split(/[-_\.]/).filter(Boolean);
        const c = camelCaseFromWords(words);
        if (c) out.push(c);
      }
      const words = splitWords(label || controlId || '');
      if (words.length) {
        const cc = camelCaseFromWords(words);
        if (cc) out.push(cc);
        const noP = lowerNoPunct(label);
        if (noP && out.indexOf(noP) === -1) out.push(noP);
        const snake = words.map(w => w.toLowerCase()).join('_');
        if (snake && out.indexOf(snake) === -1) out.push(snake);
        // Heuristic: handle prefixed verbs (e.g. "Block Game Center" -> "gameCenterBlocked")
        const verbs = { block: 'Blocked', blocked: 'Blocked', disable: 'Disabled', disabled: 'Disabled', allow: 'Allowed', allowed: 'Allowed', require: 'Required', required: 'Required', enable: 'Enabled', enabled: 'Enabled' };
        const lw = words.map(w => w.toLowerCase());
        for (let i = 0; i < lw.length; i++) {
          if (verbs[lw[i]]) {
            const base = lw.filter((_, idx) => idx !== i);
            const baseCc = camelCaseFromWords(base);
            if (baseCc) {
              const cand = baseCc + verbs[lw[i]];
              if (out.indexOf(cand) === -1) out.push(cand);
            }
          }
        }
      }
      return out.filter(Boolean).reduce((acc, v) => (acc.indexOf(v) === -1 ? acc.concat(v) : acc), []);
    };

    for (const s of tpl.settings) {
      const label = s.title || s.name || s.Title || '';
      const safeLabel = String(label || '').replace(/\]/g, '').replace(/\[/g, '').trim() || '';
      const controlId = s.control_id || s.controlId || s.id || '';
      const candidates = generateCandidates(safeLabel, controlId);
      const recommended = s.recommended_value !== undefined ? s.recommended_value : (s.recommendedValue !== undefined ? s.recommendedValue : (s.value !== undefined ? s.value : ''));

      // Assign the recommended value to the first candidate property if not already present
      if (candidates.length > 0) {
        const primary = candidates[0];
        if (!(primary in resSettings)) resSettings[primary] = recommended;
        // Add up to three candidate watched keys (property-style)
        for (const cand of candidates.slice(0, 3)) {
          const path = `settings.${cand}`;
          if (!tpl.watched_keys.find(w => w.path === path)) tpl.watched_keys.push({ path, label: safeLabel || cand, match: 'equals' });
        }
      }

      // If the setting provides a settingDefinitionId, add an anchor-style watched key
      const defId = s.settingDefinitionId || s.setting_definition_id || s.settingDefinitionID || s.settingDefinition || s.setting_definition;
      if (defId) {
        const normId = String(defId).trim();
        const anchorPath = `anchor:settingDefinitionId:${normId}`;
        if (!tpl.watched_keys.find(w => ((w && w.path) || w) === anchorPath)) {
          // put anchors first to prefer definition-id based matching
          tpl.watched_keys.unshift({ path: anchorPath, label: `settingDefinition:${normId}`, match: 'equals' });
        }
      }

      // Legacy fallback path still useful when templates include explicit name indexing
      const legacyPath = `settings[name=${safeLabel}].value`;
      if (!tpl.watched_keys.find(w => w.path === legacyPath)) tpl.watched_keys.push({ path: legacyPath, label: safeLabel || 'unknown', match: 'equals' });
    }
  }

  return tpl;
}

module.exports = { normalize };
