const path = require('path');
const { openDatabase } = require('../src/database/sqlite');

(async function main() {
  const DB_PATH = process.env.DATABASE_PATH
    ? path.resolve(process.env.DATABASE_PATH)
    : path.resolve(__dirname, '../../data/trustm365.db');
  const db = await openDatabase(DB_PATH);
  const tenants = db.prepare('SELECT id, display_name, permissions_json FROM tenants').all();
  let found = 0;
  for (const t of tenants) {
    if (!t.permissions_json) continue;
    try {
      const p = JSON.parse(t.permissions_json);
      if (Array.isArray(p.areas) && p.areas.some(a => a.areaKey === 'exchange_online')) {
        console.log(`tenant ${t.id} (${t.display_name}) still has exchange_online area`);
        found++;
      }
    } catch (err) {
      // ignore
    }
  }
  if (found === 0) console.log('No tenants with exchange_online in permissions_json');
  db.close();
})();
