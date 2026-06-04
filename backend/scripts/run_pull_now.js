#!/usr/bin/env node
const { initDatabase, getDb } = require('../src/database/init');
const { createSyncJob, runSync, getJob } = require('../src/engine/sync');

(async () => {
  try {
    await initDatabase();
    const db = getDb();

    const tenantDbId = process.argv[2] || '156a0407-c859-4078-b33b-33a785540599';
    const areaKey = process.argv[3] || 'exchange_transport_rules';

    const jobId = createSyncJob(tenantDbId, areaKey);
    console.log('Starting sync job', jobId, 'for', tenantDbId, areaKey);
    await runSync(jobId);
    const job = getJob(jobId);
    console.log('Job status:', job?.status || 'unknown');
    if (job?.error) console.error('Job error:', job.error);

    const snap = db.prepare('SELECT * FROM live_snapshots WHERE tenant_id = ? AND area_key = ? ORDER BY pulled_at DESC LIMIT 1')
      .get(tenantDbId, areaKey);
    if (!snap) {
      console.log('No snapshot created');
      return;
    }
    console.log('Latest snapshot pulled_at:', snap.pulled_at);
    let resources = {};
    try { resources = JSON.parse(snap.resources || '{}') } catch (e) { resources = {} }
    console.log('Resources count:', Object.keys(resources).length);
    console.log('Sample (first 20):', Object.keys(resources).slice(0,20).join(', '));
    console.log('\nFull resources JSON:');
    console.log(JSON.stringify(resources, null, 2));
  } catch (err) {
    console.error('Sync failed:', err && err.message ? err.message : err);
    process.exit(2);
  }
})();
