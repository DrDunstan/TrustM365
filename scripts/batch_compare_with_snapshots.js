#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const http = require('http');
const { initDatabase } = require('../backend/src/database/init');
const registry = require('../backend/src/referenceTemplates/registry');

if (process.argv.length < 2) {
  console.error('Usage: node scripts/batch_compare_with_snapshots.js <tenantDbId|tenantExternalId>');
  process.exit(2);
}
const tenantArg = process.argv[2];

function httpReq(method, path, body) {
  return new Promise((resolve, reject) => {
    const opts = { hostname: '127.0.0.1', port: process.env.PORT || 3001, path, method, headers: {} };
    let payload = null;
    if (body) {
      payload = JSON.stringify(body);
      opts.headers['Content-Type'] = 'application/json';
      opts.headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = http.request(opts, (res) => {
      let out = '';
      res.setEncoding('utf8');
      res.on('data', c => out += c);
      res.on('end', () => {
        try { resolve(JSON.parse(out)); } catch (e) { resolve(out); }
      });
    });
    req.on('error', (err) => reject(err));
    if (payload) req.write(payload);
    req.end();
  });
}

(async () => {
  try {
    // Prefer looking up the tenant via the running server (GET /api/tenants)
    let tenantDbId = null;
    try {
      const tenants = await httpReq('GET', '/api/tenants');
      if (Array.isArray(tenants) && tenants.length > 0) {
        const found = tenants.find(t => String(t.tenant_id) === String(tenantArg) || String(t.id) === String(tenantArg));
        if (found) tenantDbId = found.id;
      }
    } catch (e) {
      // server may be unreachable — we'll fallback to local DB
    }

    const db = await initDatabase();

    const dir = path.join(__dirname, '..', 'backend', 'data', 'reference-templates', 'open-intune-baseline');
    if (!fs.existsSync(dir)) {
      console.error('Templates dir not found:', dir);
      process.exit(1);
    }
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    if (files.length === 0) {
      console.log('No templates found');
      process.exit(0);
    }

    // If we didn't find the tenant via the server, try local DB lookup
    if (!tenantDbId) {
      const t = db.prepare('SELECT * FROM tenants WHERE id = ? OR tenant_id = ?').get(tenantArg, tenantArg);
      if (t) tenantDbId = t.id;
    }

    if (!tenantDbId) {
      console.error('Tenant not found (server and local DB):', tenantArg);
      process.exit(2);
    }

    for (const f of files) {
      const tplId = path.basename(f, '.json');
      console.log('\n=== ' + tplId + ' ===');

      const tpl = registry.getTemplate(tplId);
      if (!tpl) { console.log('Template not found in registry; skipping'); continue; }
      const areaKey = tpl.area_key || tpl.areaKey || tpl.area;
      if (!areaKey) { console.log('Template missing area_key; skipping'); continue; }

      // Try to fetch stored snapshot from the running server first (does not contact Graph)
      let resources = null;
      if (tenantDbId) {
        try {
          const live = await httpReq('GET', `/api/areas/${tenantDbId}/${encodeURIComponent(areaKey)}/live`);
          if (live && live.resources) {
            resources = live.resources;
            console.log('Using server-stored snapshot (resources):', Object.keys(resources || {}).length);
          }
        } catch (e) {
          // permission or other error — fallback to local DB
          console.log('Server live snapshot unavailable, falling back to local DB for area', areaKey);
        }
      }

      // Local DB fallback
      if (!resources) {
        const snapRow = db.prepare('SELECT * FROM live_snapshots WHERE tenant_id = ? AND area_key = ? ORDER BY pulled_at DESC LIMIT 1').get(tenantDbId, areaKey);
        if (!snapRow) { console.log('No local snapshot found for area:', areaKey); continue; }
        try { resources = JSON.parse(snapRow.resources || '{}'); } catch (e) { console.error('Failed to parse snapshot resources:', e && e.message); continue; }
        console.log('Using local DB snapshot (resources):', Object.keys(resources || {}).length);
      }

      const body = { currentResources: resources, scan: true };
      try {
        const cmp = await httpReq('POST', `/api/reference-templates/${encodeURIComponent(tplId)}/compare`, body);
        console.log('Compare summary:', cmp.summary || cmp);
        console.log('Items:', (cmp.items || []).length);
        if (cmp.items && cmp.items.length) console.log(JSON.stringify(cmp.items[0], null, 2));
      } catch (e) {
        console.error('Compare request failed:', e && e.message ? e.message : e);
      }
    }

    process.exit(0);
  } catch (err) {
    console.error('ERR', err && err.message);
    process.exit(1);
  }
})();
