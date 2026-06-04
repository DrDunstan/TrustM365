const slugify = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const normalizePolicyType = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function deepClone(obj) {
  try { return JSON.parse(JSON.stringify(obj)); }
  catch (e) {
    const seen = new WeakMap();
    const _clone = v => {
      if (v === null) return null;
      const t = typeof v;
      if (t === 'string' || t === 'number' || t === 'boolean') return v;
      if (Array.isArray(v)) return v.map(_clone);
      if (t === 'object') {
        if (seen.has(v)) return seen.get(v);
        const out = {};
        seen.set(v, out);
        for (const k of Object.keys(v)) out[k] = _clone(v[k]);
        return out;
      }
      return undefined;
    };
    return _clone(obj);
  }
}

function isPrimitiveOrSimpleArray(v) {
  if (v === null) return true;
  const t = typeof v;
  if (t === 'string' || t === 'number' || t === 'boolean') return true;
  if (Array.isArray(v)) return v.every(el => el === null || ['string','number','boolean'].includes(typeof el));
  return false;
}

function setNested(obj, parts, value) {
  let cur = obj;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (i === parts.length - 1) {
      cur[p] = value;
    } else {
      if (!cur[p] || typeof cur[p] !== 'object') cur[p] = {};
      cur = cur[p];
    }
  }
}

function traverseCollect(obj, parts, out) {
  if (isPrimitiveOrSimpleArray(obj)) {
    out.push({ pathParts: parts.slice(), path: parts.join('.'), value: obj });
    return;
  }
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) traverseCollect(obj[i], parts.concat(String(i)), out);
    return;
  }
  if (obj && typeof obj === 'object') {
    for (const k of Object.keys(obj)) traverseCollect(obj[k], parts.concat(k), out);
  }
}

function normalize(template, filePath) {
  if (!template || typeof template !== 'object') return template;
  const tpl = deepClone(template);
  tpl.metadata = tpl.metadata || {};
  if (!tpl.metadata.source && tpl.source) tpl.metadata.source = tpl.source;
  if (!tpl.metadata.owner) tpl.metadata.owner = 'custom';
  if (!tpl.metadata.owner_display) tpl.metadata.owner_display = tpl.metadata.owner;
  if (!tpl.metadata.policy_type_normalized) {
    const rawPolicyType = tpl.policy_type || tpl.policyType || tpl.profile_type || tpl.profileType || tpl.category || '';
    const normalized = normalizePolicyType(rawPolicyType);
    if (normalized) tpl.metadata.policy_type_normalized = normalized;
  }

  if (!tpl.id) {
    const cand = tpl.template_id || tpl.templateId || tpl.display_name || tpl.displayName || tpl.name || '';
    let base = String(cand || '');
    if (!base && filePath) base = filePath.replace(/^.*[\/\\]/, '').replace(/\.json$/i, '');
    tpl.id = slugify(base || 'template');
  }

  if (!tpl.area_key) tpl.area_key = tpl.metadata.area_key || 'generic';

  // Special-case: detect Microsoft Graph deviceCompliancePolicies / windows10CompliancePolicy
  // and map primitive top-level properties as watchable keys under `intune_compliance`.
  try {
    const odataType = tpl['@odata.type'] || tpl['@odata.Type'] || tpl['@odata.TYPE'];
    const odataId = tpl['@odata.id'] || tpl['@odata.Id'] || tpl['@odata.ID'];
    const editLink = tpl['@odata.editLink'] || tpl['@odata.EditLink'];
    const isCompliance = (odataType && String(odataType).toLowerCase().includes('windows10compliancepolicy')) ||
                         (odataId && String(odataId).toLowerCase().includes('devicemanagement/devicecompliancepolicies')) ||
                         (editLink && String(editLink).toLowerCase().includes('devicecompliancepolicies'));
    if (isCompliance) {
      tpl.area_key = 'intune_compliance';
      tpl.resources = tpl.resources || {};
      const resourceKey = tpl.id || (`${slugify(tpl.display_name || tpl.name || 'policy')}:policy`);
      const resObj = { id: resourceKey, displayName: tpl.display_name || tpl.name || tpl.id || resourceKey };
      const reservedTop = new Set([
        'id','metadata','resources','watched_keys','settings','display_name','displayName','name',
        'template_id','templateId','source','description','area_key','label','category'
      ]);
      // Collect primitive top-level properties as resource properties and watched keys
      const keys = Object.keys(tpl).filter(k => !reservedTop.has(k) && !k.startsWith('@'));
      const added = [];
      for (const k of keys) {
        const v = tpl[k];
        if (isPrimitiveOrSimpleArray(v)) {
          resObj[k] = v;
          added.push({ key: k, value: v });
        }
      }
      if (added.length > 0) {
        tpl.resources[resourceKey] = resObj;
        tpl.settings = tpl.settings || [];
        tpl.watched_keys = tpl.watched_keys || [];
        for (const a of added) {
          tpl.settings.push({ control_id: `${tpl.id}:${slugify(a.key)}`, title: a.key, recommended_value: a.value });
          // path should match top-level property name to compare with collector snapshot
          const wkPath = a.key;
          if (!tpl.watched_keys.find(w => ((w && w.path) || w) === wkPath)) tpl.watched_keys.push({ path: wkPath, label: a.key, match: 'equals' });
        }
        return tpl;
      }
    }
  } catch (e) { /* continue with generic handling on error */ }

  const reservedTop = new Set([
    'id','metadata','resources','watched_keys','settings','display_name','displayName','name',
    'template_id','templateId','source','description','area_key','label','category'
  ]);

  tpl.watched_keys = Array.isArray(tpl.watched_keys) ? tpl.watched_keys.slice() : [];
  tpl.settings = Array.isArray(tpl.settings) ? tpl.settings.slice() : [];

  if (!tpl.resources || Object.keys(tpl.resources || {}).length === 0) {
    const collected = [];
    for (const k of Object.keys(tpl)) {
      if (reservedTop.has(k)) continue;
      traverseCollect(tpl[k], [k], collected);
    }
    if (collected.length > 0) {
      const resourceKey = `${tpl.id}:settings`;
      const resSettings = {};
      for (const e of collected) setNested(resSettings, e.pathParts, e.value);
      tpl.resources = {};
      tpl.resources[resourceKey] = {
        id: resourceKey,
        displayName: `${tpl.display_name || tpl.name || tpl.id} settings`,
        settings: resSettings
      };
      if (!Array.isArray(tpl.settings) || tpl.settings.length === 0) {
        tpl.settings = collected.map(e => ({
          control_id: `${tpl.id}:${slugify(e.path)}`,
          title: e.path,
          recommended_value: e.value
        }));
      }
      if (!Array.isArray(tpl.watched_keys) || tpl.watched_keys.length === 0) {
        tpl.watched_keys = collected.map(e => ({ path: `settings.${e.path}`, label: e.path, match: 'equals' }));
      }
    }
    return tpl;
  }

  for (const [rKey, rObj] of Object.entries(tpl.resources || {})) {
    if (!rObj || typeof rObj !== 'object') continue;
    const srcSettings = rObj.settings;
    if (!srcSettings) continue;
    const collected = [];
    traverseCollect(srcSettings, [], collected);
    if (collected.length === 0) continue;
    if (!Array.isArray(tpl.settings) || tpl.settings.length === 0) {
      tpl.settings = tpl.settings || [];
      for (const e of collected) {
        tpl.settings.push({
          control_id: `${tpl.id}:${slugify(e.path)}`,
          title: e.path,
          recommended_value: e.value
        });
      }
    }
    tpl.watched_keys = tpl.watched_keys || [];
    for (const e of collected) {
      const wkPath = `settings.${e.path}`;
      if (!tpl.watched_keys.find(w => ((w && w.path) || w) === wkPath)) {
        tpl.watched_keys.push({ path: wkPath, label: e.path, match: 'equals' });
      }
    }
  }

  return tpl;
}

module.exports = { normalize };
