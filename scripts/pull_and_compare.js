const http = require('http');

function req(method, path, data) {
  return new Promise((resolve, reject) => {
    let body = data ? JSON.stringify(data) : null;
    const options = { hostname: '127.0.0.1', port: 3001, path, method, headers: {} };
    if (body) { options.headers['Content-Type'] = 'application/json'; options.headers['Content-Length'] = Buffer.byteLength(body); }
    const r = http.request(options, (res) => {
      let out = '';
      res.setEncoding('utf8');
      res.on('data', c => out += c);
      res.on('end', () => {
        try { resolve(JSON.parse(out)); } catch (e) { resolve(out); }
      });
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

async function run(tplId, tenantId) {
  console.log('Fetching template...');
  const tpl = await req('GET', `/api/reference-templates/${encodeURIComponent(tplId)}`);
  const areaKey = tpl.area_key || tpl.areaKey || tpl.area;
  if (!areaKey) { console.error('Template has no area_key'); return }
  console.log('Triggering pull for area', areaKey);
  const pull = await req('POST', `/api/areas/${tenantId}/${encodeURIComponent(areaKey)}/pull`);
  console.log('Pull response:', pull);
  console.log('Waiting up to 30s for live resources...');
  const start = Date.now();
  let live = null;
  while (Date.now() - start < 30000) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      live = await req('GET', `/api/areas/${tenantId}/${encodeURIComponent(areaKey)}/live`);
      const count = Object.keys(live.resources || {}).length;
      console.log('Live resources:', count);
      if (count > 0) break;
    } catch (e) {
      // ignore
    }
  }
  if (!live) live = { resources: {} };
  console.log('Posting compare...');
  const cmp = await req('POST', `/api/reference-templates/${encodeURIComponent(tplId)}/compare`, { tenantId, scan: true });
  console.log('Compare summary:', cmp.summary || cmp);
  console.log('Items:', (cmp.items || []).length);
  if (cmp.items && cmp.items.length) console.log(JSON.stringify(cmp.items[0], null, 2));
}

if (process.argv.length < 4) { console.error('Usage: node scripts/pull_and_compare.js <templateId> <tenantInternalId>'); process.exit(2); }
run(process.argv[2], process.argv[3]).catch(err => { console.error('Err', err); process.exit(1); });
