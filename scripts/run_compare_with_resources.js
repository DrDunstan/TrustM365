const fs = require('fs');
const http = require('http');

const tplId = process.argv[2];
const resourcesPath = process.argv[3];
if (!tplId || !resourcesPath) {
  console.error('Usage: node run_compare_with_resources.js <templateId> <path-to-live-json>');
  process.exit(1);
}

let dataObj;
try {
  const txt = fs.readFileSync(resourcesPath, 'utf8');
  const parsed = JSON.parse(txt);
  dataObj = parsed.resources || parsed;
} catch (e) {
  console.error('Failed to read resources file', e && e.message ? e.message : e);
  process.exit(1);
}

const payload = JSON.stringify({ currentResources: dataObj, scan: true });

const options = {
  hostname: '127.0.0.1',
  port: 3001,
  path: `/api/reference-templates/${encodeURIComponent(tplId)}/compare`,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  }
};

const req = http.request(options, (res) => {
  let body = '';
  res.on('data', c => body += c);
  res.on('end', () => {
    try { console.log(body); } catch (e) { console.log(body); }
  });
});
req.on('error', (err) => { console.error('Request failed', err && err.message ? err.message : err); process.exit(2); });
req.write(payload);
req.end();
