#!/usr/bin/env node
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const path = require('path');
const { openDatabase } = require('../src/database/sqlite');

async function main() {
  const tenantArg = process.argv[2];
  const areaArg = process.argv[3] || 'teams_membership';
  if (!tenantArg) {
    console.error('Usage: node print_live_snapshot.js <tenant_external_id> [area_key]');
    process.exit(2);
  }

  const DB_PATH = process.env.DATABASE_PATH
    ? path.resolve(process.env.DATABASE_PATH)
    : path.resolve(__dirname, '../../data/trustm365.db');

  try {
    const db = await openDatabase(DB_PATH);
    const tenant = db.prepare('SELECT id, display_name, tenant_id FROM tenants WHERE tenant_id = ?').get(tenantArg);
    if (!tenant) {
      console.error('Tenant not found for external tenant_id:', tenantArg);
      process.exit(1);
    }
    console.log('Tenant:', tenant.display_name, tenant.id, tenant.tenant_id);

    const snap = db.prepare('SELECT * FROM live_snapshots WHERE tenant_id = ? AND area_key = ? ORDER BY pulled_at DESC LIMIT 1')
      .get(tenant.id, areaArg);
    if (!snap) {
      console.log('No live snapshot found for area', areaArg);
      process.exit(0);
    }
    console.log('Snapshot pulled at:', snap.pulled_at);
    const resources = JSON.parse(snap.resources || '{}');
    const ids = Object.keys(resources || {});
    console.log('Resource count:', ids.length);
    const sample = ids.slice(0, 20);
    for (const id of sample) {
      const r = resources[id];
      console.log(` - ${id} | ${r.displayName || r.name || '<no displayName>'}`);
    }
    if (ids.length > sample.length) console.log('...and', ids.length - sample.length, 'more');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err && err.message ? err.message : err);
    process.exit(3);
  }
}

main();
