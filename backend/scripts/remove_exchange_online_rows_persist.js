const path = require('path');
const fs = require('fs');
const { openDatabase } = require('../src/database/sqlite');

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

(async function main() {
  try {
    const DB_PATH = process.env.DATABASE_PATH
      ? path.resolve(process.env.DATABASE_PATH)
      : path.resolve(__dirname, '../../data/trustm365.db');

    if (!fs.existsSync(DB_PATH)) {
      console.error('[abort] Database file not found at', DB_PATH);
      process.exit(2);
    }

    const bakPath = `${DB_PATH}.bak2.${Date.now()}`;
    fs.copyFileSync(DB_PATH, bakPath);
    console.log('[backup] Database backed up to', bakPath);

    const db = await openDatabase(DB_PATH);

    const tables = [
      'resource_areas',
      'baselines',
      'live_snapshots',
      'drift_results',
      'baseline_history',
      'restore_log'
    ];

    console.log('\nCounts before:');
    for (const t of tables) {
      try {
        const r = db.prepare(`SELECT COUNT(*) AS c FROM ${t} WHERE area_key = ?`).get('exchange_online');
        console.log(`  ${t}: ${r?.c ?? 0}`);
      } catch (err) {}
    }

    console.log('\nDeleting rows for area_key = "exchange_online"...');
    for (const t of tables) {
      try {
        const stmt = db.prepare(`DELETE FROM ${t} WHERE area_key = ?`);
        const res = stmt.run('exchange_online');
        console.log(`  DELETE ${t}: changes=${res.changes}`);
      } catch (err) {
        console.log(`  SKIP ${t}: ${err.message}`);
      }
    }

    // Wait for scheduleSave debounce in sqlite.js (500ms) to complete
    await sleep(900);

    console.log('\nCounts after (in-memory):');
    for (const t of tables) {
      try {
        const r = db.prepare(`SELECT COUNT(*) AS c FROM ${t} WHERE area_key = ?`).get('exchange_online');
        console.log(`  ${t}: ${r?.c ?? 0}`);
      } catch (err) {}
    }

    db.close();
    console.log('\nClosed DB after waiting for save.');
  } catch (err) {
    console.error('[error]', err);
    process.exit(1);
  }
})();
