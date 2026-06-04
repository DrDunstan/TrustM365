#!/usr/bin/env node
// Minimal .env loader to avoid external dependency on `dotenv` when running
const fs = require('fs');
try {
  const env = fs.readFileSync('./.env', 'utf8');
  env.split(/\r?\n/).forEach(line => {
    const m = line.match(/^\s*([^#=]+?)\s*=\s*(.*?)\s*$/);
    if (m) process.env[m[1]] = m[2];
  });
} catch (e) {
  // ignore
}
const { initDatabase, getDb } = require('../backend/src/database/init');
const { decrypt } = require('../backend/src/utils/encryption');
const { getAccessToken } = require('../backend/src/services/auth');
const collectorsModule = require('../backend/src/collectors');
const graph = require('../backend/src/services/graph');

const origGet = graph.graphGet;
const origGetAll = graph.graphGetAll;

graph.graphGet = async function(token, path, options) {
  console.error('[GRAPH GET]', path);
  try {
    const res = await origGet(token, path, options);
    console.error('[GRAPH GET OK]', path);
    return res;
  } catch (err) {
    console.error('[GRAPH GET ERR]', path, err.message);
    throw err;
  }
}

graph.graphGetAll = async function(token, path, options) {
  console.error('[GRAPH GETALL]', path);
  try {
    const res = await origGetAll(token, path, options);
    console.error('[GRAPH GETALL OK]', path, Array.isArray(res) ? res.length : typeof res);
    return res;
  } catch (err) {
    console.error('[GRAPH GETALL ERR]', path, err.message);
    throw err;
  }
}

async function run() {
  const tenantId = process.argv[2];
  const area = process.argv[3] || 'intune_config_profiles';
  if (!tenantId) { console.error('Usage: node scripts/debug_collector_pull.js <tenantDbId> [areaKey]'); process.exit(2); }
  await initDatabase();
  const db = getDb();
  const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
  if (!tenant) { console.error('Tenant not found'); process.exit(3); }
  let clientSecret;
  try {
    clientSecret = decrypt(tenant.client_secret_encrypted);
  } catch (err) {
    console.error('Decrypt error:', err.message);
    process.exit(4);
  }

  let token;
  try {
    token = await getAccessToken(tenant.tenant_id, tenant.client_id, clientSecret);
    console.error('Acquired token (len):', token ? token.length : null);
  } catch (err) {
    console.error('Failed to get access token:', err.message);
    process.exit(5);
  }

  let collector;
  try { collector = collectorsModule.getCollector(area); } catch (err) { console.error('Unknown collector', area); process.exit(6); }

  try {
    const resources = await collector.pull(token);
    console.log('Pulled resources count:', Object.keys(resources).length);
    console.log(JSON.stringify(Object.keys(resources).slice(0,10), null, 2));
  } catch (err) {
    console.error('Collector.pull error:', err.message);
    console.error(err && err.stack ? err.stack : err);
    process.exit(7);
  }
}

run();
