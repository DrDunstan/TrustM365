// Timestamp formatting helper
function fmtTs(iso) {
  if (!iso) return '';
  try {
     return new Date(iso).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}
'use strict';
// Report renderer — converts assembler JSON payload into a self-contained HTML string.
// No external CSS or JS dependencies. SVG charts are inline. MSSP-branded.
// Designed for window.print() → PDF; includes @media print styles.

// ── SVG chart helpers ─────────────────────────────────────────────────────────
function barChart(days, W = 520, H = 120) {
  if (!days || Object.keys(days).length === 0) return '<p style="color:var(--text-muted);font-size:13px;">No drift data in this period.</p>';
  const entries = Object.entries(days).sort(([a],[b]) => a.localeCompare(b));
  const maxVal  = Math.max(1, ...entries.map(([,v]) => (v.drifted||0) + (v.clean||0)));
  const barW    = Math.max(8, Math.floor((W - 40) / entries.length) - 3);
  const bars    = entries.map(([day, v], i) => {
    const dH  = Math.round(((v.drifted||0) / maxVal) * (H - 30));
    const x   = 36 + i * (barW + 3);
    return `<rect x="${x}" y="${H - 22 - dH}" width="${barW}" height="${dH}" fill="#ef4444" rx="2"/>
<text x="${x + barW/2}" y="${H-8}" text-anchor="middle" font-size="9" fill="var(--text-muted)">${day.slice(5)}</text>`;
  });
  const yLabels = [0, Math.round(maxVal/2), maxVal].map(v => {
    const y = Math.round(H - 22 - (v / maxVal) * (H - 30));
    return `<text x="30" y="${y+4}" text-anchor="end" font-size="9" fill="var(--text-muted)">${v}</text>
<line x1="34" y1="${y}" x2="${W}" y2="${y}" stroke="var(--border)" stroke-width="0.5"/>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;max-width:${W}px;">
    ${yLabels.join('')}${bars.join('')}
  </svg>`;
}

function donut(value, total, color, size = 80) {
  if (!total) return '';
  const pct  = Math.min(value / total, 1);
  const r    = (size - 14) / 2;
  const circ = 2 * Math.PI * r;
  const dash = pct * circ;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="var(--bar-track)" stroke-width="10"/>
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${color}" stroke-width="10"
      stroke-dasharray="${dash} ${circ}" stroke-linecap="round"
      transform="rotate(-90 ${size/2} ${size/2})"/>
    <text x="${size/2}" y="${size/2}" dominant-baseline="middle" text-anchor="middle"
      fill="var(--text-primary)" font-size="13" font-weight="600" font-family="sans-serif">${Math.round(pct * 100)}%</text>
  </svg>`;
}

function hBar(label, value, total, color) {
  const pct = total > 0 ? Math.min(Math.round((value / total) * 100), 100) : 0;
  return `<div style="margin-bottom:8px;">
    <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px;">
      <span style="color:var(--text-muted);">${esc(label)}</span>
      <span style="color:var(--text-body);font-variant-numeric:tabular-nums;">${value?.toLocaleString() ?? '—'}</span>
    </div>
    <div style="height:6px;background:var(--bar-track);border-radius:3px;overflow:hidden;">
      <div style="height:100%;width:${pct}%;background:${color};border-radius:3px;"></div>
    </div>
  </div>`;
}

// ── HTML utilities ─────────────────────────────────────────────────────────────
function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function pill(text, color) {
  const map = {
    green:  'background:#052e16;color:#4ade80;border:1px solid #166534;',
    red:    'background:#450a0a;color:#f87171;border:1px solid #991b1b;',
    yellow: 'background:#422006;color:#fbbf24;border:1px solid #92400e;',
    gray:   'background:var(--card-bg);color:var(--text-muted);border:1px solid var(--card-border);',
    blue:   'background:#0c1a2e;color:#60a5fa;border:1px solid #1d4ed8;',
  };
  return `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:500;${map[color]||map.gray}">${esc(text)}</span>`;
}

function section(title, id, content, note, commentaryLabel = 'MSSP Commentary') {
  return `
  <div class="section" id="${id}" style="margin-bottom:32px;page-break-inside:avoid;">
    <h2>${esc(title)}</h2>
    ${content}
    ${note ? `<div style="margin-top:14px;padding:12px 14px;background:var(--card-bg);border-left:3px solid var(--accent);border-top:1px solid var(--card-border);border-right:1px solid var(--card-border);border-bottom:1px solid var(--card-border);border-radius:0 6px 6px 0;">
      <div style="font-size:11px;font-weight:600;color:var(--accent);margin-bottom:4px;text-transform:uppercase;letter-spacing:.05em;">${esc(commentaryLabel)}</div>
      <div style="font-size:13px;color:var(--text-body);line-height:1.6;">${esc(note)}</div>
    </div>` : ''}
  </div>`;
}

function table(headers, rows, emptyMsg = 'No records in this period.') {
  if (!rows.length) return `<p style="color:var(--text-muted);font-size:13px;">${esc(emptyMsg)}</p>`;
  const th = headers.map(h => `<th style="text-align:left;padding:8px 10px;font-size:11px;font-weight:600;color:var(--th-color);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border);">${esc(h)}</th>`).join('');
  const tbody = rows.map((row, i) =>
    `<tr style="background:${i%2===0?'transparent':'var(--tr-alt)'};">${row.map(cell =>
      `<td style="padding:8px 10px;font-size:12px;color:var(--text-body);border-bottom:1px solid var(--border);">${cell}</td>`
    ).join('')}</tr>`
  ).join('');
  return `<table style="width:100%;border-collapse:collapse;margin-top:8px;">
    <thead><tr>${th}</tr></thead><tbody>${tbody}</tbody>
  </table>`;
}

function statCard(label, value, color = 'var(--text-primary)', sub = '') {
  return `<div style="background:var(--card-bg);border:1px solid var(--card-border);border-radius:8px;padding:14px 16px;min-width:110px;">
    <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">${esc(label)}</div>
    <div style="font-size:26px;font-weight:700;color:${color};font-variant-numeric:tabular-nums;">${esc(String(value ?? '—'))}</div>
    ${sub ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${esc(sub)}</div>` : ''}
  </div>`;
}

// ── Theme-aware CSS builder ───────────────────────────────────────────────────
// Generates a complete CSS block with light or dark variables and the accent colour.
function buildCss(unusedTheme, accentHex) {
  // Reports are always light mode — clean, professional, print-ready.
  const accent      = accentHex || '#4f46e5';
  const accentMuted = accentHex ? accentHex + '99' : '#6366f1';
  return `
    *{box-sizing:border-box;margin:0;padding:0;}
    :root{
      --page-bg:#f8fafc; --card-bg:#ffffff; --card-border:#cbd5e1;
      --text-primary:#0f172a; --text-body:#334155; --text-muted:#64748b;
      --text-faint:#94a3b8; --border:#e2e8f0; --code-bg:#f1f5f9;
      --code-bad-bg:#fef2f2; --code-bad-color:#dc2626;
      --th-color:#64748b; --tr-alt:#f8fafc;
      --accent:${accent}; --accent-muted:${accentMuted};
      --bar-track:#e2e8f0;
    }
    body{font-family:'Segoe UI',system-ui,sans-serif;background:var(--page-bg);color:var(--text-body);line-height:1.6;}
    h1{font-size:28px;font-weight:700;color:var(--text-primary);}
    h2{font-size:18px;font-weight:600;color:var(--text-primary);border-bottom:1px solid var(--border);padding-bottom:8px;margin-bottom:16px;}
    h3{font-size:14px;font-weight:600;color:var(--text-primary);}
    p{font-size:13px;color:var(--text-muted);line-height:1.6;}
    @media print{
      .no-print{display:none!important;}
      .section{page-break-inside:avoid;}
      .page-break{page-break-before:always;}
    }
  `;
}

// ── Main render function ───────────────────────────────────────────────────────
function renderTenantReport(data, mssp = {}) {
  const { meta, summary, driftHistory, remediationLog, baselineCoverage, configState, securityControls } = data;

  // ── Branding ─────────────────────────────────────────────────────────────────
  const companyName      = mssp.companyName || 'TrustM365';
  const tagline          = mssp.tagline     || '';
  const isCustom         = companyName !== 'TrustM365';
  const commentaryLabel  = companyName !== 'TrustM365' ? `${companyName} Commentary` : 'MSSP Commentary';
  const reportCss        = buildCss(mssp.reportTheme, mssp.reportAccent);

  // Cover: logo or company name in accent colour
  const logoHtml = mssp.logoUrl
    ? `<img src="${esc(mssp.logoUrl)}" alt="${esc(companyName)}" style="height:48px;object-fit:contain;max-width:220px;margin-bottom:4px;">`
    : `<div style="font-size:24px;font-weight:700;color:var(--accent);">${esc(companyName)}</div>`;

  // Tagline shown if set
  const taglineHtml = tagline
    ? `<div style="font-size:13px;color:var(--text-muted);margin-top:2px;">${esc(tagline)}</div>`
    : '';

  // ── Section 1: Cover + Executive Summary ─────────────────────────────────────
  const statusColor = summary.driftEvents > 0 ? '#ef4444' : '#22c55e';
  const statusText  = summary.driftEvents > 0
    ? `${summary.driftEvents} drift event${summary.driftEvents !== 1 ? 's' : ''} detected during this period.`
    : 'No drift events detected. All monitored areas matched their baseline throughout this period.';
  const remText  = summary.remediations > 0 ? ` ${summary.remediations} event${summary.remediations !== 1 ? 's' : ''} were remediated.` : '';
  const monText  = `${summary.baselined} of ${summary.totalAreas} configuration area${summary.totalAreas !== 1 ? 's' : ''} monitored against a defined baseline.`;

  const cover = `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:32px;padding-bottom:24px;border-bottom:1px solid var(--border);">
      <div>
        ${logoHtml}
        ${taglineHtml}
        <h1 style="margin-top:18px;">${esc(meta.tenantName)}</h1>
        <p style="margin-top:4px;font-size:14px;color:var(--text-muted);">M365 Configuration Monitoring Report</p>
        <p style="font-size:12px;color:var(--text-faint);margin-top:2px;">Period: ${esc(meta.dateStart.slice(0,10))} → ${esc(meta.dateEnd.slice(0,10))}</p>
        <p style="font-size:12px;color:var(--text-faint);">Generated: ${fmtTs(meta.generatedAt, mssp?.timezone)}</p>
      </div>
      <div style="text-align:center;">
        ${summary.coveragePct !== null
          ? donut(summary.coveragePct, 100, summary.coveragePct === 100 ? '#22c55e' : summary.coveragePct >= 75 ? '#f59e0b' : '#ef4444', 100)
          : ''}
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">Baseline coverage</div>
      </div>
    </div>
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px;">
      ${statCard('Drift Events',    summary.driftEvents,   summary.driftEvents > 0 ? '#ef4444' : '#22c55e')}
      ${statCard('Remediated',      summary.remediations,  '#22c55e')}
      ${statCard('Outstanding',     summary.outstanding,   summary.outstanding > 0 ? '#f59e0b' : '#22c55e')}
      ${statCard('Areas Monitored', summary.baselined + ' / ' + summary.totalAreas, 'var(--accent)')}
      ${summary.coveragePct !== null ? statCard('Baseline Coverage', summary.coveragePct + '%', summary.coveragePct === 100 ? '#22c55e' : '#f59e0b') : ''}
    </div>
    <div style="background:var(--card-bg);border:1px solid var(--card-border);border-radius:8px;padding:14px 16px;margin-bottom:8px;">
      <div style="font-size:13px;color:var(--text-body);line-height:1.7;">
        <span style="color:${statusColor};font-weight:600;">${statusText}</span>${remText} ${monText}
      </div>
    </div>
  `;
  const s1 = section('Executive Summary',    'exec',    cover,        meta.notes?.exec        || '', commentaryLabel);

  // ── Section 2: Drift History ──────────────────────────────────────────────────
  const driftTableRows = driftHistory.events.flatMap(ev =>
    ev.properties.length === 0
      ? [[esc(ev.areaName), esc(ev.resourceName || '—'), '—', '—', '—', fmtTs(ev.checkedAt, mssp?.timezone)]]
      : ev.properties.flatMap(p =>
          (p.drifts || [{ path: '—', label: '—', baselineValue: '—', liveValue: '—' }]).map(d => [
            esc(ev.areaName),
            esc(p.resourceName),
            esc(d.label || d.path),
            `<code style="font-size:11px;background:var(--code-bg);padding:1px 5px;border-radius:3px;color:var(--text-body);">${esc(String(d.baselineValue ?? '—'))}</code>`,
            `<code style="font-size:11px;background:var(--code-bad-bg);padding:1px 5px;border-radius:3px;color:var(--code-bad-color);">${esc(String(d.liveValue ?? '—'))}</code>`,
            fmtTs(ev.checkedAt, mssp?.timezone),
          ])
        )
  );

  const driftContent = `
    <div style="margin-bottom:16px;">${barChart(driftHistory.byDay)}</div>
    ${table(['Area', 'Resource', 'Property', 'Baseline value', 'Detected value', 'Detected at'], driftTableRows, 'No drift events detected in this period.')}
  `;
  const s2 = section('Drift History',        'drift',       driftContent, meta.notes?.drift       || '', commentaryLabel);

  // ── Section 3: Remediation Log ────────────────────────────────────────────────
  const total = remediationLog.succeeded + remediationLog.failed;
  const remContent = `
    <div style="display:flex;align-items:flex-start;gap:24px;margin-bottom:16px;">
      ${total > 0 ? donut(remediationLog.succeeded, total, '#22c55e', 88) : ''}
      <div style="flex:1;">
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:8px;">
          ${statCard('Total actions', total)}
          ${statCard('Succeeded', remediationLog.succeeded, '#22c55e')}
          ${statCard('Failed', remediationLog.failed, remediationLog.failed > 0 ? '#ef4444' : '#6b7280')}
          ${statCard('Auto-restored', remediationLog.auto, '#818cf8')}
          ${statCard('Manual', remediationLog.manual, '#6b7280')}
        </div>
      </div>
    </div>
    ${table(
      ['Area', 'Resource', 'Property', 'Trigger', 'Result', 'Timestamp'],
      remediationLog.items.map(r => [
        esc(r.areaName),
        esc(r.resourceName),
        esc(r.propertyPath || 'Full restore'),
        pill(r.trigger, r.trigger === 'Auto-restore' ? 'blue' : 'gray'),
        pill(r.success ? 'Restored' : 'Failed', r.success ? 'green' : 'red'),
        fmtTs(r.restoredAt, mssp?.timezone),
      ]),
      'No remediation actions in this period.'
    )}
  `;
  const s3 = section('Remediation Log',      'remediation', remContent,   meta.notes?.remediation || '', commentaryLabel);

  // ── Section 4: Baseline Coverage ─────────────────────────────────────────────
  // Group areas by product and sub-category for a structured, readable layout
  const COVERAGE_GROUPS = [
    {
      label: 'Microsoft Entra ID',
      color: '#818cf8',
      keys: ['entra_roles','entra_users','entra_groups','entra_apps','entra_auth_policies','entra_ca'],
    },
    {
      label: 'Microsoft Intune — Policy Management',
      color: '#34d399',
      keys: ['intune_compliance','intune_config_profiles','intune_update_rings','intune_mtd_connectors','intune_app_protection'],
    },
    {
      label: 'Microsoft Intune — Endpoint Security',
      color: '#fb923c',
      keys: ['intune_ep_antivirus','intune_ep_firewall','intune_ep_disk_encryption','intune_ep_asr'],
    },
  ];

  const totalAreas     = baselineCoverage.length;
  const monitoredCount = baselineCoverage.filter(a => a.hasBaseline).length;
  const cleanCount     = baselineCoverage.filter(a => a.currentStatus === 'clean').length;
  const driftedCount   = baselineCoverage.filter(a => a.currentStatus === 'drifted').length;

  const coverageSummary = `
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px;">
      ${statCard('Total Areas',  totalAreas)}
      ${statCard('Monitored',    monitoredCount, '#22c55e')}
      ${statCard('Clean',        cleanCount,     '#22c55e')}
      ${statCard('Drifted',      driftedCount,   driftedCount > 0 ? '#ef4444' : '#6b7280')}
      ${statCard('No Baseline',  totalAreas - monitoredCount, '#6b7280')}
    </div>`;

  const coverageGrouped = COVERAGE_GROUPS.map(grp => {
    const areas = grp.keys.map(k => baselineCoverage.find(a => a.areaKey === k)).filter(Boolean);
    if (areas.length === 0) return '';
    const rows = areas.map(a => [
      esc(a.areaName),
      a.hasBaseline ? pill('Monitored', 'green') : pill('No baseline', 'yellow'),
      a.currentStatus === 'clean'   ? pill('Clean',   'green')
      : a.currentStatus === 'drifted' ? pill('Drifted', 'red')
      : pill('No data', 'gray'),
      a.lastChecked ? fmtTs(a.lastChecked, mssp?.timezone) : '—',
    ]);
    return `
      <div style="margin-bottom:20px;">
        <div style="font-size:12px;font-weight:600;color:${grp.color};margin-bottom:8px;
          padding-bottom:4px;border-bottom:1px solid var(--border);
          text-transform:uppercase;letter-spacing:.05em;">${esc(grp.label)}</div>
        ${table(['Area', 'Monitoring', 'Current Status', 'Last Checked'], rows)}
      </div>`;
  }).join('');

  const coverageAttest = monitoredCount > 0
    ? `<div style="margin-top:14px;padding:12px 14px;background:#0c1a0a;border-left:3px solid #22c55e;border-radius:0 6px 6px 0;font-size:12px;color:#86efac;line-height:1.6;">
        ${monitoredCount} of ${totalAreas} configuration areas across Microsoft Entra ID and Microsoft Intune
        have been continuously monitored against a defined baseline during this reporting period,
        providing evidence of ongoing security configuration management.
       </div>`
    : '';

  const s4 = section('Baseline Coverage', 'coverage',
    coverageSummary + coverageGrouped + coverageAttest,
    meta.notes?.coverage || '', commentaryLabel);

  // ── Section 5: Current Configuration State ───────────────────────────────────
  const cs = configState;
  const groups = cs.groups;
  const apps   = cs.apps;
  const totalValid = apps ? Math.max(0, apps.total - (apps.expired||0) - (apps.expiringSoon||0)) : 0;
  const devTotal   = cs.devices?.total ?? null;

  const configContent = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
      <div>
        <h3 style="margin-bottom:10px;">Users &amp; Guests</h3>
        ${cs.users ? `
          ${hBar('Members',  cs.users.members,  cs.users.total, '#22c55e')}
          ${hBar('Guests',   cs.users.guests,   cs.users.total, '#f59e0b')}
          ${hBar('Disabled', cs.users.disabled, cs.users.total, '#6b7280')}
          ${cs.users.guestPercent > 20 ? `<p style="color:#fbbf24;font-size:12px;margin-top:6px;">⚠ ${cs.users.guestPercent}% guest ratio — review external access policy.</p>` : ''}
        ` : '<p>No user data available — sync this tenant to populate.</p>'}
      </div>
      <div>
        <h3 style="margin-bottom:10px;">Groups ${groups ? `(${groups.total} total)` : ''}</h3>
        ${groups ? `
          ${hBar('Security',              groups.security||0,             groups.total, '#60a5fa')}
          ${hBar('Microsoft 365',         groups.m365||0,                 groups.total, '#818cf8')}
          ${hBar('Mail-enabled security', groups.mailEnabledSecurity||0,  groups.total, '#34d399')}
          ${hBar('Distribution',          groups.distribution||0,         groups.total, '#a78bfa')}
        ` : '<p>No group data available.</p>'}
      </div>
      <div>
        <h3 style="margin-bottom:10px;">App Registrations ${apps ? `(${apps.total} total)` : ''}</h3>
        ${apps ? `
          ${hBar('Credentials valid',   totalValid,              apps.total, '#22c55e')}
          ${hBar('Expiring (30 days)',  apps.expiringSoon||0,    apps.total, '#f59e0b')}
          ${hBar('Expired',            apps.expired||0,          apps.total, '#ef4444')}
          ${(apps.expired||0) > 0 ? `<p style="color:#f87171;font-size:12px;margin-top:6px;">⚠ ${apps.expired} expired credential${apps.expired!==1?'s':''} — update to prevent auth failures.</p>` : ''}
        ` : '<p>No app registration data available.</p>'}
      </div>
      <div>
        <h3 style="margin-bottom:10px;">Devices ${devTotal !== null ? `(${devTotal} total)` : ''}</h3>
        ${cs.devices && devTotal !== null ? `
          ${hBar('AAD Joined',    cs.devices.joined||0,      devTotal, '#60a5fa')}
          ${hBar('Hybrid Joined', cs.devices.hybrid||0,      devTotal, '#818cf8')}
          ${hBar('Registered',    cs.devices.registered||0,  devTotal, '#9ca3af')}
        ` : '<p>No device data available.</p>'}
      </div>
    </div>
  `;
  const s5 = section('Current Configuration State', 'config', configContent, meta.notes?.config || '', commentaryLabel);

  // ── Section 6: Technical Appendix ────────────────────────────────────────────
  const appendixContent = `
    <p style="font-size:12px;color:#6b7280;margin-bottom:12px;">Complete audit record for this tenant during the reporting period. For internal and auditor use.</p>
    <h3 style="margin-bottom:8px;font-size:13px;">All drift results</h3>
    ${table(
      ['Area', 'Resource', 'Property', 'Baseline', 'Live', 'Detected at'],
      driftHistory.events.flatMap(ev =>
        ev.properties.flatMap(p =>
          (p.drifts||[]).map(d => [
            esc(ev.areaName), esc(p.resourceName), esc(d.path),
            `<code style="font-size:10px;">${esc(String(d.baselineValue??'—'))}</code>`,
            `<code style="font-size:10px;">${esc(String(d.liveValue??'—'))}</code>`,
            fmtTs(ev.checkedAt, mssp?.timezone),
          ])
        )
      ),
      'No drift events.'
    )}
    <h3 style="margin-bottom:8px;margin-top:16px;font-size:13px;">All restore actions</h3>
    ${table(
      ['Area', 'Resource', 'Property', 'Old value', 'New value', 'Trigger', 'Result', 'Timestamp'],
      remediationLog.items.map(r => [
        esc(r.areaName), esc(r.resourceName), esc(r.propertyPath||'Full restore'),
        `<code style="font-size:10px;">${esc(r.oldValue??'—')}</code>`,
        `<code style="font-size:10px;">${esc(r.newValue??'—')}</code>`,
        esc(r.trigger),
        pill(r.success?'Restored':'Failed', r.success?'green':'red'),
        fmtTs(r.restoredAt, mssp?.timezone),
      ]),
      'No restore actions.'
    )}
  `;
  const s6 = `<div class="page-break"></div>${section('Technical Appendix — Audit Trail', 'appendix', appendixContent)}`;

  // Footer: company name prominent, "Powered by TrustM365" subtle credit only when white-labelled
  const footerLeft  = isCustom
    ? `${esc(companyName)}${tagline ? ' · ' + esc(tagline) : ''}`
    : 'TrustM365 — Monitor. Baseline. Restore.';
  const footerRight = isCustom
    ? `<span style="color:var(--text-faint);font-size:10px;">Powered by TrustM365</span> · ${esc(meta.tenantUUID)}`
    : esc(meta.tenantUUID);

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
    <title>${esc(meta.tenantName)} — ${esc(companyName)} Report</title>
    <style>${buildCss(mssp.reportTheme, mssp.reportAccent)}</style>
  </head><body>
    <div style="max-width:900px;margin:0 auto;padding:32px 24px;">
      ${s1}${s2}${s3}${s4}
      <div class="page-break"></div>
      ${s5}${s6}
      <div style="margin-top:32px;padding-top:16px;border-top:1px solid var(--border);font-size:11px;color:var(--text-muted);display:flex;justify-content:space-between;align-items:center;">
        <span>${footerLeft}</span>
        <span>${footerRight}</span>
      </div>
    </div>
  </body></html>`;
}

function renderPortfolioReport(data, mssp = {}) {
  const { meta, summary, tenants } = data;

  const companyName     = mssp.companyName || 'TrustM365';
  const tagline         = mssp.tagline     || '';
  const isCustom        = companyName !== 'TrustM365';
  const commentaryLabel = companyName !== 'TrustM365' ? `${companyName} Commentary` : 'MSSP Commentary';

  const logoHtml = mssp.logoUrl
    ? `<img src="${esc(mssp.logoUrl)}" alt="${esc(companyName)}" style="height:44px;object-fit:contain;max-width:200px;margin-bottom:4px;">`
    : `<div style="font-size:22px;font-weight:700;color:var(--accent);">${esc(companyName)}</div>`;

  const taglineHtml = tagline
    ? `<div style="font-size:12px;color:var(--text-muted);margin-top:2px;">${esc(tagline)}</div>` : '';

  const heatmap = tenants.map(t => {
    const hasDrift  = t.summary.driftEvents > 0;
    const hasBase   = t.summary.baselined > 0;
    const bg     = hasDrift ? '#450a0a' : hasBase ? '#052e16' : 'var(--card-bg)';
    const border = hasDrift ? '#991b1b' : hasBase ? '#166534' : 'var(--card-border)';
    const color  = hasDrift ? '#fca5a5' : hasBase ? '#86efac' : 'var(--text-muted)';
    return `<div style="background:${bg};border:1px solid ${border};border-radius:6px;padding:10px 12px;min-width:160px;">
      <div style="font-size:12px;font-weight:600;color:${color};margin-bottom:4px;">${esc(t.meta.tenantName)}</div>
      <div style="font-size:11px;color:var(--text-muted);">
        ${hasDrift ? `⚠ ${t.summary.driftEvents} drift${t.summary.driftEvents!==1?'s':''}` : '✓ Clean'}
        · ${t.summary.baselined}/${t.summary.totalAreas} monitored
      </div>
    </div>`;
  }).join('');

  const tenantRows = tenants.map(t => [
    esc(t.meta.tenantName),
    t.summary.driftEvents > 0 ? pill(`${t.summary.driftEvents} events`, 'red') : pill('Clean', 'green'),
    String(t.summary.remediations),
    String(t.summary.outstanding),
    t.summary.coveragePct !== null ? t.summary.coveragePct + '%' : '—',
    String(t.summary.baselined) + ' / ' + String(t.summary.totalAreas),
  ]);

  const portfolioContent = `
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px;">
      ${statCard('Tenants',           summary.tenantCount)}
      ${statCard('Drifted tenants',   summary.driftedTenants,  summary.driftedTenants > 0 ? '#ef4444' : '#22c55e')}
      ${statCard('Total drift events', summary.totalDrifts,    summary.totalDrifts > 0 ? '#ef4444' : '#22c55e')}
      ${statCard('Remediations',      summary.totalFixed,      '#22c55e')}
    </div>
    <h3 style="margin-bottom:10px;">Tenant health overview</h3>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px;">${heatmap}</div>
    ${table(['Tenant', 'Drift status', 'Remediated', 'Outstanding', 'Coverage', 'Monitored areas'], tenantRows)}
  `;

  const tenantSections = tenants.map(t => `
    <div class="page-break"></div>
    <h2 style="font-size:20px;margin-bottom:4px;">${esc(t.meta.tenantName)}</h2>
    <p style="font-size:12px;color:var(--text-muted);margin-bottom:16px;">${esc(t.meta.tenantUUID)}</p>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px;">
      ${statCard('Drift events', t.summary.driftEvents, t.summary.driftEvents > 0 ? '#ef4444' : '#22c55e')}
      ${statCard('Remediated',   t.summary.remediations, '#22c55e')}
      ${statCard('Coverage',     t.summary.coveragePct !== null ? t.summary.coveragePct + '%' : '—', 'var(--accent)')}
    </div>
    ${t.driftHistory.events.length > 0 ? `
      <h3 style="margin-bottom:8px;">Drift events</h3>
      ${table(['Area','Resource','Property','Baseline','Live','Detected at'],
        t.driftHistory.events.flatMap(ev => ev.properties.flatMap(p =>
          (p.drifts||[]).map(d => [
            esc(ev.areaName), esc(p.resourceName), esc(d.label||d.path),
            `<code style="font-size:11px;background:var(--code-bg);padding:1px 4px;border-radius:3px;">${esc(String(d.baselineValue??'—'))}</code>`,
            `<code style="font-size:11px;background:var(--code-bad-bg);color:var(--code-bad-color);padding:1px 4px;border-radius:3px;">${esc(String(d.liveValue??'—'))}</code>`,
            fmtTs(ev.checkedAt, mssp?.timezone)
          ])
        )), 'No drift events.'
      )}` : `<p style="color:#22c55e;font-size:13px;">✓ No drift events in this period.</p>`
    }
  `).join('');

  const footerCenter = isCustom
    ? `${esc(companyName)}${tagline ? ' · ' + esc(tagline) : ''} &nbsp;·&nbsp; <span style="color:var(--text-faint);font-size:10px;">Powered by TrustM365</span> &nbsp;·&nbsp; ${new Date(meta.generatedAt).toLocaleDateString()}`
    : `TrustM365 — Monitor. Baseline. Restore. &nbsp;·&nbsp; ${new Date(meta.generatedAt).toLocaleDateString()}`;

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
    <title>Portfolio Report — ${esc(companyName)} — ${esc(meta.dateStart.slice(0,10))}</title>
    <style>${buildCss(mssp.reportTheme, mssp.reportAccent)}</style>
  </head><body>
    <div style="max-width:960px;margin:0 auto;padding:32px 24px;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:32px;padding-bottom:24px;border-bottom:1px solid var(--border);">
        <div>
          ${logoHtml}${taglineHtml}
          <h1 style="margin-top:16px;">Portfolio Report</h1>
          <p style="font-size:13px;color:var(--text-muted);margin-top:4px;">Period: ${esc(meta.dateStart.slice(0,10))} → ${esc(meta.dateEnd.slice(0,10))}</p>
          <p style="font-size:12px;color:var(--text-faint);">Generated: ${fmtTs(meta.generatedAt, mssp?.timezone)}</p>
        </div>
      </div>
      ${section('Portfolio Summary', 'portfolio', portfolioContent, meta.notes?.portfolio || '', commentaryLabel)}
      ${tenantSections}
      <div style="margin-top:32px;padding-top:16px;border-top:1px solid var(--border);font-size:11px;color:var(--text-muted);text-align:center;">
        ${footerCenter}
      </div>
    </div>
  </body></html>`;
}

module.exports = { renderTenantReport, renderPortfolioReport };
