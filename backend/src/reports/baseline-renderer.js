'use strict';
/**
 * baseline-renderer.js
 *
 * Renders a baseline export as a standalone HTML document.
 * Always light mode. MSSP branding applied if configured.
 *
 * Structure:
 *   Cover page — tenant, date, summary counts
 *   Per-area sections (one per baselined area):
 *     • Area header — name, label, saved date, mode, resource count
 *     • Per-resource block:
 *         - Monitored Properties table (watched fields + baseline values)
 *         - Full Configuration table (all stored fields)
 *         - EP Security: raw settingDefinitionId table (if applicable)
 */

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Timestamp formatting helper
function fmtTs(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
  } catch {
    return iso;
  }
}


function css(accentHex) {
  const accent = accentHex ? accentHex.replace('#','') : '4f46e5';
  const ac = `#${accent}`;
  return `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      font-size: 13px;
      color: #1e293b;
      background: #fff;
      line-height: 1.5;
    }
    .page { max-width: 960px; margin: 0 auto; padding: 48px 40px; }
    /* Cover */
    .cover { border-bottom: 3px solid ${ac}; padding-bottom: 32px; margin-bottom: 40px; }
    .cover-brand { font-size: 22px; font-weight: 700; color: ${ac}; margin-bottom: 4px; }
    .cover-tagline { font-size: 13px; color: #64748b; }
    .cover-title { font-size: 28px; font-weight: 700; color: #0f172a; margin: 24px 0 4px; }
    .cover-sub { font-size: 15px; color: #475569; margin-bottom: 20px; }
    .cover-meta { display: flex; gap: 32px; flex-wrap: wrap; margin-top: 16px; }
    .cover-stat { }
    .cover-stat-val { font-size: 26px; font-weight: 700; color: ${ac}; }
    .cover-stat-label { font-size: 11px; color: #94a3b8; text-transform: uppercase; letter-spacing: .05em; }
    .cover-kv { font-size: 12px; color: #64748b; margin-top: 4px; }
    .cover-kv strong { color: #334155; }
    /* Area section */
    .area { margin-bottom: 48px; }
    .area-header {
      background: ${ac};
      color: #fff;
      padding: 12px 16px;
      border-radius: 6px 6px 0 0;
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      flex-wrap: wrap;
      gap: 8px;
    }
    .area-name { font-size: 15px; font-weight: 700; }
    .area-meta { font-size: 11px; opacity: .85; }
    .area-sub {
      background: #f1f5f9;
      border: 1px solid #e2e8f0;
      border-top: none;
      padding: 8px 16px;
      border-radius: 0 0 0 0;
      font-size: 11px;
      color: #64748b;
      display: flex;
      gap: 24px;
      flex-wrap: wrap;
    }
    .area-sub strong { color: #334155; }
    /* Resource block */
    .resource {
      border: 1px solid #e2e8f0;
      border-top: none;
      padding: 16px 16px 20px;
    }
    .resource:last-child { border-radius: 0 0 6px 6px; }
    .resource-name {
      font-size: 13px;
      font-weight: 600;
      color: #0f172a;
      margin-bottom: 12px;
      padding-bottom: 6px;
      border-bottom: 1px solid #f1f5f9;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .mode-pill {
      font-size: 10px;
      font-weight: 500;
      padding: 2px 7px;
      border-radius: 99px;
      text-transform: uppercase;
      letter-spacing: .04em;
    }
    .mode-snapshot { background: #ede9fe; color: #6d28d9; }
    .mode-properties { background: #dbeafe; color: #1d4ed8; }
    .mode-none { background: #f1f5f9; color: #64748b; }
    /* Tables */
    .section-label {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: .06em;
      color: #94a3b8;
      margin: 14px 0 6px;
    }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th {
      background: #f8fafc;
      text-align: left;
      padding: 6px 10px;
      font-weight: 600;
      color: #475569;
      border: 1px solid #e2e8f0;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: .04em;
    }
    td {
      padding: 5px 10px;
      border: 1px solid #e2e8f0;
      color: #334155;
      vertical-align: top;
    }
    tr:nth-child(even) td { background: #f8fafc; }
    .val-mono { font-family: 'Consolas', 'Courier New', monospace; font-size: 11px; color: #1e293b; white-space: pre-wrap; word-break: break-word; }
    ul.val-list { margin:0; padding-left:18px; font-size:12px; color:#1e293b; }
    ul.val-list li { margin:4px 0; }
    .val-bool-true { color: #16a34a; font-weight: 600; }
    .val-bool-false { color: #dc2626; font-weight: 600; }
    .empty-msg { color: #94a3b8; font-size: 12px; font-style: italic; padding: 8px 0; }
    /* Footer */
    footer {
      margin-top: 48px;
      padding-top: 16px;
      border-top: 1px solid #e2e8f0;
      font-size: 11px;
      color: #94a3b8;
      text-align: center;
    }
    @media print {
      .page { padding: 24px; }
      .area { page-break-inside: avoid; }
      .resource { page-break-inside: avoid; }
    }
  `;
}

function valCell(val) {
  if (val === 'Yes') return `<td class="val-mono val-bool-true">Yes</td>`;
  if (val === 'No')  return `<td class="val-mono val-bool-false">No</td>`;
  if (val === null || val === undefined) return `<td class="val-mono">—</td>`;
  // Arrays: render people lists as simple bullet lists, otherwise pretty JSON
  if (Array.isArray(val)) {
    if (val.length === 0) return `<td class="val-mono">[]</td>`;
    const peopleLike = val.every(it => it && typeof it === 'object' && (it.displayName || it.userPrincipalName || it.id));
    if (peopleLike) {
      const items = val.map(it => {
        const name = it.displayName || it.userPrincipalName || it.id || '';
        return `<li>${esc(String(name))}${it.displayName && it.userPrincipalName ? ` (${esc(String(it.userPrincipalName))})` : ''}</li>`;
      }).join('');
      return `<td><ul class="val-list">${items}</ul></td>`;
    }
    try {
      const pretty = JSON.stringify(val, null, 2);
      return `<td><pre class="val-mono" style="margin:0; white-space:pre-wrap;">${esc(pretty)}</pre></td>`;
    } catch (e) {
      return `<td class="val-mono">${esc(String(val))}</td>`;
    }
  }

  if (typeof val === 'object') {
    if (val.displayName || val.userPrincipalName || val.id) {
      const text = val.displayName ? `${val.displayName}${val.userPrincipalName ? ` (${val.userPrincipalName})` : ''}` : (val.userPrincipalName || val.id || '');
      return `<td class="val-mono">${esc(text)}</td>`;
    }
    try {
      const pretty = JSON.stringify(val, null, 2);
      return `<td><pre class="val-mono" style="margin:0; white-space:pre-wrap;">${esc(pretty)}</pre></td>`;
    } catch (e) {
      return `<td class="val-mono">${esc(String(val))}</td>`;
    }
  }

  const s = String(val);
  const trimmed = s.trim();
  // If the value is JSON (object/array) encoded as a string, pretty-print it
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      const parsed = JSON.parse(s);
      const pretty = JSON.stringify(parsed, null, 2);
      return `<td><pre class="val-mono" style="margin:0; white-space:pre-wrap;">${esc(pretty)}</pre></td>`;
    } catch (e) {
      // fall back to single-line if parsing fails
    }
  }
  return `<td class="val-mono">${esc(s)}</td>`;
}

function renderResource(res) {
  const modePill = res.mode === 'snapshot'
    ? `<span class="mode-pill mode-snapshot">Snapshot</span>`
    : res.mode === 'properties'
      ? `<span class="mode-pill mode-properties">Properties</span>`
      : `<span class="mode-pill mode-none">None</span>`;

  let html = `
    <div class="resource">
      <div class="resource-name">${esc(res.displayName)} ${modePill}</div>`;

  // ── Monitored Properties ──────────────────────────────────────────────────
  html += `<div class="section-label">Monitored Properties</div>`;
  if (res.mode === 'snapshot') {
    html += `<p class="empty-msg">Snapshot mode — entire resource is hashed. Any field change triggers drift.</p>`;
  } else if (res.watchedProps.length === 0) {
    html += `<p class="empty-msg">No individual properties selected — all fields monitored via snapshot.</p>`;
  } else {
    html += `<table><thead><tr><th>Property</th><th>Path</th><th>Baseline Value</th></tr></thead><tbody>`;
    for (const wp of res.watchedProps) {
      html += `<tr>
        <td>${esc(wp.label)}</td>
        <td class="val-mono">${esc(wp.path)}</td>
        ${valCell(wp.value)}
      </tr>`;
    }
    html += `</tbody></table>`;
  }

  // ── EP Security settings ──────────────────────────────────────────────────
  if (res.epSettings) {
    html += `<div class="section-label">Settings Catalog — Settings</div>`;
    if (res.epSettings.length === 0) {
      html += `<p class="empty-msg">No settings recorded in this baseline.</p>`;
    } else {
      html += `<table><thead><tr><th>Setting</th><th>Value</th></tr></thead><tbody>`;
      for (const s of res.epSettings) {
        const display = esc(s.label || s.settingDefinitionId || '—');
        const rawId = s.settingDefinitionId ? esc(s.settingDefinitionId) : '';
        const rawHtml = (s.label && s.settingDefinitionId && s.label !== s.settingDefinitionId) ? `<div style="font-size:11px;color:#94a3b8;margin-top:4px;">${rawId}</div>` : '';
        html += `<tr>
          <td class="val-mono">${display}${rawHtml}</td>
          ${valCell(s.value)}
        </tr>`;
      }
      html += `</tbody></table>`;
    }
  }

  // ── Full Configuration ────────────────────────────────────────────────────
  html += `<div class="section-label">Full Baseline Configuration</div>`;
  if (res.fullConfig.length === 0) {
    html += `<p class="empty-msg">No configuration data stored.</p>`;
  } else {
    html += `<table><thead><tr><th>Field</th><th>Value</th></tr></thead><tbody>`;
    for (const fc of res.fullConfig) {
      html += `<tr><td class="val-mono">${esc(fc.key)}</td>${valCell(fc.value)}</tr>`;
    }
    html += `</tbody></table>`;
  }

  // ── Exchange mailbox summary (mailbox settings, forwarding/message rules)
  if (res.mailboxSettings || (Array.isArray(res.forwardingRules) && res.forwardingRules.length > 0) || (Array.isArray(res.messageRules) && res.messageRules.length > 0) || res.inferenceClassification) {
    html += `<div class="section-label">Mailbox Summary</div>`;
    if (res.mailboxSettings) {
      const tz = res.mailboxSettings.timeZone || '—';
      const ars = res.mailboxSettings.automaticRepliesSetting || null;
      const autoStatus = ars?.status ?? null;
      const autoExt = ars?.externalAudience ?? null;
      html += `<div style="display:flex;gap:16px;margin-bottom:8px;"><div><strong>Time zone:</strong> ${esc(String(tz))}</div><div><strong>Automatic Replies:</strong> ${esc(autoStatus ?? '—')}${autoExt ? ' · ' + esc(String(autoExt)) : ''}</div></div>`;
    }

    if (Array.isArray(res.forwardingRules) && res.forwardingRules.length > 0) {
      html += `<div class="section-label">Forwarding Rules</div><table><thead><tr><th>Rule</th><th>Details</th></tr></thead><tbody>`;
      for (const fr of res.forwardingRules) {
        const title = fr.displayName || fr.id || JSON.stringify(fr);
        html += `<tr><td class="val-mono">${esc(title)}</td>${valCell(fr)}</tr>`;
      }
      html += `</tbody></table>`;
    }

    if (Array.isArray(res.messageRules) && res.messageRules.length > 0) {
      html += `<div class="section-label">Inbox Message Rules</div><table><thead><tr><th>Name</th><th>Details</th></tr></thead><tbody>`;
      for (const mr of res.messageRules) {
        const title = mr.displayName || mr.id || JSON.stringify(mr);
        html += `<tr><td class="val-mono">${esc(title)}</td>${valCell(mr)}</tr>`;
      }
      html += `</tbody></table>`;
    }

    if (res.inferenceClassification) {
      html += `<div class="section-label">Inference Classification</div>`;
      html += `<table><thead><tr><th>Field</th><th>Value</th></tr></thead><tbody>`;
      for (const k of Object.keys(res.inferenceClassification || {})) {
        html += `<tr><td class="val-mono">${esc(k)}</td>${valCell(res.inferenceClassification[k])}</tr>`;
      }
      html += `</tbody></table>`;
    }
  }

  // ── External sharing summary (SharePoint signals)
  if (res.externalShareCount || res.anonymousLinkCount || (Array.isArray(res.topExternallyShared) && res.topExternallyShared.length > 0) || (Array.isArray(res.externalShareSamples) && res.externalShareSamples.length > 0)) {
    html += `<div class="section-label">External Sharing</div>`;
    html += `<div style="display:flex;gap:16px;margin-bottom:8px;"><div><strong>External shares:</strong> ${esc(String(res.externalShareCount ?? '0'))}</div><div><strong>Anonymous links:</strong> ${esc(String(res.anonymousLinkCount ?? '0'))}</div></div>`;

    if (Array.isArray(res.externalShareSamples) && res.externalShareSamples.length > 0) {
      html += `<div class="section-label">External Share Samples</div><table><thead><tr><th>Item</th><th>Details</th></tr></thead><tbody>`;
      for (const s of res.externalShareSamples) {
        const title = s.webUrl || s.displayName || s.id || JSON.stringify(s);
        html += `<tr><td class="val-mono">${esc(title)}</td>${valCell(s)}</tr>`;
      }
      html += `</tbody></table>`;
    }

    if (Array.isArray(res.topExternallyShared) && res.topExternallyShared.length > 0) {
      html += `<div class="section-label">Top Externally Shared Items</div><table><thead><tr><th>Item</th><th>Roles</th><th>Site</th></tr></thead><tbody>`;
      for (const it of res.topExternallyShared) {
        const title = it.webUrl || it.displayName || it.id || JSON.stringify(it);
        const roles = Array.isArray(it.roles) ? it.roles.join(', ') : (it.roles || '');
        const site = it.siteName || '';
        html += `<tr><td class="val-mono">${esc(title)}</td><td class="val-mono">${esc(roles)}</td><td class="val-mono">${esc(site)}</td></tr>`;
      }
      html += `</tbody></table>`;
    }
  }

  html += `</div>`; // .resource
  return html;
}

function renderArea(area) {
  if (area.error) {
    return `
      <div class="area">
        <div class="area-header">
          <span class="area-name">${esc(area.areaDisplayName)}</span>
          <span class="area-meta">Error</span>
        </div>
        <div style="padding:16px;color:#dc2626;border:1px solid #e2e8f0;border-top:none;">
          ${esc(area.error)}
        </div>
      </div>`;
  }

  const savedLabel = area.savedAt ? fmtTs(area.savedAt) : '—';

  let html = `
    <div class="area">
      <div class="area-header">
        <span class="area-name">${esc(area.areaDisplayName)}</span>
        <span class="area-meta">${area.resourceCount} resource${area.resourceCount !== 1 ? 's' : ''} · saved ${savedLabel}</span>
      </div>
      <div class="area-sub">
        <span><strong>Baseline label:</strong> ${esc(area.label)}</span>
        <span><strong>Monitor mode:</strong> ${esc(area.monitorMode)}</span>
        ${area.areaDescription ? `<span><strong>Area:</strong> ${esc(area.areaDescription)}</span>` : ''}
      </div>`;

  if (area.resources.length === 0) {
    html += `<div style="padding:16px;color:#94a3b8;border:1px solid #e2e8f0;border-top:none;">
      No resources in this baseline.
    </div>`;
  } else {
    for (const res of area.resources) {
      html += renderResource(res);
    }
  }

  html += `</div>`; // .area
  return html;
}

function renderBaselineExport(data, mssp = {}) {
  const { meta, areas } = data;
  const companyName = mssp.companyName || 'TrustM365';
  const tagline     = mssp.tagline     || '';
  const accentHex   = mssp.reportAccent || '';

  const brandBlock = mssp.logoUrl
    ? `<img src="${esc(mssp.logoUrl)}" alt="${esc(companyName)}" style="height:40px;object-fit:contain;margin-bottom:6px;">`
    : `<div class="cover-brand">${esc(companyName)}</div>`;

  const taglineHtml = tagline
    ? `<div class="cover-tagline">${esc(tagline)}</div>` : '';

  const footerText = companyName !== 'TrustM365'
    ? `${esc(companyName)}${tagline ? ' · ' + esc(tagline) : ''} — TrustM365`
    : 'TrustM365 — Monitor. Baseline. Restore.';

  const areasHtml = areas.map(renderArea).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(meta.tenantName)} — Baseline Export</title>
  <style>${css(accentHex)}</style>
</head>
<body>
<div class="page">

  <div class="cover">
    ${brandBlock}
    ${taglineHtml}
    <div class="cover-title">${esc(meta.tenantName)}</div>
    <div class="cover-sub">Baseline Configuration Export</div>
    <div class="cover-kv"><strong>Tenant ID:</strong> ${esc(meta.tenantUUID)}</div>
    <div class="cover-kv"><strong>Generated:</strong> ${fmtTs(meta.generatedAt)}</div>
    <div class="cover-meta">
      <div class="cover-stat">
        <div class="cover-stat-val">${meta.totalAreas}</div>
        <div class="cover-stat-label">Baselined Areas</div>
      </div>
      <div class="cover-stat">
        <div class="cover-stat-val">${meta.totalResources}</div>
        <div class="cover-stat-label">Total Resources</div>
      </div>
    </div>
  </div>

  ${areasHtml}

  <footer>${footerText} · ${esc(meta.tenantUUID)}</footer>
</div>
</body>
</html>`;
}

module.exports = { renderBaselineExport };
