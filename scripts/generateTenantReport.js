const path = require('path');
const fs = require('fs');

const tenantId = process.argv[2];
const dateStart = process.argv[3] || '2026-03-22';
const dateEnd = process.argv[4] || '2026-04-21';
if (!tenantId) {
  console.error('Usage: node scripts/generateTenantReport.js <tenantId> [dateStart] [dateEnd]');
  process.exit(2);
}

const { initDatabase } = require('../backend/src/database/init');
const { assembleTenantReport } = require('../backend/src/reports/assembler');
const { renderTenantReport } = require('../backend/src/reports/renderer');

(async function() {
  try {
    await initDatabase();
    const { getDb } = require('../backend/src/database/init');
    const db = getDb();
    // Accept either internal tenant `id` or the Azure `tenant_id` (GUID)
    let tenantRow = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
    if (!tenantRow) tenantRow = db.prepare('SELECT * FROM tenants WHERE tenant_id = ?').get(tenantId);
    if (!tenantRow) throw new Error(`Tenant ${tenantId} not found`);
    const internalId = tenantRow.id;

    const data = await assembleTenantReport(internalId, dateStart, dateEnd, {});
    const html = renderTenantReport(data, {});

    const outDir = path.resolve(__dirname, '../tmp');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const fname = path.join(outDir, `tenant-report-${tenantId}.html`);
    fs.writeFileSync(fname, html, 'utf8');
    console.log(`Wrote ${fname}`);
  } catch (err) {
    console.error('Failed to generate tenant report:', err && err.message ? err.message : err);
    console.error(err);
    process.exit(1);
  }
})();
