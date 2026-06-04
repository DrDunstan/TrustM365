#!/usr/bin/env node
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');

function httpReq(method, path, body) {
  return new Promise((resolve, reject) => {
    const opts = { hostname: '127.0.0.1', port: process.env.PORT || 3001, path, method, headers: {} };
    let payload = null;
    if (body) {
      payload = JSON.stringify(body);
      opts.headers['Content-Type'] = 'application/json';
      opts.headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = http.request(opts, (res) => {
      let out = '';
      res.setEncoding('utf8');
      res.on('data', c => out += c);
      res.on('end', () => {
        try { resolve(JSON.parse(out)); } catch (e) { resolve(out); }
      });
    });
    req.on('error', (err) => reject(err));
    if (payload) req.write(payload);
    req.end();
  });
}

async function parseJobIdsFromFile(pathToFile) {
  const txt = fs.readFileSync(pathToFile, 'utf8');
  const ids = new Set();
  const re = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/ig;
  let m;
  while ((m = re.exec(txt)) !== null) ids.add(m[0]);
  return Array.from(ids);
}

async function pollJobs(jobIds, { interval = 15000, timeout = 900000 } = {}) {
  const start = Date.now();
  const remaining = new Set(jobIds);
  const results = {};

  while (remaining.size > 0) {
    for (const id of Array.from(remaining)) {
      try {
        const job = await httpReq('GET', `/api/jobs/${id}`);
        if (job && (job.status === 'complete' || job.status === 'failed' || job.status === 'unavailable')) {
          remaining.delete(id);
          results[id] = job;
          console.log(`Job ${id} finished: ${job.status}`);
        } else {
          console.log(`Job ${id} status: ${job && job.status ? job.status : 'unknown'}`);
        }
      } catch (e) {
        console.log(`Job ${id} poll error:`, e && e.message ? e.message : e);
      }
    }

    if (remaining.size === 0) break;
    if (Date.now() - start > timeout) {
      console.log('Timeout waiting for jobs:', Array.from(remaining));
      break;
    }
    await new Promise(r => setTimeout(r, interval));
  }

  return results;
}

async function main() {
  if (process.argv.length < 3) {
    console.error('Usage: node scripts/poll_jobs_and_run_compare.js <pathToPullOutputFile|jobId...> [tenantExternalId]');
    process.exit(2);
  }

  const arg = process.argv[2];
  let jobIds = [];
  if (fs.existsSync(arg)) jobIds = await parseJobIdsFromFile(arg);
  else jobIds = process.argv.slice(2).filter(a => a.length > 0);

  if (jobIds.length === 0) { console.error('No job IDs found.'); process.exit(2); }
  console.log('Polling job IDs:', jobIds.length);

  const polls = await pollJobs(jobIds, { interval: 15000, timeout: 900000 });
  console.log('Poll results count:', Object.keys(polls).length);

  // After polling, run the snapshot compare for tenant (third arg if provided)
  const tenantArg = process.argv[3] || null;
  if (!tenantArg) {
    console.log('No tenant provided — skipping compare run. Provide tenant external id as 2nd arg to run compare.');
    process.exit(0);
  }

  console.log('Running snapshot compare for tenant', tenantArg);
  const outFile = `tmp/compare_currentResources_results_${tenantArg.replace(/[^0-9a-zA-Z_-]/g,'')}_after_pulls.txt`;
  const child = spawn(process.execPath, ['scripts/batch_compare_with_snapshots.js', tenantArg], { stdio: ['ignore', 'pipe', 'pipe'] });

  const outStream = fs.createWriteStream(outFile, { flags: 'w' });
  child.stdout.pipe(process.stdout);
  child.stdout.pipe(outStream);
  child.stderr.pipe(process.stderr);

  child.on('close', (code) => {
    console.log('\nCompare finished, output saved to', outFile, 'exit code', code);
    process.exit(code || 0);
  });
}

main().catch(e => { console.error(e && e.message ? e.message : e); process.exit(1); });
