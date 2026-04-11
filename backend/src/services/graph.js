const https = require('https');

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

function graphRequest(token, method, path, body = null, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const url = path.startsWith('http') ? path : `${GRAPH_BASE}${path}`;
    const parsed = new URL(url);
    const bodyStr = body ? JSON.stringify(body) : null;

    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...extraHeaders,
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {})
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode === 204) return resolve(null);
        if ([200, 201].includes(res.statusCode)) {
          try { resolve(JSON.parse(data)); } catch { resolve(data); }
          return;
        }
        if (res.statusCode === 404) return resolve(null);
        if (res.statusCode === 429) return reject(new Error('Graph API rate limited — wait a moment and retry'));
        if (res.statusCode === 401) return reject(new Error('Authentication failed — check App Registration credentials'));
        if (res.statusCode === 403) return reject(new Error(`Permission denied on ${path} — check admin consent was granted`));
        try {
          const err = JSON.parse(data);
          reject(new Error(err.error?.message || `Graph API ${res.statusCode} on ${path}`));
        } catch {
          reject(new Error(`Graph API ${res.statusCode} on ${path}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Graph API request timed out')); });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function graphGet(token, path, options = {}) {
  const headers = {};
  if (options.consistencyLevel) headers['ConsistencyLevel'] = options.consistencyLevel;
  return graphRequest(token, 'GET', path, null, headers);
}

async function graphGetAll(token, path) {
  const results = [];
  let next = path;
  while (next) {
    const res = await graphGet(token, next);
    if (!res) break;
    if (res.value) results.push(...res.value);
    next = res['@odata.nextLink'] || null;
  }
  return results;
}

async function graphPatch(token, path, body) {
  return graphRequest(token, 'PATCH', path, body);
}

async function graphPut(token, path, body) {
  return graphRequest(token, 'PUT', path, body);
}

async function graphPost(token, path, body) {
  return graphRequest(token, 'POST', path, body);
}

module.exports = { graphGet, graphGetAll, graphPatch, graphPut, graphPost };
