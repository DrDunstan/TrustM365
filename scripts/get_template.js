const http = require('http');

const id = process.argv[2];
if (!id) {
  console.error('Usage: node scripts/get_template.js <templateId>');
  process.exit(2);
}

const options = {
  hostname: '127.0.0.1',
  port: 3001,
  path: `/api/reference-templates/${encodeURIComponent(id)}`,
  method: 'GET',
  headers: { 'Accept': 'application/json' }
};

const req = http.request(options, (res) => {
  let body = '';
  res.setEncoding('utf8');
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    try {
      const parsed = JSON.parse(body);
      console.log(JSON.stringify(parsed, null, 2));
    } catch (err) {
      console.error('Failed to parse response', err);
      console.log(body);
      process.exit(1);
    }
  });
});
req.on('error', (err) => { console.error('Request error', err); process.exit(1); });
req.end();
