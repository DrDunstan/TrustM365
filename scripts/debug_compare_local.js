const http = require('http');

const tplId = process.argv[2];
const tenantId = process.argv[3];
if (!tplId || !tenantId) { console.error('Usage: node debug_compare_local.js <templateId> <tenantId>'); process.exit(1); }

function req(method, path, data) {
  return new Promise((resolve, reject) => {
    const body = data ? JSON.stringify(data) : null;
    const options = { hostname: '127.0.0.1', port: 3001, path, method, headers: {} };
    if (body) { options.headers['Content-Type'] = 'application/json'; options.headers['Content-Length'] = Buffer.byteLength(body); }
    const r = http.request(options, (res) => {
      let out = '';
      res.setEncoding('utf8');
      res.on('data', c => out += c);
      res.on('end', () => { try { resolve(JSON.parse(out)); } catch (e) { resolve(out); } });
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

function getByPath(obj, pathStr) {
  if (!pathStr) return undefined;
  const parts = pathStr.split('.');
  let cur = obj;
  for (let p of parts) {
    if (cur === undefined || cur === null) return undefined;
    const sel = p.match(/^([^\[]+)\[([^=]+)=([^\]]+)\]$/);
    if (sel) {
      const prop = sel[1];
      const idProp = sel[2];
      const idVal = sel[3];
      cur = cur[prop];
      if (!Array.isArray(cur)) return undefined;
      const found = cur.find(el => String((el && el[idProp]) ?? '') === String(idVal));
      cur = found;
      continue;
    }
    if (Array.isArray(cur) && /^[0-9]+$/.test(p)) {
      cur = cur[Number(p)];
    } else {
      cur = cur[p];
    }
  }
  return cur;
}

async function main() {
  const tpl = await req('GET', `/api/reference-templates/${encodeURIComponent(tplId)}`);
  console.log('Template watched_keys:', tpl.watched_keys);
  const live = await req('GET', `/api/areas/${tenantId}/${encodeURIComponent(tpl.area_key)}/live`);
  const resources = live.resources || {};
  const keys = Object.keys(resources);
  console.log('Live resource ids:', keys);

  for (const wk of tpl.watched_keys || []) {
    console.log('--- watched key', wk.path);
    console.log('ref path value =', getByPath(tpl.resources[Object.keys(tpl.resources)[0]], wk.path));
    for (const id of keys) {
      const r = resources[id];
      console.log(`live[${id}] ->`, getByPath(r, wk.path));
    }
  }
}

main().catch(e => { console.error('Err', e); process.exit(1); });
