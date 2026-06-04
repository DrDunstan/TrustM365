(async () => {
  try {
    const { initDatabase } = require('../backend/src/database/init');
    const db = await initDatabase();
    const rows = db.prepare("SELECT id, tenant_id, area_key, display_name, has_baseline, last_pulled_at FROM resource_areas WHERE area_key LIKE 'exchange_%' ORDER BY tenant_id, area_key").all();
    const count = rows.length;
    console.log(JSON.stringify({ count, rows }, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('ERROR', err);
    process.exit(2);
  }
})();
