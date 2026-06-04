const http = require('http');

const tplId = process.argv[2];
const tenantId = process.argv[3];
if (!tplId || !tenantId) {
  console.error('Usage: node compare_using_server_live.js <templateId> <tenantInternalId>');
  process.exit(1);
}

function req(method, path, data) {
  return new Promise((resolve, reject) => {
    const body = data ? JSON.stringify(data) : null;
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

async function main() {
  try {
    const tpl = await req('GET', `/api/reference-templates/${encodeURIComponent(tplId)}`);
    const areaKey = tpl.area_key || tpl.areaKey || tpl.area;
    if (!areaKey) { console.error('Template has no area_key'); process.exit(2); }

    const live = await req('GET', `/api/areas/${tenantId}/${encodeURIComponent(areaKey)}/live`);
    const resources = live.resources || {};
    const keys = Object.keys(resources || {});
    console.log('Live resource keys:', keys.slice(0,10));
    if (keys.length > 0) {
      console.log('Sample resource (first):', JSON.stringify(resources[keys[0]], null, 2));
      if (keys.length > 1) console.log('Sample resource (second):', JSON.stringify(resources[keys[1]], null, 2));
    }

    const cmp = await req('POST', `/api/reference-templates/${encodeURIComponent(tplId)}/compare`, { currentResources: resources, scan: true });
    console.log('Compare result:');
    console.log(JSON.stringify(cmp, null, 2));
  } catch (e) {
    console.error('Compare failed', e && e.message ? e.message : e);
    process.exit(1);
  }
}

main();
