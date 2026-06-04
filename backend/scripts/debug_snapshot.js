#!/usr/bin/env node
const { initDatabase } = require('../src/database/init');
(async()=>{
  try {
    const db = await initDatabase();
    const snap = db.prepare("SELECT * FROM live_snapshots WHERE tenant_id = ? AND area_key = ? ORDER BY pulled_at DESC LIMIT 1")
      .get('156a0407-c859-4078-b33b-33a785540599','teams_policies_messaging');
    console.log('snap:', snap ? {id: snap.id, pulled_at: snap.pulled_at, resources_len: (snap.resources || '').length} : null);
    if (snap && snap.resources) {
      const res = JSON.parse(snap.resources || '{}');
      console.log('keys:', Object.keys(res));
      console.log('sample:', JSON.stringify(Object.keys(res).slice(0,20), null, 2));
    }
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
