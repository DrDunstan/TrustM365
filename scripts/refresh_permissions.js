const http = require('http');
const tenantId = process.argv[2];
if (!tenantId) { console.error('Usage: node scripts/refresh_permissions.js <tenantId>'); process.exit(2); }
const options = { hostname: '127.0.0.1', port: 3001, path: `/api/tenants/${tenantId}/refresh-permissions`, method: 'POST' };
const req = http.request(options, res => { let out=''; res.setEncoding('utf8'); res.on('data', c => out+=c); res.on('end', ()=>{ console.log('STATUS', res.statusCode); try{ console.log(JSON.parse(out)); } catch(e) { console.log(out); } }); });
req.on('error', e => { console.error('ERR', e && e.message); process.exit(2); });
req.end();
