const http = require('http');

function get(path) {
  return new Promise((resolve, reject) => {
    const options = { hostname: '127.0.0.1', port: 3001, path, method: 'GET', headers: { Accept: 'application/json' } };
    const req = http.request(options, (res) => {
      let body = ''; res.setEncoding('utf8'); res.on('data', c => body += c); res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject); req.end();
  });
}

function post(path, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const options = { hostname: '127.0.0.1', port: 3001, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } };
    const req = http.request(options, (res) => {
      let out = ''; res.setEncoding('utf8'); res.on('data', c => out += c); res.on('end', () => {
        try { resolve(JSON.parse(out)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

async function run(tplId, tenantId) {
  console.log('Fetching template:', tplId);
  const tpl = await get(`/api/reference-templates/${encodeURIComponent(tplId)}`);
  console.log('Template area_key:', tpl.area_key || tpl.areaKey || tpl.area);
  console.log('Watched keys count:', (tpl.watched_keys || []).length);
  console.log('Sample watched keys:', (tpl.watched_keys || []).slice(0,10));

  console.log('\nPosting compare for tenant:', tenantId);
  const cmp = await post(`/api/reference-templates/${encodeURIComponent(tplId)}/compare`, { tenantId, scan: true });
  console.log('Compare summary:', cmp.summary || cmp);
  console.log('Compare items count:', (cmp.items || []).length);
  if (cmp.items && cmp.items.length) {
    console.log('First item:', JSON.stringify(cmp.items[0], null, 2));
  }

  const areaKey = tpl.area_key || tpl.areaKey || tpl.area;
  if (!areaKey) { console.log('No area_key on template; skipping live fetch'); return }
  console.log('\nFetching live snapshot for area:', areaKey);
  const live = await get(`/api/areas/${tenantId}/${encodeURIComponent(areaKey)}/live`);
  console.log('Live resources count:', Object.keys(live.resources || {}).length);
  const keys = Object.keys(live.resources || {});
  if (keys.length) {
    console.log('Sample resource id:', keys[0]);
    console.log(JSON.stringify(live.resources[keys[0]], null, 2));
  }
}

if (process.argv.length < 4) {
  console.error('Usage: node scripts/compare_inspect.js <templateId> <tenantInternalId>');
  process.exit(2);
}

run(process.argv[2], process.argv[3]).catch(err => { console.error('Error:', err); process.exit(1); });
