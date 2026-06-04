const path = require('path');
const fs = require('fs');

const tenantId = process.argv[2];
if (!tenantId) {
  console.error('Usage: node scripts/generateBaselineExport.js <tenantId>');
  process.exit(2);
}

const { initDatabase } = require('../backend/src/database/init');
const { assembleBaselineExport } = require('../backend/src/reports/baseline-assembler');
const { renderBaselineExport } = require('../backend/src/reports/baseline-renderer');
const { renderBaselineExportDocx } = require('../backend/src/reports/docx-renderer');

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
    const data = await assembleBaselineExport(internalId, {});
    const html = renderBaselineExport(data, {});
    const outDir = path.resolve(__dirname, '../tmp');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const fname = path.join(outDir, `baseline-${tenantId}.html`);
    fs.writeFileSync(fname, html, 'utf8');
    console.log(`Wrote ${fname}`);

    // Also generate a Word (.docx) export to verify docx-renderer formatting
    try {
      const docxBuf = await renderBaselineExportDocx(data, {});
      const fnameDocx = path.join(outDir, `baseline-${tenantId}.docx`);
      fs.writeFileSync(fnameDocx, docxBuf);
      console.log(`Wrote ${fnameDocx}`);
    } catch (e) {
      console.error('Failed to render DOCX export:', e && e.message ? e.message : e);
    }
  } catch (err) {
    console.error('Failed to generate baseline export:', err && err.message ? err.message : err);
    console.error(err);
    process.exit(1);
  }
})();
