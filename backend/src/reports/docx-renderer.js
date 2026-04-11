'use strict';
/**
 * docx-renderer.js  — Light-mode Word document renderer for TrustM365 reports.
 *
 * All colours are professional light-mode values suitable for printing and
 * formal client delivery. Company name, tagline, and accent colour are drawn
 * from MSSP Settings and applied throughout the document.
 *
 * Entry points:
 *   renderTenantReportDocx(data, mssp)   → Buffer
 *   renderPortfolioReportDocx(data, mssp) → Buffer (kept for backward compat)
 */

const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, WidthType, BorderStyle,
  ShadingType, convertInchesToTwip, PageBreak, Footer,
} = require('docx');

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(v) { return String(v ?? ''); }

// Timestamp formatting helper
function fmtTs(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
  } catch {
    return iso;
  }
}
  function fmtTs(iso) {
    if (!iso) return '\u0014';
    try {
      return new Date(iso).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return iso;
    }
  }

// ── Light-mode colour palette (hex without #) ─────────────────────────────────
// All dark backgrounds removed — this is a print/PDF-friendly document.
const CLR = {
  // Brand accent — overridden per document if report_accent is set
  accent:      '4f46e5',   // indigo-600
  accentLight: 'e0e7ff',   // indigo-100 — table header fill
  // Status colours — toned down for print
  green:       '16a34a',   // green-600
  red:         'dc2626',   // red-600
  amber:       'd97706',   // amber-600
  // Text
  dark:        '0f172a',   // slate-900  — headings, labels
  body:        '334155',   // slate-700  — body text
  muted:       '64748b',   // slate-500  — secondary text, descriptions
  faint:       '94a3b8',   // slate-400  — very subtle text
  // Structure
  border:      'cbd5e1',   // slate-300  — table & divider lines
  rowAlt:      'f8fafc',   // slate-50   — alternating table rows
  headerFill:  'e0e7ff',   // indigo-100 — table header background
  pageBg:      'ffffff',   // pure white page
};

// Allow per-report accent override from MSSP settings (report_accent is a hex string like "#6366f1")
function buildCLR(accentHex) {
  if (!accentHex) return CLR;
  const hex = accentHex.replace('#', '');
  return { ...CLR, accent: hex };
}

// ── Paragraph / text builders ─────────────────────────────────────────────────

function heading1(text, clr) {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, color: clr.dark, size: 52 })],
    spacing: { before: 0, after: 120 },
  });
}

function heading2(text, clr) {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, color: clr.accent, size: 28 })],
    spacing: { before: 280, after: 80 },
    border: { bottom: { color: clr.border, size: 6, style: BorderStyle.SINGLE, space: 4 } },
  });
}

function heading3(text, clr) {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, color: clr.muted, size: 20, allCaps: true })],
    spacing: { before: 200, after: 60 },
  });
}

function body(text, clr, size = 22) {
  return new Paragraph({
    children: [new TextRun({ text, color: clr.body, size })],
    spacing: { before: 60, after: 60 },
  });
}

function muted(text, clr, size = 20) {
  return new Paragraph({
    children: [new TextRun({ text, color: clr.muted, size })],
    spacing: { before: 40, after: 40 },
  });
}

function kv(label, value, clr, valueColor) {
  return new Paragraph({
    children: [
      new TextRun({ text: `${label}: `, bold: true, color: clr.muted, size: 22 }),
      new TextRun({ text: esc(value), color: valueColor || clr.body, size: 22 }),
    ],
    spacing: { before: 50, after: 50 },
  });
}

function statRow(stats, clr) {
  return new Paragraph({
    children: stats.flatMap(({ label, value, color }, i) => [
      ...(i > 0 ? [new TextRun({ text: '     ', color: clr.border, size: 20 })] : []),
      new TextRun({ text: esc(value) + ' ', bold: true, color: color || clr.accent, size: 32 }),
      new TextRun({ text: label + '  ', color: clr.muted, size: 18 }),
    ]),
    spacing: { before: 120, after: 120 },
  });
}

function commentaryBox(label, text, clr) {
  if (!text?.trim()) return [];
  return [
    new Paragraph({
      children: [new TextRun({ text: label.toUpperCase(), bold: true, color: clr.accent, size: 18, allCaps: true })],
      spacing: { before: 160, after: 60 },
      border: { left: { color: clr.accent, size: 14, style: BorderStyle.SINGLE, space: 8 } },
      indent: { left: convertInchesToTwip(0.2) },
    }),
    new Paragraph({
      children: [new TextRun({ text: esc(text), color: clr.body, size: 22, italics: true })],
      spacing: { before: 40, after: 120 },
      border: { left: { color: clr.accent, size: 14, style: BorderStyle.SINGLE, space: 8 } },
      indent: { left: convertInchesToTwip(0.2) },
    }),
  ];
}

function divider(clr) {
  return new Paragraph({
    text: '',
    spacing: { before: 100, after: 100 },
    border: { bottom: { color: clr.border, size: 4, style: BorderStyle.SINGLE, space: 4 } },
  });
}

function pageBreak() {
  return new Paragraph({ children: [new PageBreak()] });
}

// ── Table builder ─────────────────────────────────────────────────────────────

function dataTable(headers, rows, clr, emptyMsg = 'No records in this period.') {
  if (!rows.length) return [muted(emptyMsg, clr)];

  const totalWidth = 9000;
  const colWidths = headers.map(() => Math.floor(totalWidth / headers.length));

  const headerBorder = { color: clr.accent, size: 8, style: BorderStyle.SINGLE, space: 0 };
  const cellBorder   = { color: clr.border, size: 4, style: BorderStyle.SINGLE, space: 0 };

  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((h, i) => new TableCell({
      width: { size: colWidths[i], type: WidthType.DXA },
      shading: { type: ShadingType.SOLID, color: clr.headerFill, fill: clr.headerFill },
      borders: { top: headerBorder, bottom: headerBorder, left: cellBorder, right: cellBorder },
      margins: { top: 60, bottom: 60, left: 100, right: 100 },
      children: [new Paragraph({
        children: [new TextRun({ text: esc(h), bold: true, color: clr.accent, size: 18, allCaps: true })],
      })],
    })),
  });

  const dataRows = rows.map((row, ri) => new TableRow({
    children: row.map((cell, ci) => {
      const bg = ri % 2 === 1 ? clr.rowAlt : clr.pageBg;
      return new TableCell({
        width: { size: colWidths[ci], type: WidthType.DXA },
        shading: { type: ShadingType.SOLID, color: bg, fill: bg },
        borders: { top: { color: clr.border, size: 4, style: BorderStyle.SINGLE, space: 0 },
                   bottom: { color: clr.border, size: 4, style: BorderStyle.SINGLE, space: 0 },
                   left:   { color: clr.border, size: 4, style: BorderStyle.SINGLE, space: 0 },
                   right:  { color: clr.border, size: 4, style: BorderStyle.SINGLE, space: 0 } },
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        children: [new Paragraph({
          children: [new TextRun({ text: esc(cell), color: clr.body, size: 20 })],
        })],
      });
    }),
  }));

  return [
    new Table({
      width: { size: totalWidth, type: WidthType.DXA },
      rows: [headerRow, ...dataRows],
    }),
    new Paragraph({ text: '', spacing: { before: 80, after: 0 } }),
  ];
}

// ── Section assembler ─────────────────────────────────────────────────────────

function docSection(title, children, note, commentaryLabel, clr) {
  return [
    heading2(title, clr),
    ...children,
    ...(note?.trim() ? commentaryBox(commentaryLabel, note, clr) : []),
  ];
}

// ── Shared footer ─────────────────────────────────────────────────────────────

function makeFooter(companyName, tagline, clr) {
  const text = [companyName, tagline].filter(Boolean).join(' · ') + ' — TrustM365';
  return new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text, color: clr.muted, size: 16 })],
    })],
  });
}

// ── Shared document options ───────────────────────────────────────────────────

function docOptions(sections, clr) {
  return new Document({
    background: { color: clr.pageBg },
    styles: {
      default: {
        document: {
          run: { font: 'Calibri', color: clr.body, size: 22 },
          paragraph: { spacing: { line: 276 } },
        },
        heading1: { run: { font: 'Calibri', color: clr.dark, bold: true } },
        heading2: { run: { font: 'Calibri', color: clr.accent, bold: true } },
        heading3: { run: { font: 'Calibri', color: clr.muted, bold: true } },
      },
    },
    sections,
  });
}

// ── Tenant report ─────────────────────────────────────────────────────────────

async function renderTenantReportDocx(data, mssp = {}) {
  const { meta, summary, driftHistory, remediationLog, baselineCoverage, configState } = data;

  const companyName     = mssp.companyName || 'TrustM365';
  const tagline         = mssp.tagline     || '';
  const commentaryLabel = companyName !== 'TrustM365' ? `${companyName} Commentary` : 'MSSP Commentary';
  const clr             = buildCLR(mssp.reportAccent);

  // ── Cover page ────────────────────────────────────────────────────────────
  const coverParagraphs = [
    // Company / product header
    new Paragraph({
      children: [new TextRun({ text: companyName, bold: true, color: clr.accent, size: 64 })],
      spacing: { before: 0, after: tagline ? 60 : 160 },
    }),
    ...(tagline ? [new Paragraph({
      children: [new TextRun({ text: tagline, color: clr.muted, size: 24 })],
      spacing: { before: 0, after: 160 },
    })] : []),

    divider(clr),

    // Report title block
    new Paragraph({
      children: [new TextRun({ text: esc(meta.tenantName), bold: true, color: clr.dark, size: 44 })],
      spacing: { before: 160, after: 60 },
    }),
    new Paragraph({
      children: [new TextRun({ text: 'M365 Configuration Monitoring Report', color: clr.muted, size: 24 })],
      spacing: { before: 0, after: 120 },
    }),
    kv('Period',    `${meta.dateStart?.slice(0, 10)} → ${meta.dateEnd?.slice(0, 10)}`, clr),
    kv('Generated', fmtTs(meta.generatedAt), clr),

    divider(clr),

    // Headline stats
    statRow([
      { label: 'Drift Events',    value: summary.driftEvents,  color: summary.driftEvents  > 0 ? clr.red   : clr.green },
      { label: 'Remediated',      value: summary.remediations, color: clr.green },
      { label: 'Outstanding',     value: summary.outstanding,  color: summary.outstanding  > 0 ? clr.amber : clr.green },
      { label: 'Areas Monitored', value: `${summary.baselined}/${summary.totalAreas}`, color: clr.accent },
    ], clr),

    body(
      summary.driftEvents > 0
        ? `${summary.driftEvents} drift event${summary.driftEvents !== 1 ? 's' : ''} detected during this period.`
        : 'No drift events detected. All monitored areas matched their baseline throughout this period.',
      clr,
      22
    ),
  ];

  // ── Drift History rows ────────────────────────────────────────────────────
  const driftRows = (driftHistory.events || []).flatMap(ev =>
    (ev.properties?.length || 0) === 0
      ? [[ev.areaName, ev.resourceName || '—', '—', '—', '—', fmtTs(ev.checkedAt)]]
      : ev.properties.map(p => [
          ev.areaName,
          ev.resourceName || '—',
          p.label || p.path,
          esc(p.baselineValue),
          esc(p.liveValue),
          fmtTs(ev.checkedAt),
        ])
  );

  // ── Remediation rows ──────────────────────────────────────────────────────
  const remRows = (remediationLog.actions || []).map(a => [
    a.areaName     || '—',
    a.resourceName || '—',
    a.propertyLabel || a.propertyPath || 'Full resource',
    a.trigger      || '—',
    a.status === 'ok' ? '✓ OK' : '✗ Failed',
    fmtTs(a.restoredAt),
  ]);

  // ── Coverage rows ─────────────────────────────────────────────────────────
  const coverageRows = (baselineCoverage.areas || []).map(a => [
    a.group || '—',
    a.displayName,
    a.hasBaseline ? 'Monitored' : 'No Baseline',
    a.hasBaseline ? (a.driftStatus === 'clean' ? 'Clean' : a.driftStatus === 'drifted' ? 'Drifted' : '—') : '—',
    a.lastChecked ? fmtTs(a.lastChecked) : '—',
  ]);

  // ── Current Config State ──────────────────────────────────────────────────
  const cs     = configState || {};
  const groups = cs.groups   || {};
  const apps   = cs.apps     || {};
  const devs   = cs.devices  || {};

  const configParas = [
    heading3('Users & Guests', clr),
    kv('Members',  cs.users?.members  ?? '—', clr),
    kv('Guests',   cs.users?.guests   ?? '—', clr),
    kv('Disabled', cs.users?.disabled ?? '—', clr),
    heading3('Groups', clr),
    kv('Total',         groups.total    ?? cs.users?.groups ?? '—', clr),
    kv('Security',      groups.security ?? '—', clr),
    kv('Microsoft 365', groups.m365     ?? '—', clr),
    heading3('App Registrations', clr),
    kv('Total',              apps.total    ?? '—', clr),
    kv('Valid credentials',  apps.valid    ?? '—', clr),
    kv('Expiring (30 days)', apps.expiring ?? '—', clr, clr.amber),
    kv('Expired',            apps.expired  ?? '—', clr, apps.expired > 0 ? clr.red : clr.body),
    heading3('Devices', clr),
    ...(devs.total
      ? [kv('Total',        devs.total,         clr),
         kv('Compliant',    devs.compliant ?? '—', clr, clr.green),
         kv('Non-compliant',devs.nonCompliant ?? '—', clr, devs.nonCompliant > 0 ? clr.red : clr.body)]
      : [muted('No device data available.', clr)]),
  ];

  // ── Technical Appendix rows ───────────────────────────────────────────────
  const allDriftRows = (driftHistory.allResults || driftHistory.events || []).flatMap(ev =>
    (ev.properties?.length || 0) === 0
      ? [[ev.areaName, ev.resourceName || '—', '—', '—', fmtTs(ev.checkedAt)]]
      : ev.properties.map(p => [
          ev.areaName, ev.resourceName || '—',
          p.label || p.path,
          `${esc(p.baselineValue)} → ${esc(p.liveValue)}`,
          fmtTs(ev.checkedAt),
        ])
  );
  const allRemRows = (remediationLog.allActions || remediationLog.actions || []).map(a => [
    a.areaName || '—', a.resourceName || '—',
    a.propertyLabel || 'Full',
    a.trigger  || '—',
    a.status === 'ok' ? '✓ OK' : '✗ Failed',
    fmtTs(a.restoredAt),
  ]);

  // ── Assemble ──────────────────────────────────────────────────────────────
  const children = [
    ...coverParagraphs,
    ...commentaryBox(commentaryLabel, meta.notes?.exec || '', clr),

    pageBreak(),

    ...docSection('Drift History', [
      driftRows.length
        ? statRow([{ label: 'drift events', value: driftRows.length, color: clr.red }], clr)
        : muted('No drift detected in this period.', clr),
      ...dataTable(
        ['Area', 'Resource', 'Property', 'Baseline', 'Live', 'Detected'],
        driftRows, clr,
        'No drift events detected in this period.'
      ),
    ], meta.notes?.drift || '', commentaryLabel, clr),

    divider(clr),

    ...docSection('Remediation Log', [
      statRow([
        { label: 'Total',         value: remediationLog.total        || 0, color: clr.accent },
        { label: 'Succeeded',     value: remediationLog.succeeded    || 0, color: clr.green },
        { label: 'Failed',        value: remediationLog.failed       || 0, color: (remediationLog.failed || 0) > 0 ? clr.red : clr.muted },
        { label: 'Auto-restored', value: remediationLog.autoRestored || 0, color: clr.accent },
      ], clr),
      ...dataTable(
        ['Area', 'Resource', 'Property', 'Trigger', 'Result', 'Timestamp'],
        remRows, clr,
        'No remediation actions in this period.'
      ),
    ], meta.notes?.remediation || '', commentaryLabel, clr),

    divider(clr),

    ...docSection('Baseline Coverage', [
      statRow([
        { label: 'Total Areas',  value: baselineCoverage.totalAreas || 0, color: clr.accent },
        { label: 'Monitored',    value: baselineCoverage.monitored  || 0, color: clr.accent },
        { label: 'Clean',        value: baselineCoverage.clean      || 0, color: clr.green },
        { label: 'Drifted',      value: baselineCoverage.drifted    || 0, color: clr.red },
        { label: 'No Baseline',  value: baselineCoverage.noBaseline || 0, color: clr.muted },
      ], clr),
      ...dataTable(
        ['Group', 'Area', 'Monitoring', 'Status', 'Last Checked'],
        coverageRows, clr,
        'No areas configured.'
      ),
    ], meta.notes?.coverage || '', commentaryLabel, clr),

    divider(clr),

    ...docSection('Current Configuration State', configParas, meta.notes?.config || '', commentaryLabel, clr),

    pageBreak(),

    heading2('Technical Appendix — Audit Trail', clr),
    muted('Complete record for the reporting period. For internal and auditor use.', clr),

    heading3('All Drift Results', clr),
    ...dataTable(['Area', 'Resource', 'Property', 'Change', 'Detected'], allDriftRows, clr, 'No drift events.'),

    heading3('All Restore Actions', clr),
    ...dataTable(['Area', 'Resource', 'Property', 'Trigger', 'Result', 'Timestamp'], allRemRows, clr, 'No restore actions.'),
  ];

  const doc = docOptions([{
    properties: {
      page: {
        margin: { top: convertInchesToTwip(1), bottom: convertInchesToTwip(1), left: convertInchesToTwip(1.2), right: convertInchesToTwip(1.2) },
        size:   { width: convertInchesToTwip(8.5), height: convertInchesToTwip(11) },
      },
    },
    footers: { default: makeFooter(companyName, tagline, clr) },
    children,
  }], clr);

  return Packer.toBuffer(doc);
}

// ── Portfolio report (backward compat — kept but not surfaced in UI) ──────────

async function renderPortfolioReportDocx(data, mssp = {}) {
  const { meta, summary, tenants } = data;

  const companyName     = mssp.companyName || 'TrustM365';
  const tagline         = mssp.tagline     || '';
  const commentaryLabel = companyName !== 'TrustM365' ? `${companyName} Commentary` : 'MSSP Commentary';
  const clr             = buildCLR(mssp.reportAccent);

  const tenantRows = (tenants || []).map(t => [
    t.displayName || '—',
    t.overallStatus || '—',
    String(t.driftedAreas  || 0),
    String(t.totalAreas    || 0),
    `${t.coveragePct ?? '—'}%`,
  ]);

  const children = [
    new Paragraph({
      children: [new TextRun({ text: companyName, bold: true, color: clr.accent, size: 64 })],
      spacing: { before: 0, after: 80 },
    }),
    ...(tagline ? [new Paragraph({
      children: [new TextRun({ text: tagline, color: clr.muted, size: 24 })],
      spacing: { before: 0, after: 120 },
    })] : []),
    divider(clr),
    new Paragraph({
      children: [new TextRun({ text: 'Portfolio Report', bold: true, color: clr.dark, size: 44 })],
      spacing: { before: 160, after: 60 },
    }),
    kv('Period',    `${meta.dateStart?.slice(0, 10)} → ${meta.dateEnd?.slice(0, 10)}`, clr),
    kv('Generated', fmtTs(meta.generatedAt), clr),
    divider(clr),
    statRow([
      { label: 'Tenants',   value: summary.totalTenants   || 0, color: clr.accent },
      { label: 'Drifted',   value: summary.driftedTenants || 0, color: (summary.driftedTenants || 0) > 0 ? clr.red : clr.muted },
      { label: 'Clean',     value: summary.cleanTenants   || 0, color: clr.green },
    ], clr),
    pageBreak(),
    ...docSection('Portfolio Summary', [
      ...dataTable(
        ['Tenant', 'Status', 'Drifted Areas', 'Total Areas', 'Coverage'],
        tenantRows, clr,
        'No tenants in portfolio.'
      ),
    ], meta.notes?.portfolio || '', commentaryLabel, clr),
  ];

  const doc = docOptions([{
    properties: {
      page: {
        margin: { top: convertInchesToTwip(1), bottom: convertInchesToTwip(1), left: convertInchesToTwip(1.2), right: convertInchesToTwip(1.2) },
      },
    },
    footers: { default: makeFooter(companyName, tagline, clr) },
    children,
  }], clr);

  return Packer.toBuffer(doc);
}

// ── Baseline Export — Word document ──────────────────────────────────────────

function fmtDateLocal(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

async function renderBaselineExportDocx(data, mssp = {}) {
  const { meta, areas } = data;
  const companyName     = mssp.companyName || 'TrustM365';
  const tagline         = mssp.tagline     || '';
  const clr             = buildCLR(mssp.reportAccent);

  const children = [
    // ── Cover ──────────────────────────────────────────────────────────────
    new Paragraph({
      children: [new TextRun({ text: companyName, bold: true, color: clr.accent, size: 64 })],
      spacing: { before: 0, after: tagline ? 60 : 160 },
    }),
    ...(tagline ? [new Paragraph({
      children: [new TextRun({ text: tagline, color: clr.muted, size: 24 })],
      spacing: { before: 0, after: 120 },
    })] : []),

    new Paragraph({
      children: [new TextRun({ text: esc(meta.tenantName), bold: true, color: clr.dark, size: 44 })],
      spacing: { before: 160, after: 60 },
    }),
    new Paragraph({
      children: [new TextRun({ text: 'Baseline Configuration Export', color: clr.muted, size: 24 })],
      spacing: { before: 0, after: 100 },
    }),
    kv('Tenant ID',  meta.tenantUUID,   clr),
    kv('Generated',  fmtDateLocal(meta.generatedAt), clr),

    divider(clr),

    statRow([
      { label: 'Baselined Areas',    value: meta.totalAreas,     color: clr.accent },
      { label: 'Total Resources',    value: meta.totalResources,  color: clr.accent },
    ], clr),

    pageBreak(),

    // ── Areas ──────────────────────────────────────────────────────────────
    ...areas.flatMap((area, ai) => {
      const areaNodes = [
        heading2(esc(area.areaDisplayName), clr),
        ...(area.error
          ? [body(`Error loading area: ${area.error}`, clr)]
          : [
              kv('Baseline label', area.label, clr),
              kv('Monitor mode',   area.monitorMode, clr),
              kv('Saved',          fmtDateLocal(area.savedAt), clr),
              kv('Resources',      String(area.resourceCount), clr),
            ]
        ),
      ];

      if (!area.error) {
        for (const res of area.resources) {
          areaNodes.push(
            heading3(esc(res.displayName), clr),
            kv('Monitoring mode', res.mode, clr),
          );

          // Monitored Properties
          areaNodes.push(...heading3('Monitored Properties', clr) ? [] : []);
          areaNodes.push(new Paragraph({
            children: [new TextRun({ text: 'MONITORED PROPERTIES', bold: true, color: clr.accent, size: 18, allCaps: true })],
            spacing: { before: 120, after: 60 },
          }));

          if (res.mode === 'snapshot') {
            areaNodes.push(muted('Snapshot mode — entire resource hashed. Any field change triggers drift.', clr));
          } else if (res.watchedProps.length === 0) {
            areaNodes.push(muted('No individual properties selected.', clr));
          } else {
            areaNodes.push(...dataTable(
              ['Property', 'Path', 'Baseline Value'],
              res.watchedProps.map(wp => [wp.label, wp.path, wp.value]),
              clr
            ));
          }

          // EP Security settings
          if (res.epSettings) {
            areaNodes.push(new Paragraph({
              children: [new TextRun({ text: 'SETTINGS CATALOG — RAW SETTINGS', bold: true, color: clr.accent, size: 18, allCaps: true })],
              spacing: { before: 120, after: 60 },
            }));
            if (res.epSettings.length === 0) {
              areaNodes.push(muted('No settings recorded in this baseline.', clr));
            } else {
              areaNodes.push(...dataTable(
                ['Setting Definition ID', 'Value'],
                res.epSettings.map(s => [s.settingDefinitionId, s.value]),
                clr
              ));
            }
          }

          // Full configuration
          areaNodes.push(new Paragraph({
            children: [new TextRun({ text: 'FULL BASELINE CONFIGURATION', bold: true, color: clr.accent, size: 18, allCaps: true })],
            spacing: { before: 120, after: 60 },
          }));
          if (res.fullConfig.length === 0) {
            areaNodes.push(muted('No configuration data stored.', clr));
          } else {
            areaNodes.push(...dataTable(
              ['Field', 'Value'],
              res.fullConfig.map(fc => [fc.key, fc.value]),
              clr
            ));
          }
        }
      }

      // Page break between areas (not after the last one)
      if (ai < areas.length - 1) areaNodes.push(pageBreak());

      return areaNodes;
    }),
  ];

  const doc = docOptions([{
    properties: {
      page: {
        margin: { top: convertInchesToTwip(1), bottom: convertInchesToTwip(1), left: convertInchesToTwip(1.2), right: convertInchesToTwip(1.2) },
        size:   { width: convertInchesToTwip(8.5), height: convertInchesToTwip(11) },
      },
    },
    footers: { default: makeFooter(companyName, tagline, clr) },
    children,
  }], clr);

  return Packer.toBuffer(doc);
}

module.exports = {
  renderTenantReportDocx,
  renderPortfolioReportDocx,
  renderBaselineExportDocx,
};
