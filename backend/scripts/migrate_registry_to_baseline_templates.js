#!/usr/bin/env node
// Migrate selected registry templates into baseline_templates table
// Usage: node migrate_registry_to_baseline_templates.js

async function main() {
  const { initDatabase, getDb } = require('../src/database/init');
  const registry = require('../src/referenceTemplates/registry');

  const ids = [
    'zerotrust-apps',
    'zerotrust-auth-passwordless',
    'zerotrust-authorization-invite-policy',
    'zerotrust-ca-mfa',
    'zerotrust-device-compliance-policies',
    'zerotrust-device-tpm-required',
    'zerotrust-devices',
    'zerotrust-identity-protection',
    'zerotrust-privileged-roles',
    'zerotrust-security-defaults'
  ];

  console.log('Initializing database...');
  await initDatabase();
  const db = getDb();

  for (const id of ids) {
    try {
      const tpl = registry.getTemplate(id);
      if (!tpl) {
        console.warn(`Template not found in registry: ${id}`);
        continue;
      }

      const name = tpl.name || tpl.display_name || tpl.template_id || tpl.id || id;
      const description = tpl.description || '';
      const areaKey = tpl.area_key || tpl.areaKey || 'unknown';
      const resources = JSON.stringify(tpl.resources || {});
      const watched_keys = JSON.stringify(tpl.watched_keys || tpl.watchedKeys || []);

      // Insert or replace into baseline_templates using the registry id as primary key
      const stmt = db.prepare(`INSERT OR REPLACE INTO baseline_templates
        (id, name, description, area_key, resources, watched_keys)
        VALUES (?, ?, ?, ?, ?, ?)`);
      stmt.run(id, name, description, areaKey, resources, watched_keys);
      console.log(`Migrated template: ${id}`);
    } catch (err) {
      console.error(`Failed to migrate ${id}:`, err && err.message ? err.message : err);
    }
  }

  console.log('Migration complete. Flushing DB to disk...');
  try {
    // Ensure sql.js in-memory DB is flushed to disk
    const dbInst = getDb();
    if (dbInst && typeof dbInst.close === 'function') {
      dbInst.close();
      console.log('Database closed (flushed)');
    }
  } catch (e) {
    console.warn('Failed to close DB gracefully:', e && e.message);
  }
  console.log('Done.');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
