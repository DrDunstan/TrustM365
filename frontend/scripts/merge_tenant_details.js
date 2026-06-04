#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const exportsDir = path.join(root, 'exports');
const failingFile = path.join(exportsDir, 'zerotrust-failing.json');
const tenantArg = process.argv[2] || path.join(exportsDir, 'tenant-details.json');
const tenantFile = path.isAbsolute(tenantArg) ? tenantArg : path.join(root, tenantArg);

if (!fs.existsSync(failingFile)) {
  console.error('Missing failing file:', failingFile);
  process.exit(1);
}
if (!fs.existsSync(tenantFile)) {
  console.error('Missing tenant details file:', tenantFile);
  process.exit(1);
}

const failing = JSON.parse(fs.readFileSync(failingFile, 'utf8'));
const tenants = JSON.parse(fs.readFileSync(tenantFile, 'utf8'));

// Build map from "templateId||refId" -> array of tenant result objects
const map = new Map();
for (const tenant of tenants) {
  const tenantId = tenant.tenantId || tenant.id || tenant.key || null;
  const tenantName = tenant.tenantName || tenant.displayName || tenant.name || tenantId;
  const results = tenant.results || tenant.checks || [];
  for (const r of results) {
    const tplId = r.templateId || r.template || r.refId || null;
    const refId = r.refId || r.templateId || r.ref || tplId;
    if (!tplId || !refId) continue;
    const key = `${tplId}||${refId}`;
    const arr = map.get(key) || [];
    arr.push({
      tenantId,
      tenantName,
      status: r.status || r.result || r.outcome || '',
      matchedSamples: r.matchedSamples || r.samples || []
    });
    map.set(key, arr);
  }
}

const out = failing.map(item => {
  const key = `${item.templateId}||${item.refId}`;
  const tenantsFor = map.get(key) || [];
  return { ...item, tenants: tenantsFor };
});

const outJson = path.join(exportsDir, 'zerotrust-failing-with-tenants.json');
fs.writeFileSync(outJson, JSON.stringify(out, null, 2), 'utf8');

// Build CSV (tenants column contains JSON string)
const csvHeader = ['templateId','templateName','area_key','refId','refDisplayName','matchedCount','partialCount','totalOccurrences','tenants','recommendedResolution','failureSummary'];
const csvLines = out.map(r => {
  const tenantsStr = JSON.stringify(r.tenants || []);
  const fields = [r.templateId, r.templateName, r.area_key, r.refId, r.refDisplayName, r.matchedCount, r.partialCount, r.totalOccurrences, tenantsStr, r.recommendedResolution || '', r.failureSummary || ''];
  return fields.map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(',');
});
const outCsv = path.join(exportsDir, 'zerotrust-failing-with-tenants.csv');
fs.writeFileSync(outCsv, csvHeader.join(',') + '\r\n' + csvLines.join('\r\n'), 'utf8');

console.log('Wrote:', outJson);
console.log('Wrote:', outCsv);
process.exit(0);
