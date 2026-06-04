#!/usr/bin/env node
const { initDatabase } = require('../src/database/init');

(async () => {
  try {
    const db = await initDatabase();
    const rows = db.prepare("SELECT tenant_id, area_key, display_name FROM resource_areas WHERE area_key LIKE 'teams_%' ORDER BY tenant_id, area_key").all();
    if (!rows || rows.length === 0) {
      console.log('No teams_* resource_areas found');
      process.exit(0);
    }
    console.log('Found teams resource areas (sample):');
    for (const r of rows) {
      console.log(` - tenant_id=${r.tenant_id} area_key=${r.area_key} display_name=${r.display_name}`);
    }
    process.exit(0);
  } catch (err) {
    console.error('Error:', err && err.message ? err.message : err);
    process.exit(1);
  }
})();
