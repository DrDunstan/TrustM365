const fs = require('fs');
const path = require('path');
const parser = require('./parsers/intuneExportParser');
const slugify = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');

function normalizeValue(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (s === '') return '';
  const low = s.toLowerCase();
  if (['enabled','true','on','yes','1'].includes(low)) return 'true';
  if (['disabled','false','off','no','0'].includes(low)) return 'false';
  if (/^-?\d+$/.test(low)) return Number(low);
  return low;
}

function findMatchingSetting(templateSetting, actualSettings) {
  const exact = actualSettings.find(s => (s.name || '').trim().toLowerCase() === (templateSetting.title || '').trim().toLowerCase());
  if (exact) return exact;
  const tslug = slugify(templateSetting.title || '');
  const slugMatch = actualSettings.find(s => slugify(s.name) === tslug);
  if (slugMatch) return slugMatch;
  const contains = actualSettings.find(s => {
    const a = (s.name || '').toLowerCase();
    const t = (templateSetting.title || '').toLowerCase();
    return a && t && (a.includes(t) || t.includes(a));
  });
  if (contains) return contains;
  return null;
}

function compareTemplateWithPolicy(template, policy) {
  const actualSettings = (policy.settings || []).map(s => ({
    name: s.name || s.Name || s.Title || '',
    value: s.value !== undefined ? s.value : (s.Value !== undefined ? s.Value : '')
  }));

  const report = (template.settings || []).map(ts => {
    const match = findMatchingSetting(ts, actualSettings);
    const actual = match ? match.value : null;
    const normActual = normalizeValue(actual);
    const normRecommended = normalizeValue(ts.recommended_value);
    let status = 'missing';
    if (actual !== null) {
      if (normActual === normRecommended) status = 'compliant';
      else status = 'non-compliant';
    }
    return {
      control_id: ts.control_id,
      title: ts.title,
      recommended_value: ts.recommended_value,
      actual_value: actual,
      status,
      mdm_csp: ts.mdm_csp || null,
      registry_key: ts.registry_key || null,
      notes: ts.notes || null
    };
  });

  return report;
}

module.exports = { compareTemplateWithPolicy, normalizeValue };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i];
    const v = argv[i + 1];
    args[k.replace(/^-+/, '')] = v;
  }
  if (!args.template || !args.input) {
    console.error('Usage: node compare.js --template <template.json> --input <actual.json> [--out <report.json>]');
    process.exit(2);
  }
  const template = JSON.parse(fs.readFileSync(args.template, 'utf8'));
  const actual = parser.parseFile(args.input);
  const report = module.exports.compareTemplateWithPolicy(template, actual);
  if (args.out) fs.writeFileSync(args.out, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));
}
