const http = require('http');
const body = JSON.stringify({ tenantId: '3c1b8875-f88f-4367-93a1-06b9cf42ddc9', scan: true });
const options = { hostname: '127.0.0.1', port: 3001, path: '/api/reference-templates/win-oib-compliance-u-defender-for-endpoint-v3-1/compare', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } };
const req = http.request(options, (res) => {
  let out = '';
  res.setEncoding('utf8');
  res.on('data', c => out += c);
  res.on('end', () => { try { console.log(JSON.stringify(JSON.parse(out), null, 2)); } catch (e) { console.log(out); }});
});
req.on('error', (e) => console.error('Err', e));
req.write(body);
req.end();
