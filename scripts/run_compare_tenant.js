const http = require('http');

const templateId = process.argv[2];
const tenantId = process.argv[3];
if (!templateId || !tenantId) {
  console.error('Usage: node scripts/run_compare_tenant.js <templateId> <tenantInternalId>');
  process.exit(1);
}

const data = JSON.stringify({ tenantId, scan: true });

const options = {
  hostname: '127.0.0.1',
  port: 3001,
  path: `/api/reference-templates/${templateId}/compare`,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data),
  },
};

const req = http.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => {
    try {
      console.log(body);
    } catch (err) {
      console.error('Failed to parse response', err);
      console.log(body);
      process.exit(1);
    }
  });
});

req.on('error', (err) => {
  console.error('Request error', err);
  process.exit(1);
});

req.write(data);
req.end();
