(async () => {
  try {
    const path = require('path');
    const init = require(path.resolve(__dirname, '../backend/src/database/init'));
    // initDatabase returns a Promise
    await init.initDatabase();
    const db = init.getDb();

    const arg = process.argv[2];
    if (!arg) {
      const rows = db.prepare('SELECT id, display_name, tenant_id, client_id, created_at FROM tenants ORDER BY display_name').all();
      console.log(JSON.stringify({ tenants: rows }, null, 2));
      return;
    }

    const byId = db.prepare('SELECT id, display_name, tenant_id, client_id, created_at FROM tenants WHERE id = ?').get(arg);
    if (byId) {
      console.log(JSON.stringify({ foundById: byId }, null, 2));
      return;
    }
    const byTenant = db.prepare('SELECT id, display_name, tenant_id, client_id, created_at FROM tenants WHERE tenant_id = ?').get(arg);
    if (byTenant) {
      console.log(JSON.stringify({ foundByTenantId: byTenant }, null, 2));
      return;
    }
    console.log(JSON.stringify({ found: false, query: arg }));
  } catch (err) {
    console.error('ERROR', err && err.message ? err.message : String(err));
    process.exitCode = 2;
  }
})();
