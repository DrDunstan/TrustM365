#!/usr/bin/env node
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const path = require('path');
const { openDatabase } = require('../src/database/sqlite');

async function main() {
  const DB_PATH = process.env.DATABASE_PATH
    ? path.resolve(process.env.DATABASE_PATH)
    : path.resolve(__dirname, '../../data/trustm365.db');

  const db = await openDatabase(DB_PATH);
  const areaKey = 'teams_teams';
  console.log('Deleting rows for area_key =', areaKey);
  try {
    const delRA = db.prepare('DELETE FROM resource_areas WHERE area_key = ?');
    const delLS = db.prepare('DELETE FROM live_snapshots WHERE area_key = ?');
    const delBL = db.prepare('DELETE FROM baselines WHERE area_key = ?');
    const delDR = db.prepare('DELETE FROM drift_results WHERE area_key = ?');
    const r1 = delRA.run(areaKey);
    const r2 = delLS.run(areaKey);
    const r3 = delBL.run(areaKey);
    const r4 = delDR.run(areaKey);
    console.log('Deleted rows:', { resource_areas: r1.changes, live_snapshots: r2.changes, baselines: r3.changes, drift_results: r4.changes });
  } catch (err) {
    console.error('Error deleting rows:', err && err.message ? err.message : err);
    process.exit(2);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
