const slugify = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');

function camelize(s) {
  return String(s || '')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((w, i) => i === 0 ? w.toLowerCase() : (w.charAt(0).toUpperCase() + w.slice(1)))
    .join('');
}

function inferType(value) {
  if (typeof value === 'boolean') return 'boolean';
  const v = String(value).trim().toLowerCase();
  if (v === 'enabled' || v === 'disabled' || v === 'true' || v === 'false' || v === 'on' || v === 'off') return 'boolean';
  if (/^\d+$/.test(v)) return 'int';
  if (['audit','warn','block','allow','allowed','deny','not configured','not-configured','not configured'].includes(v)) return 'enum';
  return 'string';
}

module.exports.mapPolicy = function(policy, mappingHints) {
  const templateId = slugify(policy.name || mappingHints.display_name || 'oib-template');
  const sourceUrl = mappingHints && mappingHints.source_url ? mappingHints.source_url : 'https://github.com/SkipToTheEndpoint/OpenIntuneBaseline';
  const versionMatch = (policy.name || '').match(/v\d+(?:\.\d+)?/i);
  const template = {
    source: 'OpenIntuneBaseline',
    source_url: sourceUrl,
    template_id: templateId,
    display_name: policy.name || mappingHints.display_name || templateId,
    description: policy.description || mappingHints.description || '',
    os: 'Windows',
    profile_type: policy.profileType || 'Settings catalog',
    policy_type: mappingHints && mappingHints.policyType ? mappingHints.policyType : policy.policyType || '',
    category: mappingHints && mappingHints.category ? mappingHints.category : policy.category || '',
    scope: mappingHints && mappingHints.scope ? mappingHints.scope : 'Device',
    version: (versionMatch && versionMatch[0]) || mappingHints.version || 'v0.0',
    created: policy.created || new Date().toISOString(),
    last_modified: policy.lastModified || new Date().toISOString(),
    license: 'GPL-3.0',
    required_licenses: mappingHints && mappingHints.required_licenses ? mappingHints.required_licenses : [],
    settings: []
  };
  // Allow mappingHints to provide area_key, otherwise infer from template text
  function inferAreaKey(t) {
    const text = (t.profile_type || t.policy_type || t.display_name || t.category || '').toString().toLowerCase();
    if (text.includes('bitlocker') || text.includes('disk encryption')) return 'intune_ep_disk_encryption';
    if (text.includes('defender') || text.includes('antivirus') || text.includes('mde') || text.includes('endpoint')) return 'intune_ep_antivirus';
    if (text.includes('firewall')) return 'intune_ep_firewall';
    if (text.includes('attack surface') || text.includes('asr') || text.includes('attack-surface')) return 'intune_ep_asr';
    if (text.includes('compliance') || text.includes('device compliance') || text.includes('compliance policy')) return 'intune_compliance';
    return 'intune_config_profiles';
  }
  const settingsMap = mappingHints && mappingHints.settingsMap ? mappingHints.settingsMap : {};
  const anyPropStyle = Object.values(settingsMap || {}).some(h => h && h.property_path && /^settings\.[a-zA-Z0-9_]+/.test(h.property_path));
  function n(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g,''); }

  // Build resources and watched_keys from mapping hints when property_path is provided
  const resources = {};
  const watchedKeys = [];
  const resourceKey = `oib:${templateId}:settings`;

  (policy.settings || []).forEach(s => {
    const name = s.name || s.Name || s.Title || 'unknown';
    const value = s.value !== undefined ? s.value : (s.Value !== undefined ? s.Value : '');
    // Exact match first, then try normalized substring match against settingsMap keys
    let hint = settingsMap[name] || {};
    if ((!hint || Object.keys(hint).length === 0) && name) {
      const nn = n(name);
      const keys = Object.keys(settingsMap || {});
      for (const k of keys) {
        const nk = n(k);
        if (!nk) continue;
        if (nn.includes(nk) || nk.includes(nn)) { hint = settingsMap[k]; break; }
      }
    }
    const type = hint.type || inferType(value);
    // Normalize recommended value for boolean-like hints (e.g. "Enabled"/"Allowed" -> true)
    let recommendedValue = value;
    try {
      if ((hint.type === 'boolean' || type === 'boolean') && typeof value === 'string') {
        const vv = String(value).trim().toLowerCase();
        if (['enabled', 'allowed', 'true', 'on', 'yes'].includes(vv)) recommendedValue = true;
        else if (['disabled', 'blocked', 'false', 'off', 'no'].includes(vv)) recommendedValue = false;
      }
    } catch (e) { /* ignore coercion errors */ }

    const setting = {
      control_id: `oib:${templateId}:${slugify(name)}`,
      title: name,
      recommended_value: recommendedValue,
      type: type,
      notes: hint.notes || null,
      oib_reference: sourceUrl + '#' + encodeURIComponent(slugify(policy.name || templateId))
    };
    if (hint.mdm_csp) setting.mdm_csp = hint.mdm_csp;
    if (hint.registry_key) setting.registry_key = hint.registry_key;
    if (hint.allowed_values) setting.allowed_values = hint.allowed_values;
    template.settings.push(setting);

    // If mapping includes a property_path, include it in resources and watched_keys so server-side comparator can evaluate
    if (hint.property_path || hint.setting_definition_id) {
      if (!resources[resourceKey]) {
        // Decide whether to store settings as an object (property-style) or an array (name/value pairs)
        const usePropStyle = anyPropStyle || /^settings\.[a-zA-Z0-9_]+/.test(hint.property_path);
        resources[resourceKey] = { id: resourceKey, displayName: `${template.display_name} settings`, settings: (usePropStyle ? {} : []) };
      } else {
        // If we previously created an array-style settings but now need prop-style, convert existing array entries
        const needPropStyle = /^settings\.[a-zA-Z0-9_]+/.test(hint.property_path);
        if (needPropStyle && Array.isArray(resources[resourceKey].settings)) {
          const arr = resources[resourceKey].settings;
          const obj = {};
          for (const el of arr) {
            if (el && (el.name || el.title)) {
              const key = el.name || el.title;
              obj[key] = el.value !== undefined ? el.value : (el.val || el.setting);
              if (el.mdm_csp) obj[`${key}_mdm_csp`] = el.mdm_csp;
              if (el.registry_key) obj[`${key}_registry_key`] = el.registry_key;
            }
          }
          resources[resourceKey].settings = obj;
        }
      }

      // If property-style path (settings.<prop>), write into object for direct path lookup
      const propMatch = hint.property_path ? hint.property_path.match(/^settings\.([^\.\[]+)/) : null;
      if (propMatch) {
        const propName = propMatch[1];
        if (!resources[resourceKey].settings || Array.isArray(resources[resourceKey].settings)) resources[resourceKey].settings = {};
        resources[resourceKey].settings[propName] = recommendedValue;
        if (hint.mdm_csp) resources[resourceKey].settings[`${propName}_mdm_csp`] = hint.mdm_csp;
        if (hint.registry_key) resources[resourceKey].settings[`${propName}_registry_key`] = hint.registry_key;
        // also emit settingDefinitionId array fallback when provided
        if (hint.setting_definition_id) {
          if (!resources[resourceKey].settings_array) resources[resourceKey].settings_array = [];
          resources[resourceKey].settings_array.push({ settingDefinitionId: hint.setting_definition_id, name: name, value: recommendedValue, mdm_csp: hint.mdm_csp || undefined, registry_key: hint.registry_key || undefined });
          const idPath = `settings[settingDefinitionId=${hint.setting_definition_id}].value`;
          if (!watchedKeys.find(wk => wk.path === idPath)) watchedKeys.push({ path: idPath, label: name, match: hint.match || 'equals' });
        }
      } else {
          if (Array.isArray(resources[resourceKey].settings)) {
            resources[resourceKey].settings.push({ name: name, value: recommendedValue, mdm_csp: hint.mdm_csp || undefined, registry_key: hint.registry_key || undefined });
          } else {
            resources[resourceKey].settings[name] = recommendedValue;
            if (hint.mdm_csp) resources[resourceKey].settings[`${name}_mdm_csp`] = hint.mdm_csp;
            if (hint.registry_key) resources[resourceKey].settings[`${name}_registry_key`] = hint.registry_key;
          }

          // When a mapping provides a known settingDefinitionId, also emit an array-style
          // fallback so bracket selectors like `settings[settingDefinitionId=...]` resolve
          // against the template's resources during comparison.
          if (hint.setting_definition_id) {
            // ensure an array copy exists alongside property-style settings
            if (!resources[resourceKey].settings_array) resources[resourceKey].settings_array = [];
            resources[resourceKey].settings_array.push({
              settingDefinitionId: hint.setting_definition_id,
              name: name,
              value: recommendedValue,
              mdm_csp: hint.mdm_csp || undefined,
              registry_key: hint.registry_key || undefined
            });
            const idPath = `settings[settingDefinitionId=${hint.setting_definition_id}].value`;
            if (!watchedKeys.find(wk => wk.path === idPath)) watchedKeys.push({ path: idPath, label: name, match: hint.match || 'equals' });
          }

          // Add a camelCase fallback property-style setting and watched_key for
          // array-style hints (e.g. settings[name=...].value). This increases the
          // chance of matching live resources that expose flat property names
          // (settings.someProperty) instead of name/value arrays.
          try {
            const camel = camelize(name);
            if (Array.isArray(resources[resourceKey].settings)) {
              // Convert existing array to object map for property fallback
              const arr = resources[resourceKey].settings;
              const obj = {};
              for (const el of arr) {
                if (el && (el.name || el.title)) {
                  const key = el.name || el.title;
                  obj[key] = el.value !== undefined ? el.value : (el.val || el.setting);
                  if (el.mdm_csp) obj[`${key}_mdm_csp`] = el.mdm_csp;
                  if (el.registry_key) obj[`${key}_registry_key`] = el.registry_key;
                }
              }
              resources[resourceKey].settings = obj;
            }
            // Write the camelCase fallback property
            if (!resources[resourceKey].settings) resources[resourceKey].settings = {};
            resources[resourceKey].settings[camel] = recommendedValue;
            if (hint.mdm_csp) resources[resourceKey].settings[`${camel}_mdm_csp`] = hint.mdm_csp;
            if (hint.registry_key) resources[resourceKey].settings[`${camel}_registry_key`] = hint.registry_key;

            const fallbackPath = `settings.${camel}`;
            if (!watchedKeys.find(wk => wk.path === fallbackPath)) watchedKeys.push({ path: fallbackPath, label: name, match: hint.match || 'equals' });
          } catch (e) { /* non-fatal */ }
      }

      const pathEntry = { path: hint.property_path, label: name, match: hint.match || 'equals' };
      if (!watchedKeys.find(wk => (wk.path === pathEntry.path))) watchedKeys.push(pathEntry);
    }
  });

  if (Object.keys(resources).length > 0) template.resources = resources;
  if (watchedKeys.length > 0) template.watched_keys = watchedKeys;

  // Populate area_key from mappingHints or inferred heuristics so downstream tooling can pick collectors
  if (mappingHints && mappingHints.area_key) template.area_key = mappingHints.area_key;
  else template.area_key = inferAreaKey(template);

  // Ensure metadata indicates OpenIntune origin
  template.metadata = template.metadata || {};
  if (!template.metadata.source) template.metadata.source = template.source || 'OpenIntuneBaseline';
  if (!template.metadata.owner) template.metadata.owner = mappingHints && mappingHints.owner ? mappingHints.owner : 'openintune';
  if (!template.metadata.owner_display) template.metadata.owner_display = mappingHints && mappingHints.owner_display ? mappingHints.owner_display : 'OpenIntuneBaseline';

  // Provide an `id` field for registry compatibility
  template.id = template.template_id;

  return template;
};
