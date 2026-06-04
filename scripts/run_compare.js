const http = require('http');

const data = JSON.stringify({ tenantId: '156a0407-c859-4078-b33b-33a785540599', scan: true });

const options = {
  hostname: '127.0.0.1',
  port: 3001,
  path: '/api/reference-templates/win-oib-defender-antivirus-d-av-configuration-v3-3/compare',
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
