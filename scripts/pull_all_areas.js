#!/usr/bin/env node
const http = require('http');
const { initDatabase } = require('../backend/src/database/init');

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

async function main() {
  const tenantArg = process.argv[2];
  if (!tenantArg) { console.error('Usage: node scripts/pull_all_areas.js <tenantDbId|tenantExternalId>'); process.exit(2); }

  // Try to resolve tenant DB id via running server first
  let tenantDbId = null;
  try {
    const tenants = await httpReq('GET', '/api/tenants');
    if (Array.isArray(tenants)) {
      const found = tenants.find(t => String(t.tenant_id) === String(tenantArg) || String(t.id) === String(tenantArg));
      if (found) tenantDbId = found.id;
    }
  } catch (e) {
    // ignore — server may be unreachable; fallback to local DB
  }

  // Fallback to local DB lookup
  if (!tenantDbId) {
    try {
      const db = await initDatabase();
      const t = db.prepare('SELECT * FROM tenants WHERE id = ? OR tenant_id = ?').get(tenantArg, tenantArg);
      if (t) tenantDbId = t.id;
    } catch (e) {
      // ignore
    }
  }

  if (!tenantDbId) { console.error('Tenant not found (server and local DB):', tenantArg); process.exit(2); }
  console.log('Using tenant DB id:', tenantDbId);

  // Fetch area list from server (preferred)
  let areas = null;
  try {
    areas = await httpReq('GET', `/api/areas/${tenantDbId}`);
    if (!Array.isArray(areas)) areas = null;
  } catch (e) { areas = null; }

  // Fallback: read from local DB
  if (!areas) {
    try {
      const db = await initDatabase();
      areas = db.prepare('SELECT * FROM resource_areas WHERE tenant_id = ? ORDER BY display_name').all(tenantDbId);
    } catch (e) { areas = null; }
  }

  if (!areas || areas.length === 0) { console.error('No resource areas found for tenant:', tenantDbId); process.exit(1); }

  for (const a of areas) {
    const areaKey = a.area_key || a.areaKey || a.area;
    if (!areaKey) continue;
    console.log('\nTriggering pull for area', areaKey);
    try {
      const res = await httpReq('POST', `/api/areas/${tenantDbId}/${encodeURIComponent(areaKey)}/pull`);
      console.log('Pull response:', res);
    } catch (err) {
      console.error('Pull failed for', areaKey, '-', err && err.message ? err.message : err);
    }
  }

  console.log('\nAll pull requests submitted. Poll /api/jobs/:jobId for progress or check /api/areas/:tenantId/:areaKey/live after completion.');
}

main().catch(err => { console.error(err && err.message ? err.message : err); process.exit(1); });
