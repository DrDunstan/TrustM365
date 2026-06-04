#!/usr/bin/env node
const path = require('path');
const { initDatabase, getDb } = require('../src/database/init');

(async function() {
  try {
    await initDatabase();
    const db = getDb();

    const rows = db.prepare(
      `SELECT ls.tenant_id, t.display_name, ls.pulled_at, ls.resources
       FROM live_snapshots ls
       LEFT JOIN tenants t ON t.id = ls.tenant_id
       WHERE ls.area_key = ?
       ORDER BY ls.pulled_at DESC`
    ).all('exchange_transport_rules');

    if (!rows || rows.length === 0) {
      console.log('No live snapshots found for area_key=exchange_transport_rules');
      process.exit(0);
    }

    for (const r of rows) {
      let resources = {};
      try { resources = JSON.parse(r.resources || '{}') } catch (e) { resources = {} }
      const ids = Object.keys(resources || {});
      console.log('---');
      console.log(`tenant_id: ${r.tenant_id} (${r.display_name || 'unknown'})`);
      console.log(`pulled_at: ${r.pulled_at}`);
      console.log(`resources: ${ids.length}`);
      if (ids.length > 0) console.log(`sample ids: ${ids.slice(0,10).join(', ')}`);
    }
  } catch (err) {
    console.error('Error inspecting DB:', err && err.message ? err.message : err);
    process.exit(2);
  }
})();
