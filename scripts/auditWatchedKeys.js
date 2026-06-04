#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function getByPath(obj, pathStr) {
  if (!pathStr) return undefined;
  const parts = pathStr.split('.');
  let cur = obj;
  for (let p of parts) {
    if (cur === undefined || cur === null) return undefined;
    const sel = p.match(/^([^\[]+)\[([^=]+)=([^\]]+)\]$/);
    if (sel) {
      const prop = sel[1];
      const idProp = sel[2];
      const idVal = sel[3];
      cur = cur[prop];
      if (!Array.isArray(cur)) return undefined;
      const found = cur.find(el => String((el && el[idProp]) ?? '') === String(idVal));
      cur = found;
      continue;
    }
    if (Array.isArray(cur) && /^[0-9]+$/.test(p)) {
      cur = cur[Number(p)];
    } else {
      cur = cur[p];
    }
  }
  return cur;
}

function typeOf(val) {
  if (val === undefined) return 'undefined';
  if (val === null) return 'null';
  if (Array.isArray(val)) return 'array';
  return typeof val;
}

const dir = path.resolve(__dirname, '../backend/data/reference-templates');
if (!fs.existsSync(dir)) {
  console.error('Reference templates directory not found:', dir);
  process.exit(2);
}

const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
const report = { generatedAt: new Date().toISOString(), templates: [] };

for (const file of files) {
  try {
    const tpl = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    const tplReport = { id: tpl.id || file, file, watched_keys: [] };

    const watched = tpl.watched_keys || [];
    const resources = tpl.resources || {};

    for (const wk of watched) {
      const pathStr = wk.path;
      const currentOp = wk.match || wk.operator || 'equals';
      const vals = new Map();
      const types = new Set();

      for (const [rkey, r] of Object.entries(resources)) {
        const v = getByPath(r, pathStr);
        const t = typeOf(v);
        types.add(t);
        let sval;
        try { sval = JSON.stringify(v); } catch { sval = String(v); }
        if (!vals.has(sval)) vals.set(sval, { value: v, examples: [rkey] }); else if (vals.get(sval).examples.length < 5) vals.get(sval).examples.push(rkey);
      }

      // Decide recommendation
      let recommendation = currentOp;
      let reason = 'unchanged';

      if (types.has('array')) {
        recommendation = 'includes';
        reason = 'path resolves to arrays in reference resources; use `includes` for membership checks';
      } else if (types.has('object')) {
        recommendation = 'exists';
        reason = 'path resolves to objects; consider refining to a primitive subpath or use `exists` to check presence';
      } else if (types.has('undefined') && types.size === 1) {
        recommendation = currentOp;
        reason = 'path not present in any reference resource';
      } else if (types.size === 1 && (types.has('string') || types.has('number') || types.has('boolean') || types.has('null'))) {
        recommendation = 'equals';
        reason = 'primitive values in reference resources; `equals` is appropriate';
      } else {
        // mixed types or other cases: default to equals but flag
        recommendation = currentOp || 'equals';
        reason = 'mixed or ambiguous types; manual review recommended';
      }

      const uniqueValues = Array.from(vals.entries()).map(([s, o]) => ({ example: o.examples[0], sample: o.value }));
      tplReport.watched_keys.push({ path: pathStr, current: currentOp, types: Array.from(types), samples: uniqueValues.slice(0,5), recommendation, reason });
    }
    
    // Per-resource compare hints: which watched_keys are relevant to each resource
    tplReport.resource_hints = [];
    tplReport.hasServerTests = false;
    const resourcesObj = tpl.resources || {};
    for (const [rkey, r] of Object.entries(resourcesObj)) {
      const relevant = (watched || []).filter(wk => getByPath(r, wk.path) !== undefined).map(wk => wk.path);
      const matchedPathsExamples = relevant.map(p => ({ path: p, expected: getByPath(r, p) }));
      const hasTestId = !!(r && r.testId);
      if (hasTestId) tplReport.hasServerTests = true;
      tplReport.resource_hints.push({ resourceId: rkey, displayName: r && (r.displayName || r.id) || rkey, hasTestId, testId: r && r.testId || null, relevantWatchedKeys: relevant, matchedPathsExamples });
    }

    report.templates.push(tplReport);
  } catch (err) {
    console.error('Failed to parse', file, err && err.message ? err.message : String(err));
  }
}

const outPath = path.resolve(__dirname, 'audit-watched-keys-output.json');
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log('Audit complete. Results written to', outPath);
