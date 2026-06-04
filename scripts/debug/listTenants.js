#!/usr/bin/env node
const path = require('path');

async function main() {
  try {
    const { initDatabase } = require(path.resolve(__dirname, '../../backend/src/database/init'));
    const db = await initDatabase();
    const tenants = db.prepare("SELECT id, display_name, tenant_id, last_sync_error, last_sync_error_at FROM tenants ORDER BY display_name").all();
    console.log(JSON.stringify(tenants, null, 2));
  } catch (err) {
    console.error('Error reading tenants:', err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

main();
