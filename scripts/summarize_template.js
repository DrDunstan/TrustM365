const http = require('http');

const id = process.argv[2];
if (!id) { console.error('Usage: node scripts/summarize_template.js <templateId>'); process.exit(2); }

const opts = {
  hostname: '127.0.0.1',
  port: 3001,
  path: `/api/reference-templates/${encodeURIComponent(id)}`,
  method: 'GET',
  headers: { 'Accept': 'application/json' }
};

const req = http.request(opts, (res) => {
  let body = '';
  res.setEncoding('utf8');
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    try {
      const p = JSON.parse(body);
      const wk = Array.isArray(p.watched_keys) ? p.watched_keys : [];
      const resources = p.resources || {};
      const resKeys = Object.keys(resources);
      const firstRes = resKeys.length ? resources[resKeys[0]] : null;
      const out = {
        id: p.id,
        display_name: p.display_name || p.template_id || p.displayName || null,
        area_key: p.area_key || null,
        watched_keys_count: wk.length,
        watched_keys_sample: wk.slice(0, 5),
        resources_count: resKeys.length,
        resources_keys: resKeys,
        first_resource_id: firstRes ? firstRes.id : null,
        first_resource_settings_count: firstRes && Array.isArray(firstRes.settings) ? firstRes.settings.length : 0,
        first_resource_settings_sample: firstRes && Array.isArray(firstRes.settings) ? firstRes.settings.slice(0, 5) : []
      };
      console.log(JSON.stringify(out, null, 2));
    } catch (err) {
      console.error('Failed to parse or summarise response', err);
      console.log(body);
      process.exit(1);
    }
  });
});
req.on('error', (err) => { console.error('Request error', err); process.exit(1); });
req.end();
