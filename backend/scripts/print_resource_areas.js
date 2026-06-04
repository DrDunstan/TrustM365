#!/usr/bin/env node
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const path = require('path');
const { openDatabase } = require('../src/database/sqlite');

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: node print_resource_areas.js <tenant_external_id>');
    process.exit(2);
  }

  const DB_PATH = process.env.DATABASE_PATH
    ? path.resolve(process.env.DATABASE_PATH)
    : path.resolve(__dirname, '../../data/trustm365.db');

  try {
    const db = await openDatabase(DB_PATH);
    const tenant = db.prepare('SELECT id, display_name, tenant_id FROM tenants WHERE tenant_id = ?').get(arg);
    if (!tenant) {
      console.error('Tenant not found for external tenant_id:', arg);
      process.exit(1);
    }
    console.log('Tenant:', tenant.display_name, tenant.id, tenant.tenant_id);
    const areas = db.prepare('SELECT area_key, display_name, has_baseline, auto_restore, last_pulled_at FROM resource_areas WHERE tenant_id = ? ORDER BY area_key').all(tenant.id);
    if (!areas || areas.length === 0) {
      console.log('No resource_areas found for tenant.');
      process.exit(0);
    }
    console.log('Resource areas:');
    for (const a of areas) {
      console.log(` - ${a.area_key} | ${a.display_name} | baseline:${a.has_baseline} auto_restore:${a.auto_restore} pulled:${a.last_pulled_at || 'never'}`);
    }
    process.exit(0);
  } catch (err) {
    console.error('Error:', err && err.message ? err.message : err);
    process.exit(3);
  }
}

main();
