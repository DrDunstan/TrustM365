'use strict';
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database/init');
const { assembleTenantReport, assemblePortfolioReport } = require('../reports/assembler');
const { renderTenantReport, renderPortfolioReport } = require('../reports/renderer');
const { renderTenantReportDocx, renderPortfolioReportDocx } = require('../reports/docx-renderer');
const logger = require('../utils/logger');
const router = express.Router();

// ── Get MSSP settings for branding ───────────────────────────────────────────
function getMsspBranding() {
  const db = getDb();
  try {
    const row = db.prepare("SELECT * FROM mssp_settings WHERE id = 'singleton'").get();
    return {
      companyName:   row?.company_name   || 'TrustM365',
      tagline:       row?.tagline        || '',
      logoUrl:       row?.logo_url       || null,
      brandHue:      row?.brand_hue      || null,
      reportTheme:   'light',
      reportAccent:  row?.report_accent  || '',
    };
  } catch {
    return { companyName: 'TrustM365', tagline: '', logoUrl: null, brandHue: null, reportTheme: 'light', reportAccent: '' };
  }
}

// ── Shared caches (imported from tenants route module scope) ─────────────────
// We need to access the in-memory overviewCache/insightsCache from tenants.js.
// Since those are module-level Maps we can't directly import them, we pass null
// here and the assembler falls back gracefully — cached overview data is used
// when available from the DB, but live telemetry is optional.
// (In a future refactor, move the caches to a shared cacheStore.js module.)

// ── List reports ──────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const db = getDb();
  const { tenantId, type } = req.query;
  let query = 'SELECT id, tenant_id, report_type, title, date_range_start, date_range_end, generated_at, trigger, unread FROM reports';
  const params = [];
  const where = [];
  if (tenantId) { where.push('tenant_id = ?'); params.push(tenantId); }
  if (type)     { where.push('report_type = ?'); params.push(type); }
  if (where.length) query += ' WHERE ' + where.join(' AND ');
  query += ' ORDER BY generated_at DESC';
  const reports = db.prepare(query).all(...params);
  const unreadCount = db.prepare("SELECT COUNT(*) as cnt FROM reports WHERE unread = 1").get().cnt;
  res.json({ reports, unreadCount });
});

// ── Get single report HTML ────────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const db = getDb();
  const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
  if (!report) return res.status(404).json({ error: 'Report not found' });
  // Mark as read
  db.prepare('UPDATE reports SET unread = 0 WHERE id = ?').run(req.params.id);
  res.json(report);
});

// ── GET /reports/:id/docx — download report as Word document ─────────────────
router.get('/:id/docx', async (req, res) => {
  const db = getDb();
  const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
  if (!report) return res.status(404).json({ error: 'Report not found' });

  const mssp  = getMsspBranding();
  const notes = (() => { try { return JSON.parse(report.notes_json || '{}'); } catch { return {}; } })();

  try {
    let buffer;
    const dateStart = report.date_range_start;
    const dateEnd   = report.date_range_end;

    if (report.report_type === 'portfolio') {
      const data = await assemblePortfolioReport(dateStart, dateEnd, notes);
      buffer = await renderPortfolioReportDocx(data, mssp);
    } else {
      const data = await assembleTenantReport(report.tenant_id, dateStart, dateEnd, notes);
      buffer = await renderTenantReportDocx(data, mssp);
    }

    const slug   = (report.title || 'report').replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 60);
    const fname  = `${slug}-${dateStart?.slice(0, 10)}.docx`;
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.set('Content-Disposition', `attachment; filename="${fname}"`);
    logger.info({ reportId: report.id, reportType: report.report_type }, 'docx export generated');
    res.send(buffer);
  } catch (err) {
    logger.error({ err, reportId: report.id }, 'docx generation failed');
    res.status(500).json({ error: 'Failed to generate Word document', message: err.message });
  }
});

// ── Preview report data (no HTML generation) ──────────────────────────────────
// Returns the structured assembler payload so the frontend can show real data
// before the MSSP adds commentary and generates the final report.
router.post('/preview', async (req, res) => {
  const { tenantId, reportType = 'tenant', dateStart, dateEnd } = req.body;
  if (!dateStart || !dateEnd) return res.status(400).json({ error: 'dateStart and dateEnd are required' });
  try {
    if (reportType === 'portfolio') {
      const data = await assemblePortfolioReport(dateStart, dateEnd, {});
      return res.json(data);
    }
    if (!tenantId) return res.status(400).json({ error: 'tenantId required for tenant preview' });
    const data = await assembleTenantReport(tenantId, dateStart, dateEnd, {});
    res.json(data);
  } catch (err) {
    logger.error({ err }, 'Report preview failed');
    res.status(500).json({ error: err.message });
  }
});

// ── Generate report (on-demand) ───────────────────────────────────────────────
router.post('/generate', async (req, res) => {
  const { tenantId, reportType = 'tenant', dateStart, dateEnd, notes = {}, title } = req.body;
  if (!dateStart || !dateEnd) return res.status(400).json({ error: 'dateStart and dateEnd are required' });

  const db     = getDb();
  const mssp   = getMsspBranding();
  const id     = uuidv4();

  try {
    let html, reportTitle;
    if (reportType === 'portfolio') {
      const data = await assemblePortfolioReport(dateStart, dateEnd, notes);
      html = renderPortfolioReport(data, mssp);
      reportTitle = title || `MSSP Portfolio Report — ${dateStart.slice(0,10)} to ${dateEnd.slice(0,10)}`;
    } else {
      if (!tenantId) return res.status(400).json({ error: 'tenantId required for tenant report' });
      const data = await assembleTenantReport(tenantId, dateStart, dateEnd, notes);
      html = renderTenantReport(data, mssp);
      const tenant = db.prepare('SELECT display_name FROM tenants WHERE id = ?').get(tenantId);
      reportTitle = title || `${tenant?.display_name || 'Tenant'} — Report ${dateStart.slice(0,10)} to ${dateEnd.slice(0,10)}`;
    }

    db.prepare(`
      INSERT INTO reports (id, tenant_id, report_type, title, date_range_start, date_range_end, trigger, html_content, notes_json, unread)
      VALUES (?, ?, ?, ?, ?, ?, 'on-demand', ?, ?, 0)
    `).run(id, tenantId || null, reportType, reportTitle, dateStart, dateEnd, html, JSON.stringify(notes));

    logger.info({ id, reportType, tenantId }, 'Report generated');
    res.json({ id, title: reportTitle });
  } catch (err) {
    logger.error({ err }, 'Report generation failed');
    res.status(500).json({ error: err.message });
  }
});

// ── Delete report ─────────────────────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  const db = getDb();
  const report = db.prepare('SELECT id FROM reports WHERE id = ?').get(req.params.id);
  if (!report) return res.status(404).json({ error: 'Report not found' });
  db.prepare('DELETE FROM reports WHERE id = ?').run(req.params.id);
  res.json({ deleted: true });
});

// ── Mark all reports as read ──────────────────────────────────────────────────
router.post('/mark-read', (req, res) => {
  const db = getDb();
  db.prepare('UPDATE reports SET unread = 0').run();
  res.json({ ok: true });
});

// ── Get/update schedule for a tenant ─────────────────────────────────────────
router.get('/schedule/:tenantId', (req, res) => {
  const db = getDb();
  const schedule = db.prepare('SELECT * FROM report_schedules WHERE tenant_id = ?').get(req.params.tenantId);
  res.json(schedule || { tenant_id: req.params.tenantId, frequency: 'monthly', day_of_week: 1, day_of_month: 1, enabled: 0, include_appendix: 1 });
});

router.patch('/schedule/:tenantId', (req, res) => {
  const db = getDb();
  const { frequency, dayOfWeek, dayOfMonth, enabled, includeAppendix } = req.body;
  const existing = db.prepare('SELECT id FROM report_schedules WHERE tenant_id = ?').get(req.params.tenantId);
  if (existing) {
    db.prepare(`UPDATE report_schedules SET
      frequency=COALESCE(?,frequency), day_of_week=COALESCE(?,day_of_week),
      day_of_month=COALESCE(?,day_of_month), enabled=COALESCE(?,enabled),
      include_appendix=COALESCE(?,include_appendix)
      WHERE tenant_id=?
    `).run(frequency||null, dayOfWeek??null, dayOfMonth??null, enabled??null, includeAppendix??null, req.params.tenantId);
  } else {
    db.prepare(`INSERT INTO report_schedules (id,tenant_id,frequency,day_of_week,day_of_month,enabled,include_appendix)
      VALUES (?,?,?,?,?,?,?)`
    ).run(uuidv4(), req.params.tenantId, frequency||'monthly', dayOfWeek||1, dayOfMonth||1, enabled||0, includeAppendix||1);
  }
  res.json(db.prepare('SELECT * FROM report_schedules WHERE tenant_id = ?').get(req.params.tenantId));
});

module.exports = router;

// ── Baseline Export routes ────────────────────────────────────────────────────
const { assembleBaselineExport, listBaselineHistory } = require('../reports/baseline-assembler');
const { renderBaselineExport }   = require('../reports/baseline-renderer');
const { renderBaselineExportDocx } = require('../reports/docx-renderer');

// GET /api/reports/baseline-history/:tenantId
// Returns archived baseline versions per area so the UI can offer a version picker
router.get('/baseline-history/:tenantId', (req, res) => {
  try {
    const history = listBaselineHistory(req.params.tenantId);
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/reports/baseline-preview
// Returns the assembled data for the frontend preview panel
router.post('/baseline-preview', async (req, res) => {
  const { tenantId, versionOverrides = {} } = req.body;
  if (!tenantId) return res.status(400).json({ error: 'tenantId required' });
  try {
    const data = await assembleBaselineExport(tenantId, versionOverrides);
    res.json(data);
  } catch (err) {
    logger.error({ err, tenantId }, 'Baseline preview failed');
    res.status(500).json({ error: err.message });
  }
});

// POST /api/reports/baseline-generate
// Renders and saves the HTML report, returns the saved report record
router.post('/baseline-generate', async (req, res) => {
  const { tenantId, versionOverrides = {}, title } = req.body;
  if (!tenantId) return res.status(400).json({ error: 'tenantId required' });
  try {
    const mssp = getMsspBranding();
    const data = await assembleBaselineExport(tenantId, versionOverrides);
    const html = renderBaselineExport(data, mssp);

    const db = getDb();
    const tenant = db.prepare('SELECT display_name FROM tenants WHERE id = ?').get(tenantId);
    const reportTitle = title || `Baseline Export — ${tenant?.display_name || tenantId}`;
    const now = new Date().toISOString();
    const id  = require('crypto').randomUUID();

    db.prepare(`INSERT INTO reports
      (id, tenant_id, report_type, title, date_range_start, date_range_end,
       generated_at, trigger, html_content, unread)
      VALUES (?,?,?,?,?,?,?,?,?,0)`)
      .run(id, tenantId, 'baseline', reportTitle, now, now, now, 'on-demand', html);

    logger.info({ tenantId, reportId: id }, 'Baseline export generated');
    res.json({ id, title: reportTitle, generated_at: now, report_type: 'baseline' });
  } catch (err) {
    logger.error({ err, tenantId }, 'Baseline export generation failed');
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reports/baseline-docx/:reportId
// Generates and streams a Word document for a saved baseline export
router.get('/baseline-docx/:reportId', async (req, res) => {
  try {
    const db = getDb();
    const report = db.prepare('SELECT * FROM reports WHERE id = ? AND report_type = ?')
      .get(req.params.reportId, 'baseline');
    if (!report) return res.status(404).json({ error: 'Baseline export not found' });

    const mssp = getMsspBranding();
    // Re-assemble from DB (tenant_id is stored on the report)
    const data = await assembleBaselineExport(report.tenant_id, {});
    const buffer = await renderBaselineExportDocx(data, mssp);

    const safeName = (report.title || 'baseline-export').replace(/[^a-z0-9\-_]/gi, '_');
    res.setHeader('Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.docx"`);
    res.send(buffer);
  } catch (err) {
    logger.error({ err }, 'Baseline docx export failed');
    res.status(500).json({ error: err.message });
  }
});
