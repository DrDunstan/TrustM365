const path = require('path');
const { openDatabase } = require('../src/database/sqlite');

(async () => {
  try {
    const DB_PATH = process.env.DATABASE_PATH
      ? path.resolve(process.env.DATABASE_PATH)
      : path.resolve(__dirname, '../../data/trustm365.db');

    const db = await openDatabase(DB_PATH);
    const tables = ['resource_areas','baselines','live_snapshots','drift_results','baseline_history','restore_log'];
    console.log('Checking persisted counts in DB:', DB_PATH, '\n');
    for (const t of tables) {
      try {
        const r = db.prepare(`SELECT COUNT(*) AS c FROM ${t} WHERE area_key = ?`).get('exchange_online');
        console.log(`${t}: ${r?.c ?? 0}`);
      } catch (err) {
        console.log(`${t}: (skipped) ${err.message}`);
      }
    }
    db.close();
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
