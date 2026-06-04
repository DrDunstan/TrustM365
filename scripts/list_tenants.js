const { initDatabase } = require('../backend/src/database/init');
(async () => {
  try {
    const db = await initDatabase();
    const rows = db.prepare('SELECT id, display_name, tenant_id FROM tenants ORDER BY display_name').all();
    console.log(JSON.stringify(rows, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('ERR', err && err.message);
    process.exit(2);
  }
})();
