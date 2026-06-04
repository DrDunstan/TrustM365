const http = require('http');
const options = { hostname: '127.0.0.1', port: 3001, path: '/api/reference-templates/reload', method: 'POST' };
const req = http.request(options, res => { let out=''; res.setEncoding('utf8'); res.on('data', c => out+=c); res.on('end', ()=>{ console.log('STATUS', res.statusCode); try{ console.log(JSON.parse(out)); } catch(e) { console.log(out); }});});
req.on('error', e => { console.error('ERR', e && e.message); process.exit(2); });
req.end();
