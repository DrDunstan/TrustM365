const path = require('path');
const fs = require('fs');
const { openDatabase } = require('../src/database/sqlite');

(async function main() {
  try {
    const DB_PATH = process.env.DATABASE_PATH
      ? path.resolve(process.env.DATABASE_PATH)
      : path.resolve(__dirname, '../../data/trustm365.db');

    if (!fs.existsSync(DB_PATH)) {
      console.error('[abort] Database file not found at', DB_PATH);
      process.exit(2);
    }

    const bakPath = `${DB_PATH}.permprune.${Date.now()}`;
    fs.copyFileSync(DB_PATH, bakPath);
    console.log('[backup] Database backed up to', bakPath);

    const db = await openDatabase(DB_PATH);
    const tenants = db.prepare('SELECT id, permissions_json FROM tenants').all();
    let updated = 0;
    for (const t of tenants) {
      if (!t.permissions_json) continue;
      let parsed;
      try {
        parsed = JSON.parse(t.permissions_json);
      } catch (err) {
        console.log(`[skip] tenant ${t.id} — permissions_json parse error`);
        continue;
      }
      if (!Array.isArray(parsed.areas)) continue;
      const before = parsed.areas.length;
      const afterAreas = parsed.areas.filter(a => a.areaKey !== 'exchange_online');
      if (afterAreas.length !== before) {
        parsed.areas = afterAreas;
        db.prepare('UPDATE tenants SET permissions_json = ? WHERE id = ?').run(JSON.stringify(parsed), t.id);
        console.log(`[update] tenant ${t.id} — removed ${before - afterAreas.length} exchange_online area(s)`);
        updated++;
      }
    }
    db.close();
    console.log(`\nDone. Tenants updated: ${updated}`);
  } catch (err) {
    console.error('[error]', err);
    process.exit(1);
  }
})();
