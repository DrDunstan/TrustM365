const https = require('https');

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

function parseRetryAfterHeader(val) {
  if (!val) return null;
  const s = String(val).trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const ts = Date.parse(s);
  if (!isNaN(ts)) {
    return Math.max(0, Math.ceil((ts - Date.now()) / 1000));
  }
  return null;
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function graphRequest(token, method, path, body = null, extraHeaders = {}, opts = {}) {
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
        const headers = res.headers || {};
        if (res.statusCode === 204) return resolve(null);
        if ([200, 201].includes(res.statusCode)) {
          try { resolve(JSON.parse(data)); } catch { resolve(data); }
          return;
        }
        if (res.statusCode === 404) return resolve(null);

        const errMsg = (() => {
          try { const j = JSON.parse(data); return j?.error?.message || `Graph API ${res.statusCode} on ${path}`; } catch { return `Graph API ${res.statusCode} on ${path}`; }
        })();

        const err = new Error(
          res.statusCode === 429 ? 'Graph API rate limited — wait a moment and retry' :
          res.statusCode === 401 ? 'Authentication failed — check App Registration credentials' :
          res.statusCode === 403 ? `Permission denied on ${path} — check admin consent was granted` :
          errMsg
        );
        err.statusCode = res.statusCode;
        err.headers = headers;
        if (headers['retry-after']) err.retryAfter = parseRetryAfterHeader(headers['retry-after']);
        return reject(err);
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

  const maxRetries = options.maxRetries !== undefined ? options.maxRetries : 4;
  const baseDelayMs = options.baseDelayMs !== undefined ? options.baseDelayMs : 1000;
  let attempt = 0;

  while (true) {
    try {
      return await graphRequest(token, 'GET', path, null, headers);
    } catch (err) {
      attempt++;
      const status = err.statusCode || 0;
      const retryable = status === 429 || status === 503;
      if (!retryable || attempt > maxRetries) throw err;

      let waitSecs = null;
      if (typeof err.retryAfter === 'number') waitSecs = err.retryAfter;
      else if (err.headers && err.headers['retry-after']) waitSecs = parseRetryAfterHeader(err.headers['retry-after']);

      if (waitSecs == null) {
        const backoff = baseDelayMs * Math.pow(2, attempt - 1);
        const jitter = Math.floor(Math.random() * Math.min(1000, backoff));
        waitSecs = Math.ceil((backoff + jitter) / 1000);
      }

      await sleep(waitSecs * 1000);
      continue;
    }
  }
}

async function graphGetAll(token, path, options = {}) {
  const results = [];
  let next = path;
  while (next) {
    const res = await graphGet(token, next, options);
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
