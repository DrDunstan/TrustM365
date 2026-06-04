const fs = require('fs');
const path = require('path');

const upstreamDir = path.resolve(__dirname, '..', 'backend', 'data', 'reference-templates', 'upstream');
const outDir = path.resolve(__dirname, '..', 'backend', 'data', 'reference-templates', 'open-intune-baseline');
const mappingsDir = path.resolve(__dirname, '..', 'backend', 'tools', 'oib-converter', 'mappings');
const mapperPath = path.resolve(__dirname, '..', 'backend', 'tools', 'oib-converter', 'mappers', 'oibToTrustMapper');
const writerPath = path.resolve(__dirname, '..', 'backend', 'tools', 'oib-converter', 'writer');

function loadMappingHints() {
  const hints = {};
  if (!fs.existsSync(mappingsDir)) return hints;
  for (const f of fs.readdirSync(mappingsDir)) {
    if (!f.endsWith('.json')) continue;
    try { hints[path.basename(f, '.json')] = JSON.parse(fs.readFileSync(path.join(mappingsDir, f), 'utf8')); }
    catch (e) { console.warn('Failed to read mapping', f, e && e.message); }
  }
  return hints;
}

function makePolicyFromRaw(raw, filename) {
  const policy = {
    name: raw.name || raw.displayName || raw.Title || filename.replace('.json', ''),
    description: raw.description || raw.Description || '',
    profileType: raw.profileType || raw.profile_type || 'Settings catalog',
    category: raw.category || raw.Category || '',
    policyType: raw.policyType || raw.policy_type || (raw.templateReference && raw.templateReference.templateDisplayName) || '',
    platformSupported: raw.platforms || raw.platformSupported || '',
    created: raw.createdDateTime || raw.created || '',
    lastModified: raw.lastModifiedDateTime || raw.lastModified || '',
    settings: []
  };

  if (Array.isArray(raw.settings)) {
    for (const s of raw.settings) {
      const inst = s.settingInstance || s.setting || s.Setting || {};
      const title = s.displayName || s.name || (inst && (inst.choiceSettingValue && inst.choiceSettingValue.value)) || s.title || 'unknown';
      let value = '';
      if (inst) {
        value = inst.choiceSettingValue && inst.choiceSettingValue.value ? inst.choiceSettingValue.value : (inst.simpleSettingValue && inst.simpleSettingValue.value !== undefined ? inst.simpleSettingValue.value : '');
      }
      if (!value && s.value) value = s.value;
      policy.settings.push({ name: title, value });
    }
  }

  return policy;
}

(async function main(){
  if (!fs.existsSync(upstreamDir)) { console.error('Upstream dir not found:', upstreamDir); process.exit(1); }
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const mapper = require(mapperPath);
  const writer = require(writerPath);
  const mappingHints = loadMappingHints();

  const files = fs.readdirSync(upstreamDir).filter(f => f.toLowerCase().endsWith('.json'));
  console.log('Converting', files.length, 'upstream files');
  for (const f of files) {
    const p = path.join(upstreamDir, f);
    try {
      const rawText = fs.readFileSync(p, 'utf8');
      const raw = JSON.parse(rawText);
      const policy = makePolicyFromRaw(raw, f);
      const foundKey = Object.keys(mappingHints).find(k => f.toLowerCase().includes(k)) || f;
      const hints = mappingHints[foundKey] || {};
      const mapped = mapper.mapPolicy(policy, hints);
      const outPath = writer.write(mapped, outDir);
      console.log('Wrote:', outPath);
    } catch (e) {
      console.warn('Failed to convert', f, e && e.message);
    }
  }
  console.log('Done');
})();
