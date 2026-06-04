#!/usr/bin/env node

(async () => {
  try {
    const path = require('path');
    const init = require(path.resolve(__dirname, '../backend/src/database/init'));
    await init.initDatabase();
    const db = init.getDb();
    const { encrypt } = require(path.resolve(__dirname, '../backend/src/utils/encryption'));
    const { getAllCollectors } = require(path.resolve(__dirname, '../backend/src/collectors'));

    const displayName = process.argv[2];
    const tenantId = process.argv[3];
    const clientId = process.argv[4];
    const clientSecret = process.argv[5];

    if (!displayName || !tenantId || !clientId || !clientSecret) {
      console.error('Usage: node scripts/registerTenantLocal.js <displayName> <tenantId> <clientId> <clientSecret>');
      process.exit(1);
    }

    // Prevent duplicate tenant_id
    const existing = db.prepare('SELECT id FROM tenants WHERE tenant_id = ?').get(tenantId);
    if (existing) {
      console.log(JSON.stringify({ message: 'Tenant already registered', id: existing.id, tenantId }, null, 2));
      process.exit(0);
    }

    const crypto = require('crypto');
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO tenants (id,display_name,tenant_id,client_id,client_secret_encrypted) VALUES (?,?,?,?,?)')
      .run(id, displayName, tenantId, clientId, encrypt(clientSecret));

    // Initialise meta row
    db.prepare('INSERT INTO tenant_meta (tenant_id) VALUES (?)').run(id);

    // Backfill resource areas for all collectors
    const collectors = getAllCollectors();
    const insertArea = db.prepare('INSERT OR IGNORE INTO resource_areas (id,tenant_id,area_key,display_name,description) VALUES (?, ?, ?, ?, ?)');
    for (const c of collectors) {
      insertArea.run(crypto.randomUUID(), id, c.areaKey, c.displayName || c.area_key || c.areaKey, c.description || '');
    }

    // Ensure DB is flushed to disk before exiting
    if (db && typeof db.close === 'function') db.close();
    console.log(JSON.stringify({ id, tenantId, displayName }, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('Failed to register tenant locally:', err && err.message ? err.message : String(err));
    process.exit(2);
  }
})();
