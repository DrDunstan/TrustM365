#!/usr/bin/env node
const path = require('path');
const { openDatabase } = require('./../backend/src/database/sqlite');

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: node scripts/copy_tenant_db.js <tenantId|tenant_db_id>');
    process.exit(2);
  }

  const srcDbPath = path.join(__dirname, '..', 'backend', 'data', 'trustm365.db');
  const dstDbPath = path.join(__dirname, '..', 'data', 'trustm365.db');

  try {
    const src = await openDatabase(srcDbPath);
    const dst = await openDatabase(dstDbPath);

    const tenant = src.prepare('SELECT * FROM tenants WHERE id = ? OR tenant_id = ?').get(arg, arg);
    if (!tenant) {
      console.error('Tenant not found in source DB:', arg);
      process.exit(1);
    }

    const existing = dst.prepare('SELECT id FROM tenants WHERE tenant_id = ?').get(tenant.tenant_id);
    if (existing) {
      console.log('Tenant already exists in destination DB:', existing.id);
      process.exit(0);
    }

    // Insert tenant row (preserve same id)
    dst.prepare(`INSERT INTO tenants (id,display_name,tenant_id,client_id,client_secret_encrypted,created_at,last_synced_at,last_sync_error,last_sync_error_at,drift_check_auto,drift_interval_minutes,permissions_json,permissions_checked_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        tenant.id,
        tenant.display_name,
        tenant.tenant_id,
        tenant.client_id,
        tenant.client_secret_encrypted,
        tenant.created_at,
        tenant.last_synced_at,
        tenant.last_sync_error,
        tenant.last_sync_error_at,
        tenant.drift_check_auto,
        tenant.drift_interval_minutes,
        tenant.permissions_json,
        tenant.permissions_checked_at
      );

    // Copy tenant_meta if present
    const meta = src.prepare('SELECT * FROM tenant_meta WHERE tenant_id = ?').get(tenant.id);
    if (meta) {
      dst.prepare('INSERT OR REPLACE INTO tenant_meta (tenant_id, notes, tags, updated_at) VALUES (?, ?, ?, ?)')
        .run(meta.tenant_id, meta.notes, meta.tags, meta.updated_at);
    }

    // Copy resource_areas for this tenant
    const areas = src.prepare('SELECT * FROM resource_areas WHERE tenant_id = ?').all(tenant.id);
    const insertArea = dst.prepare('INSERT OR IGNORE INTO resource_areas (id,tenant_id,area_key,display_name,description,has_baseline,last_pulled_at,baseline_set_at,auto_restore) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const a of areas) {
      insertArea.run(a.id, tenant.id, a.area_key, a.display_name, a.description, a.has_baseline, a.last_pulled_at, a.baseline_set_at, a.auto_restore);
    }

    console.log('Copied tenant', tenant.id, 'to destination DB');
    process.exit(0);
  } catch (err) {
    console.error('Failed to copy tenant:', err && err.message ? err.message : err);
    process.exit(2);
  }
}

main();
