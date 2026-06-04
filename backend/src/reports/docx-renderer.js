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

// Section builder for docx children arrays
function docSection(title, contents = [], note = '', commentaryLabel = 'MSSP Commentary', clr) {
  const out = [];
  out.push(heading2(title, clr));
  if (Array.isArray(contents)) out.push(...contents);
  else if (contents) out.push(contents);
  if (note) out.push(...commentaryBox(commentaryLabel, note, clr));
  return out;
}

// Convert a simple sections descriptor into a `docx` Document instance
function docOptions(sections = [], clr) {
  return new Document({
    sections: sections.map(s => ({
      properties: s.properties || {},
      footers: s.footers || {},
      children: s.children || [],
    })),
  });
}

function makeFooter(companyName, tagline, clr) {
  const text = tagline ? `${companyName} · ${tagline}` : companyName;
  return new Footer({
    children: [new Paragraph({
      children: [new TextRun({ text, color: clr.muted, size: 18 })],
      alignment: AlignmentType.CENTER,
    })],
  });
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

      // Support raw objects/arrays as well as JSON strings. Objects will be
      // pretty-printed as multiline JSON paragraphs; strings that parse as JSON
      // will also be pretty-printed. Scalars are shown as a single paragraph.
      let cellParagraphs;
      if (cell === null || cell === undefined) {
        cellParagraphs = [new Paragraph({ children: [new TextRun({ text: '—', color: clr.body, size: 20 })] })];
      } else if (typeof cell === 'object') {
        // Special case: combined { baseline, live } object from drift rows
        if (cell && (cell.baseline !== undefined || cell.live !== undefined)) {
          const parts = [];
          parts.push(new Paragraph({ children: [new TextRun({ text: 'Baseline:', bold: true, color: clr.muted, size: 18 })], spacing: { before: 0, after: 0 } }));
          if (Array.isArray(cell.baseline)) {
            const bl = cell.baseline;
            const peopleLike = bl.every(it => it && typeof it === 'object' && (it.displayName || it.userPrincipalName || it.id));
            if (peopleLike) {
              for (const it of bl) parts.push(new Paragraph({ children: [new TextRun({ text: '• ' + (it.displayName || it.userPrincipalName || it.id), color: clr.body, size: 18 })], spacing: { before: 0, after: 0 } }));
            } else {
              const pretty = JSON.stringify(bl, null, 2);
              for (const line of pretty.split('\n')) parts.push(new Paragraph({ children: [new TextRun({ text: line, font: 'Consolas', color: clr.body, size: 18 })], spacing: { before: 0, after: 0 } }));
            }
          } else if (cell.baseline && typeof cell.baseline === 'object') {
            const pretty = JSON.stringify(cell.baseline, null, 2);
            for (const line of pretty.split('\n')) parts.push(new Paragraph({ children: [new TextRun({ text: line, font: 'Consolas', color: clr.body, size: 18 })], spacing: { before: 0, after: 0 } }));
          } else {
            parts.push(new Paragraph({ children: [new TextRun({ text: esc(String(cell.baseline ?? '—')), color: clr.body, size: 20 })], spacing: { before: 0, after: 0 } }));
          }

          parts.push(new Paragraph({ children: [new TextRun({ text: 'Live:', bold: true, color: clr.muted, size: 18 })], spacing: { before: 6, after: 0 } }));
          if (Array.isArray(cell.live)) {
            const lv = cell.live;
            const peopleLike = lv.every(it => it && typeof it === 'object' && (it.displayName || it.userPrincipalName || it.id));
            if (peopleLike) {
              for (const it of lv) parts.push(new Paragraph({ children: [new TextRun({ text: '• ' + (it.displayName || it.userPrincipalName || it.id), color: clr.body, size: 18 })], spacing: { before: 0, after: 0 } }));
            } else {
              const pretty = JSON.stringify(lv, null, 2);
              for (const line of pretty.split('\n')) parts.push(new Paragraph({ children: [new TextRun({ text: line, font: 'Consolas', color: clr.body, size: 18 })], spacing: { before: 0, after: 0 } }));
            }
          } else if (cell.live && typeof cell.live === 'object') {
            const pretty = JSON.stringify(cell.live, null, 2);
            for (const line of pretty.split('\n')) parts.push(new Paragraph({ children: [new TextRun({ text: line, font: 'Consolas', color: clr.body, size: 18 })], spacing: { before: 0, after: 0 } }));
          } else {
            parts.push(new Paragraph({ children: [new TextRun({ text: esc(String(cell.live ?? '—')), color: clr.body, size: 20 })], spacing: { before: 0, after: 0 } }));
          }

          cellParagraphs = parts;
        } else if (cell.displayName || cell.userPrincipalName || cell.id) {
          // Single person object
          const text = cell.displayName ? `${cell.displayName}${cell.userPrincipalName ? ` (${cell.userPrincipalName})` : ''}` : (cell.userPrincipalName || cell.id || '');
          cellParagraphs = [new Paragraph({ children: [new TextRun({ text: text, color: clr.body, size: 20 })] })];
        } else {
          const pretty = JSON.stringify(cell, null, 2);
          cellParagraphs = pretty.split('\n').map(line => new Paragraph({ children: [new TextRun({ text: line, font: 'Consolas', color: clr.body, size: 18 })], spacing: { before: 0, after: 0 } }));
        }
      } else {
        const raw = String(cell);
        const trimmed = raw.trim();
        if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
          try {
            const parsed = JSON.parse(raw);
            const pretty = JSON.stringify(parsed, null, 2);
            cellParagraphs = pretty.split('\n').map(line => new Paragraph({
              children: [new TextRun({ text: line, font: 'Consolas', color: clr.body, size: 18 })],
              spacing: { before: 0, after: 0 },
            }));
          } catch (e) {
            cellParagraphs = [new Paragraph({ children: [new TextRun({ text: esc(raw), color: clr.body, size: 20 })] })];
          }
        } else {
          cellParagraphs = [new Paragraph({ children: [new TextRun({ text: esc(raw), color: clr.body, size: 20 })] })];
        }
      }

      return new TableCell({
        width: { size: colWidths[ci], type: WidthType.DXA },
        shading: { type: ShadingType.SOLID, color: bg, fill: bg },
        borders: { top: { color: clr.border, size: 4, style: BorderStyle.SINGLE, space: 0 },
                   bottom: { color: clr.border, size: 4, style: BorderStyle.SINGLE, space: 0 },
                   left:   { color: clr.border, size: 4, style: BorderStyle.SINGLE, space: 0 },
                   right:  { color: clr.border, size: 4, style: BorderStyle.SINGLE, space: 0 } },
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        children: cellParagraphs,
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

// ── Tenant report ─────────────────────────────────────────────────────────────

async function renderTenantReportDocx(data, mssp = {}) {
  const { meta, summary, driftHistory, remediationLog, baselineCoverage, configState } = data;

  const companyName     = mssp.companyName || 'TrustM365';
  const tagline         = mssp.tagline     || '';
  const commentaryLabel = companyName !== 'TrustM365' ? `${companyName} Commentary` : 'MSSP Commentary';
  const clr             = buildCLR(mssp.reportAccent);

  // Accept both legacy and current assembler payload shapes.
  const remediationItems = remediationLog.items || remediationLog.actions || [];
  const remSucceeded = remediationLog.succeeded ?? remediationItems.filter(a => a.success === true || a.status === 'ok').length;
  const remFailed = remediationLog.failed ?? remediationItems.filter(a => a.success === false || a.status === 'failed').length;
  const remAuto = remediationLog.auto ?? remediationLog.autoRestored ?? remediationItems.filter(a => a.trigger === 'Auto-restore').length;

  const baselineAreas = Array.isArray(baselineCoverage)
    ? baselineCoverage
    : (baselineCoverage.areas || []);
  const baselineTotal = baselineCoverage.totalAreas ?? baselineAreas.length;
  const baselineMonitored = baselineCoverage.monitored ?? baselineAreas.filter(a => a.hasBaseline).length;
  const baselineClean = baselineCoverage.clean ?? baselineAreas.filter(a => (a.currentStatus || a.driftStatus) === 'clean').length;
  const baselineDrifted = baselineCoverage.drifted ?? baselineAreas.filter(a => (a.currentStatus || a.driftStatus) === 'drifted').length;
  const baselineNoBaseline = baselineCoverage.noBaseline ?? (baselineTotal - baselineMonitored);

  const COVERAGE_GROUPS = [
    {
      label: 'Microsoft Entra ID',
      keys: ['entra_roles', 'entra_users', 'entra_groups', 'entra_apps', 'entra_auth_policies', 'entra_ca'],
    },
    {
      label: 'Exchange Online',
      keys: ['exchange_mailboxes', 'exchange_connectors', 'exchange_transport_rules', 'exchange_mailbox_security'],
    },
    {
      label: 'Microsoft Intune - Policy Management',
      keys: ['intune_compliance', 'intune_config_profiles', 'intune_update_rings', 'intune_mtd_connectors', 'intune_app_protection'],
    },
    {
      label: 'Microsoft Intune - Endpoint Security',
      keys: ['intune_ep_antivirus', 'intune_ep_firewall', 'intune_ep_disk_encryption', 'intune_ep_asr'],
    },
    {
      label: 'SharePoint',
      keys: ['sharepoint_sites', 'sharepoint_tenant_settings'],
    },
    {
      label: 'Microsoft Teams',
      keys: ['teams_membership', 'teams_policies_meetings', 'teams_policies_messaging', 'teams_app_permission_policies', 'teams_channels_policies', 'teams_org_app_settings'],
    },
  ];
  const groupByArea = new Map();
  COVERAGE_GROUPS.forEach(g => g.keys.forEach(k => groupByArea.set(k, g.label)));

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
          // pass raw values (may be objects/arrays) — dataTable will pretty-print
          p.baselineValue,
          p.liveValue,
          fmtTs(ev.checkedAt),
        ])
  );

  // ── Remediation rows ──────────────────────────────────────────────────────
  const remRows = remediationItems.map(a => [
    a.areaName     || '—',
    a.resourceName || '—',
    a.propertyLabel || a.propertyPath || 'Full resource',
    a.trigger      || '—',
    (a.success === true || a.status === 'ok') ? '✓ OK' : '✗ Failed',
    fmtTs(a.restoredAt),
  ]);

  // ── Coverage rows ─────────────────────────────────────────────────────────
  const coverageRows = baselineAreas.map(a => {
    const areaKey = a.areaKey || a.key;
    const status = a.currentStatus || a.driftStatus;
    return [
      groupByArea.get(areaKey) || 'Additional Areas',
      a.areaName || a.displayName || areaKey || '—',
      a.hasBaseline ? 'Monitored' : 'No baseline set',
      a.hasBaseline ? (status === 'clean' ? 'Clean' : status === 'drifted' ? 'Drifted' : 'No data') : 'No data',
      a.lastChecked ? fmtTs(a.lastChecked) : '—',
    ];
  });

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
          // combine baseline+live into a single object so docx cell shows both pretty-printed
          { baseline: p.baselineValue, live: p.liveValue },
          fmtTs(ev.checkedAt),
        ])
  );
  const allRemRows = (remediationLog.allActions || remediationItems).map(a => [
    a.areaName || '—', a.resourceName || '—',
    a.propertyLabel || 'Full',
    a.trigger  || '—',
    (a.success === true || a.status === 'ok') ? '✓ OK' : '✗ Failed',
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
        { label: 'Total',         value: remSucceeded + remFailed, color: clr.accent },
        { label: 'Succeeded',     value: remSucceeded, color: clr.green },
        { label: 'Failed',        value: remFailed, color: remFailed > 0 ? clr.red : clr.muted },
        { label: 'Auto-restored', value: remAuto, color: clr.accent },
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
        { label: 'Total Areas',  value: baselineTotal, color: clr.accent },
        { label: 'Monitored',    value: baselineMonitored, color: clr.accent },
        { label: 'Clean',        value: baselineClean, color: clr.green },
        { label: 'Drifted',      value: baselineDrifted, color: clr.red },
        { label: 'No Baseline',  value: baselineNoBaseline, color: clr.muted },
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

          // Exchange mailbox summary
          if (res.mailboxSettings || (Array.isArray(res.forwardingRules) && res.forwardingRules.length > 0) || (Array.isArray(res.messageRules) && res.messageRules.length > 0) || res.inferenceClassification) {
            areaNodes.push(heading3('Mailbox Summary', clr));
            areaNodes.push(kv('Time zone', res.mailboxSettings?.timeZone ?? '—', clr));
            if (res.mailboxSettings?.automaticRepliesSetting) {
              const ars = res.mailboxSettings.automaticRepliesSetting;
              const arsText = `${ars.status ?? '—'}${ars.externalAudience ? ' · ' + ars.externalAudience : ''}`;
              areaNodes.push(kv('Automatic replies', arsText, clr));
            }

            if (Array.isArray(res.forwardingRules) && res.forwardingRules.length > 0) {
              areaNodes.push(heading3('Forwarding Rules', clr));
              areaNodes.push(...dataTable(
                ['Rule', 'Details'],
                res.forwardingRules.map(fr => [fr.displayName || fr.id || JSON.stringify(fr), fr]),
                clr
              ));
            }

            if (Array.isArray(res.messageRules) && res.messageRules.length > 0) {
              areaNodes.push(heading3('Inbox Message Rules', clr));
              areaNodes.push(...dataTable(
                ['Name', 'Details'],
                res.messageRules.map(mr => [mr.displayName || mr.id || JSON.stringify(mr), mr]),
                clr
              ));
            }

            if (res.inferenceClassification) {
              areaNodes.push(heading3('Inference Classification', clr));
              areaNodes.push(...dataTable(
                ['Field', 'Value'],
                Object.keys(res.inferenceClassification).map(k => [k, res.inferenceClassification[k]]),
                clr
              ));
            }
          }

          // SharePoint external-sharing signals
          if (res.externalShareCount || res.anonymousLinkCount || (Array.isArray(res.topExternallyShared) && res.topExternallyShared.length > 0) || (Array.isArray(res.externalShareSamples) && res.externalShareSamples.length > 0)) {
            areaNodes.push(heading3('External Sharing', clr));
            areaNodes.push(kv('External shares', res.externalShareCount ?? '0', clr));
            areaNodes.push(kv('Anonymous links', res.anonymousLinkCount ?? '0', clr));

            if (Array.isArray(res.externalShareSamples) && res.externalShareSamples.length > 0) {
              areaNodes.push(heading3('External Share Samples', clr));
              areaNodes.push(...dataTable(
                ['Item', 'Details'],
                res.externalShareSamples.map(s => [s.webUrl || s.displayName || JSON.stringify(s), s]),
                clr
              ));
            }

            if (Array.isArray(res.topExternallyShared) && res.topExternallyShared.length > 0) {
              areaNodes.push(heading3('Top Externally Shared Items', clr));
              areaNodes.push(...dataTable(
                ['Item', 'Roles', 'Site'],
                res.topExternallyShared.map(it => [it.webUrl || it.displayName || JSON.stringify(it), (it.roles || []).join(', '), it.siteName || '']),
                clr
              ));
            }
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
