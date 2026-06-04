const http = require('http');
const id = process.argv[2];
if (!id) { console.error('Usage: node scripts/get_job.js <jobId>'); process.exit(2); }
const options = { hostname: '127.0.0.1', port: 3001, path: `/api/jobs/${id}`, method: 'GET', headers: { Accept: 'application/json' } };
const req = http.request(options, (res) => { let body=''; res.setEncoding('utf8'); res.on('data', c=>body+=c); res.on('end', ()=>{ try{console.log(JSON.stringify(JSON.parse(body), null, 2))}catch(e){console.log(body)} }); });
req.on('error', (e)=>{console.error('err',e)}); req.end();
