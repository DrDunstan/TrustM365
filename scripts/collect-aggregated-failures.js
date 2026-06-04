#!/usr/bin/env node
const fs = require('fs');
const base = 'http://127.0.0.1:3001';

(async () => {
  try {
    const tenantsRes = await fetch(`${base}/api/tenants`);
    if (!tenantsRes.ok) {
      console.error('Failed to fetch tenants', tenantsRes.status);
      process.exit(1);
    }
    const tenants = await tenantsRes.json();
    const tenantIds = tenants.map(t => t.id);
    const tenantsMap = Object.fromEntries(tenants.map(t => [t.id, t]));

    // Fetch all templates (all owners) for full aggregation
    const tplRes = await fetch(`${base}/api/reference-templates`);
    if (!tplRes.ok) {
      console.error('Failed to fetch templates', tplRes.status);
      process.exit(1);
    }
    const templates = await tplRes.json();
    const agg = {};

    for (const tpl of templates) {
      try {
        const res = await fetch(`${base}/api/reference-templates/${encodeURIComponent(tpl.id)}/compare-multi`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantIds })
        });
        const j = await res.json();
        if (j.error) {
          console.error('Compare-multi error for', tpl.id, JSON.stringify(j));
          continue;
        }
        const results = j.results || [];
        for (const r of results) {
          const tenantId = r.tenantId;
          const tenantName = (tenantsMap[tenantId] && tenantsMap[tenantId].display_name) || null;
          if (r.error) {
            const key = `${tpl.id}||__ERROR__`;
            agg[key] = agg[key] || { templateId: tpl.id, templateName: tpl.display_name || tpl.name || tpl.id, area_key: tpl.area_key, refId: '__ERROR__', refDisplayName: 'Collector Error', totalOccurrences: 0, matchedCount: 0, partialCount: 0, failureContexts: [] };
            agg[key].totalOccurrences += 1;
            agg[key].failureContexts.push({ tenantId, tenantName, status: 'error', detail: r.message || r.error || '' });
            continue;
          }
          const items = r.items || [];
          for (const it of items) {
            const key = `${tpl.id}||${it.refId}`;
            if (!agg[key]) agg[key] = { templateId: tpl.id, templateName: tpl.display_name || tpl.name || tpl.id, area_key: tpl.area_key, refId: it.refId, refDisplayName: it.refDisplayName || it.refId, totalOccurrences: 0, matchedCount: 0, partialCount: 0, failureContexts: [] };
            agg[key].totalOccurrences += 1;
            if (it.status === 'matched') agg[key].matchedCount += 1;
            if (it.status === 'partial') agg[key].partialCount += 1;
            if (it.status !== 'matched') {
              agg[key].failureContexts.push({
                tenantId,
                tenantName,
                status: it.status,
                note: it.note || '',
                detail: it.detail || '',
                mismatches: it.mismatches || [],
                matchedSamples: (it.matchedSamples || it.matchAll || []).map(s => ({ id: s.id, displayName: s.displayName, matchedPaths: s.matchedPaths || [] }))
              });
            }
          }
        }
      } catch (e) {
        console.error('Exception running compare-multi for', tpl.id, e.message);
      }
    }

    const arr = Object.values(agg);
    if (!fs.existsSync('tmp')) fs.mkdirSync('tmp', { recursive: true });
    const fname = 'tmp/aggregated-failures-all-owners.json';
    fs.writeFileSync(fname, JSON.stringify(arr, null, 2));
    console.log('WROTE', fname, 'entries', arr.length);
    console.log(JSON.stringify(arr.slice(0, 5), null, 2));
  } catch (e) {
    console.error('Fatal', e.message);
    process.exit(1);
  }
})();
