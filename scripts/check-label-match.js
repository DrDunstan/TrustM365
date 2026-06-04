const fs = require('fs');
const path = require('path');

const samplePath = path.resolve(__dirname, '..', 'docs', 'samples', 'collector-defender-av-sample.json');
const tplPath = path.resolve(__dirname, '..', 'backend', 'data', 'reference-templates', 'open-intune-baseline', 'win-oib-es-defender-antivirus-d-av-configuration-v3-3.json');

const sample = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
const tpl = JSON.parse(fs.readFileSync(tplPath, 'utf8'));

const lres = sample['device1'];
console.log('Live resource settings elements:');
(lres.settings || []).forEach((el, i) => {
  console.log(i, JSON.stringify(el));
});

console.log('\nTemplate watched property-style paths and label cores:');
(tpl.watched_keys || []).forEach(wk => {
  const pathStr = wk.path || wk;
  if (typeof pathStr === 'string' && pathStr.startsWith('settings.') && !pathStr.includes('[')) {
    const label = wk.label || (pathStr && String(pathStr).split('.').slice(-1)[0]) || null;
    const labelCore = String(label).toLowerCase().replace(/_[0-9]+$/,'').replace(/[^a-z0-9]+/g,'');
    console.log('path:', pathStr, 'label:', label, 'labelCore:', labelCore);
    (lres.settings || []).forEach((el) => {
      const cand = String(el.name || el.settingDefinitionId || el.title || el.Name || el.settingDefinition || el.settingDefinitionID || '').toLowerCase().replace(/[^a-z0-9]+/g,'');
      console.log('  cand:', cand, 'includes labelCore?', cand.includes(labelCore));
    });
  }
});

// Also evaluate normalized values for relevant watched keys
function normalizeForCompareLocal(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  if (s === '') return '';
  const low = s.toLowerCase();
  const sufMatch = low.match(/_([^_]+)$/);
  const token = sufMatch ? sufMatch[1].replace(/[^a-z0-9]+/g,'') : low.replace(/[^a-z0-9]+/g,'');
  const map = { 'true': true, 'false': false, 'enabled': true, 'disabled': false, 'on': true, 'off': false, 'allowed': 'allow', 'allow': 'allow', 'block': 'block', 'blocked': 'block', 'audit': 'audit', 'auditmode': 'audit', 'warn': 'warn' };
  if (/^[0-9]+$/.test(token)) return Number(token);
  if (map[token] !== undefined) return map[token];
  if (['notconfigured','not_configured','not configured','na','n/a','notapplicable','not-applicable'].includes(low)) return null;
  return low.replace(/[^a-z0-9]+/g,'');
}

console.log('\nNormalized comparisons:');
(tpl.watched_keys || []).forEach(wk => {
  const pathStr = wk.path || wk;
  if (typeof pathStr === 'string' && pathStr.startsWith('settings.') && !pathStr.includes('[')) {
    const label = wk.label || (pathStr && String(pathStr).split('.').slice(-1)[0]) || null;
    const labelCore = String(label).toLowerCase().replace(/_[0-9]+$/,'').replace(/[^a-z0-9]+/g,'');
    // find ref resource that contains this watched key
    let refVal = undefined;
    for (const rk of Object.keys(tpl.resources || {})) {
      const r = tpl.resources[rk];
      // attempt to get property value
      if (r && r.settings && typeof r.settings === 'object' && r.settings[pathStr.split('.').slice(1).join('.')]) {
        refVal = r.settings[pathStr.split('.').slice(1).join('.')];
        break;
      }
    }
    // find live candidate by label core
    const found = (lres.settings || []).find(el => {
      const cand = String(el.name || el.settingDefinitionId || el.title || el.Name || el.settingDefinition || el.settingDefinitionID || '').toLowerCase().replace(/[^a-z0-9]+/g,'');
      return cand && cand.includes(labelCore);
    });
    const liveVal = found ? (found.value !== undefined ? found.value : (found.settingInstance && found.settingInstance.value !== undefined ? found.settingInstance.value : undefined)) : undefined;
    console.log(pathStr, 'refVal=', refVal, 'liveVal=', liveVal, 'normRef=', normalizeForCompareLocal(refVal), 'normLive=', normalizeForCompareLocal(liveVal));
  }
});
