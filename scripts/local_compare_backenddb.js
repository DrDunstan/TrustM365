#!/usr/bin/env node
const path = require('path');
const fs = require('fs').promises;
const { openDatabase } = require('../backend/src/database/sqlite');
const { decrypt } = require('../backend/src/utils/encryption');
const { getAccessToken } = require('../backend/src/services/auth');
const { getCollector } = require('../backend/src/collectors');
const comparator = require('../backend/src/referenceTemplates/comparator');

async function main() {
  const tenantArg = process.argv[2];
  if (!tenantArg) {
    console.error('Usage: node scripts/local_compare_backenddb.js <tenantDbId|tenantId>');
    process.exit(2);
  }

  const dbPath = path.join(__dirname, '..', 'backend', 'data', 'trustm365.db');
  const db = await openDatabase(dbPath);
  const tenant = db.prepare('SELECT * FROM tenants WHERE id = ? OR tenant_id = ?').get(tenantArg, tenantArg);
  if (!tenant) {
    console.error('Tenant not found in backend DB:', tenantArg);
    process.exit(1);
  }

  let clientSecret;
  try {
    clientSecret = decrypt(tenant.client_secret_encrypted);
  } catch (err) {
    console.error('Failed to decrypt client secret:', err && err.message ? err.message : err);
    process.exit(1);
  }

  let token = null;
  try {
    token = await getAccessToken(tenant.tenant_id, tenant.client_id, clientSecret);
  } catch (err) {
    console.warn('Warning: failed to obtain access token:', err && err.message ? err.message : err);
  }

  const tplDir = path.join(__dirname, '..', 'backend', 'data', 'reference-templates', 'open-intune-baseline');
  const files = await fs.readdir(tplDir);
  for (const f of files.filter(f => f.endsWith('.json'))) {
    const tplPath = path.join(tplDir, f);
    const tplRaw = await fs.readFile(tplPath, 'utf8');
    const tpl = JSON.parse(tplRaw);
    console.log('\n===', tpl.id || f, '===');
    const areaKey = tpl.area_key || tpl.areaKey || tpl.area;
    try {
      const collector = getCollector(areaKey);
      if (!collector) {
        console.log('No collector for area', areaKey, ' — skipping');
        continue;
      }
      let live = {};
      if (!token) {
        console.log('No access token — skipping live pull for tenant', tenant.id);
      } else {
        try {
          live = await collector.pull(token);
        } catch (err) {
          console.error('Collector.pull error for', areaKey, err && err.message ? err.message : err);
          continue;
        }
      }

      const items = await comparator.compareTemplateResources(tpl, live || {});
      const total = items.length;
      const matched = items.filter(i => i.status === 'matched').length;
      const noMatch = items.filter(i => i.status === 'noMatch').length;
      const noWatched = items.filter(i => i.status === 'no_watched_keys').length;

      console.log('Summary:', { total, matched, noMatch, noWatched });
      if (items.length > 0) console.log('Sample item:', JSON.stringify(items[0], null, 2));
    } catch (err) {
      console.error('Error processing template', f, err && err.message ? err.message : err);
    }
  }
}

main().catch(e => { console.error(e && e.message ? e.message : e); process.exit(1); });
