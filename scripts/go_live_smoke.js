/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.GO_LIVE_BASE_URL || 'http://127.0.0.1:3001';
const API = `${BASE_URL}/api`;

function ts() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function requestJson(method, endpoint, body) {
  const res = await fetch(`${API}${endpoint}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) {}
  return { ok: res.ok, status: res.status, json, text };
}

async function run() {
  const checks = [];
  const add = (domain, name, result, note = '', expectedStatuses = null) => {
    const status = result && typeof result.status === 'number' ? result.status : 0;
    const okByExpected = Array.isArray(expectedStatuses) && expectedStatuses.length > 0
      ? expectedStatuses.includes(status)
      : null;
    checks.push({
      domain,
      name,
      ok: okByExpected === null ? Boolean(result && result.ok) : okByExpected,
      status,
      note,
      expectedStatuses: expectedStatuses || undefined,
      sample: result && result.json ? result.json : undefined,
    });
  };

  // Health
  const health = await requestJson('GET', '/health');
  add('platform', 'health', health);

  // Tenants
  const tenantsRes = await requestJson('GET', '/tenants');
  add('tenants', 'list', tenantsRes);
  const tenants = Array.isArray(tenantsRes.json) ? tenantsRes.json : [];
  const firstTenant = tenants[0] || null;
  let areaPermissionMap = {};
  if (firstTenant && firstTenant.permissions_json) {
    try {
      const parsed = JSON.parse(firstTenant.permissions_json);
      const areas = Array.isArray(parsed.areas) ? parsed.areas : [];
      areaPermissionMap = areas.reduce((acc, areaPerm) => {
        if (areaPerm && areaPerm.areaKey) acc[areaPerm.areaKey] = areaPerm;
        return acc;
      }, {});
    } catch (_) {
      areaPermissionMap = {};
    }
  }

  // Areas / Collectors (tenant scoped)
  if (firstTenant && firstTenant.id) {
    const areas = await requestJson('GET', `/areas/${firstTenant.id}`);
    add('collectors', 'list areas', areas, `tenantId=${firstTenant.id}`);

    const areaRows = Array.isArray(areas.json) ? areas.json : [];
    for (const area of areaRows) {
      if (!area || !area.area_key) continue;
      const areaKey = area.area_key;
      const areaPerm = areaPermissionMap[areaKey] || null;
      const canReadArea = area.isCustom ? true : Boolean(areaPerm && areaPerm.canRead);

      const live = await requestJson('GET', `/areas/${firstTenant.id}/${areaKey}/live`);
      add('collectors', 'get live snapshot', live, `areaKey=${areaKey}`, canReadArea ? [200, 404] : [403]);

      const drift = await requestJson('GET', `/areas/${firstTenant.id}/${areaKey}/drift`);
      add('collectors', 'get drift', drift, `areaKey=${areaKey}`, canReadArea ? [200, 404] : [403]);

      const history = await requestJson('GET', `/areas/${firstTenant.id}/${areaKey}/history`);
      add('collectors', 'get history', history, `areaKey=${areaKey}`);
    }

    const overview = await requestJson('GET', `/tenants/${firstTenant.id}/overview`);
    add('tenants', 'overview', overview, `tenantId=${firstTenant.id}`);

    const insights = await requestJson('GET', `/tenants/${firstTenant.id}/insights`);
    add('tenants', 'insights', insights, `tenantId=${firstTenant.id}`);
  } else {
    add('collectors', 'tenant-scoped checks', { ok: false, status: 0 }, 'blocked: no tenants configured');
  }

  // Reporting
  add('reports', 'list', await requestJson('GET', '/reports'));

  // Custom collectors
  add('custom-collectors', 'list', await requestJson('GET', '/custom-collectors'));

  // App registrations
  add('app-registrations', 'list', await requestJson('GET', '/app-registrations'));

  // MSSP settings
  add('mssp-settings', 'get settings', await requestJson('GET', '/mssp/settings'));

  // Security templates
  const secList = await requestJson('GET', '/security-templates');
  add('security-templates', 'list', secList);
  const firstSec = Array.isArray(secList.json) ? secList.json[0] : null;
  if (firstSec && firstSec.id) {
    add('security-templates', 'get by id', await requestJson('GET', `/security-templates/${firstSec.id}`), `templateId=${firstSec.id}`);
  }

  // Reference templates
  const refList = await requestJson('GET', '/reference-templates');
  add('reference-templates', 'list', refList);
  add('reference-templates', 'owners', await requestJson('GET', '/reference-templates/owners'));
  const firstRef = Array.isArray(refList.json) ? refList.json[0] : null;
  if (firstRef && firstRef.id) {
    add('reference-templates', 'get by id', await requestJson('GET', `/reference-templates/${firstRef.id}`), `templateId=${firstRef.id}`);
    if (firstTenant && firstTenant.id) {
      add(
        'reference-templates',
        'preflight mapping',
        await requestJson('POST', `/reference-templates/${firstRef.id}/preflight-mapping`, { tenantId: firstTenant.id }),
        `templateId=${firstRef.id}; tenantId=${firstTenant.id}`
      );
    }
  }

  const passed = checks.filter((c) => c.ok).length;
  const failed = checks.length - passed;
  const byDomain = checks.reduce((acc, c) => {
    if (!acc[c.domain]) acc[c.domain] = { total: 0, passed: 0, failed: 0 };
    acc[c.domain].total += 1;
    if (c.ok) acc[c.domain].passed += 1;
    else acc[c.domain].failed += 1;
    return acc;
  }, {});

  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    totals: { total: checks.length, passed, failed },
    byDomain,
    checks,
  };

  const outDir = path.resolve(__dirname, '../test-results/go-live-v1.1');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `api-smoke-${ts()}.json`);
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2), 'utf8');

  console.log(`Go-live smoke report written: ${outFile}`);
  console.log(`Total checks: ${checks.length} | Passed: ${passed} | Failed: ${failed}`);

  if (failed > 0) process.exitCode = 1;
}

run().catch((err) => {
  console.error('go_live_smoke failed:', err && err.message ? err.message : err);
  process.exit(1);
});
