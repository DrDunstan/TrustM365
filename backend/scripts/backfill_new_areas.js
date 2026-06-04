#!/usr/bin/env node
const { initDatabase } = require('../src/database/init');
const crypto = require('crypto');

async function main() {
  const db = await initDatabase();
  const tenants = db.prepare('SELECT id FROM tenants').all();
  if (!tenants || tenants.length === 0) {
    console.log('No tenants found; nothing to do');
    process.exit(0);
  }

  const NEW = [
    ['sharepoint_sites', 'SharePoint Sites', 'SharePoint site collections and basic sharing settings'],
    ['teams_policies_messaging', 'Messaging Policies', 'Tenant-level Teams messaging policies (Giphy, memes, external images)'],
    ['teams_policies_meetings', 'Meeting Policies', 'Tenant-level Teams meeting & online meeting policies'],
    ['teams_membership', 'Team Membership', 'Per-team membership and owner lists'],
  ];

  const insert = db.prepare('INSERT OR IGNORE INTO resource_areas (id, tenant_id, area_key, display_name, description) VALUES (?, ?, ?, ?, ?)');
  for (const t of tenants) {
    for (const [areaKey, displayName, description] of NEW) {
      insert.run(crypto.randomUUID(), t.id, areaKey, displayName, description);
    }
  }

  console.log('Backfill complete for areas:', NEW.map(n => n[0]).join(', '));
}

main().catch(err => { console.error(err); process.exit(1); });
