#!/usr/bin/env node
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const path = require('path');
const { openDatabase } = require('../src/database/sqlite');
const { getAccessToken } = require('../src/services/auth');

async function main() {
  const tenantExternal = process.argv[2];
  const areaKey = process.argv[3] || 'teams_membership';
  if (!tenantExternal) {
    console.error('Usage: node run_collector_pull.js <tenant_external_id> [areaKey]');
    process.exit(2);
  }

  const DB_PATH = process.env.DATABASE_PATH
    ? path.resolve(process.env.DATABASE_PATH)
    : path.resolve(__dirname, '../../data/trustm365.db');

  const db = await openDatabase(DB_PATH);
  const tenant = db.prepare('SELECT * FROM tenants WHERE tenant_id = ?').get(tenantExternal);
  if (!tenant) { console.error('Tenant not found'); process.exit(1); }

  try {
    const clientSecret = require('../src/utils/encryption').decrypt(tenant.client_secret_encrypted);
    const token = await getAccessToken(tenant.tenant_id, tenant.client_id, clientSecret);
    const collectorsModule = require('../src/collectors');
    const collector = (collectorsModule.getCollector)
      ? collectorsModule.getCollector(areaKey)
      : require(`../src/collectors/${areaKey}.js`);
    console.log('Running collector.pull for', areaKey);
    const res = await collector.pull(token);
    console.log('Result count:', Object.keys(res).length);
    console.dir(Object.keys(res).slice(0,20), { depth: null });

    // Also try simple Graph calls to inspect raw responses for troubleshooting
    try {
      const graph = require('../src/services/graph');
      console.log('\n--- Raw /teams GET ---');
      try { const t = await graph.graphGet(token, '/teams'); console.dir(t, { depth: 2 }); } catch (e) { console.error('teams GET error:', e.message) }
      console.log('\n--- Raw /groups filter for Team ---');
      try { const g = await graph.graphGet(token, "/groups?$filter=resourceProvisioningOptions/Any(x:x eq 'Team')&$select=id,displayName"); console.dir(g, { depth: 2 }); } catch (e) { console.error('groups filter error:', e.message) }
      console.log('\n--- Raw /groups top=10 ---');
      try { const g2 = await graph.graphGet(token, '/groups?$top=10'); console.dir(g2, { depth: 2 }); } catch (e) { console.error('groups top error:', e.message) }
    } catch (e) { console.error('Graph raw check failed', e.message) }
    process.exit(0);
  } catch (err) {
    console.error('Error running collector:', err && err.message ? err.message : err);
    process.exit(3);
  }
}

main();
