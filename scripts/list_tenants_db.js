const path = require('path');
const { openDatabase } = require('../backend/src/database/sqlite');

async function main() {
  const dbPath = path.join(__dirname, '..', 'backend', 'data', 'trustm365.db');
  try {
    const db = await openDatabase(dbPath);
    const rows = db.prepare('SELECT id, display_name, tenant_id, created_at FROM tenants').all();
    if (!rows || rows.length === 0) {
      console.log('No tenants found in DB');
      return;
    }
    console.log('Tenants:');
    for (const r of rows) {
      console.log(`${r.id} | ${r.display_name} | ${r.tenant_id} | ${r.created_at}`);
    }
  } catch (err) {
    console.error('Failed to read DB:', err && err.message ? err.message : err);
    process.exit(1);
  }
}

main();
