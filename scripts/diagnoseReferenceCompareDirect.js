#!/usr/bin/env node

(async () => {
  try {
    const path = require('path');
    const registry = require(path.resolve(__dirname, '../backend/src/referenceTemplates/registry'));
    const { getAccessToken } = require(path.resolve(__dirname, '../backend/src/services/auth'));
    const { getCollector, LicenceUnavailableError } = require(path.resolve(__dirname, '../backend/src/collectors'));

    const templateId = process.argv[2];
    const tenantId = process.argv[3];
    const clientId = process.argv[4];
    const clientSecret = process.argv[5];

    if (!templateId || !tenantId || !clientId || !clientSecret) {
      console.log('Usage: node scripts/diagnoseReferenceCompareDirect.js <template-id> <tenantId> <clientId> <clientSecret>');
      process.exit(1);
    }

    const tpl = registry.getTemplate(templateId);
    if (!tpl) {
      console.error('Template not found:', templateId);
      process.exit(2);
    }

    try {
      const token = await getAccessToken(tenantId, clientId, clientSecret);
      let collector;
      try {
        collector = getCollector(tpl.area_key);
      } catch (err) {
        console.error('Unknown area_key for template:', tpl.area_key);
        process.exit(3);
      }

      let liveResources = {};
      try {
        liveResources = await collector.pull(token);
      } catch (err) {
        if (err instanceof LicenceUnavailableError || err.code === 'LICENCE_UNAVAILABLE') {
          console.log(JSON.stringify({ templateId: tpl.id, tenantId, note: err.message }, null, 2));
          process.exit(0);
        }
        throw err;
      }

      function getByPath(obj, path) {
        if (!path) return undefined;
        const parts = path.split('.');
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

      const evalMatch = (expected, actual, op) => {
        const operator = op || 'equals';
        if (operator === 'equals') return JSON.stringify(expected) === JSON.stringify(actual);
        if (operator === 'notEquals') return JSON.stringify(expected) !== JSON.stringify(actual);
        if (operator === 'exists') return actual !== undefined && actual !== null;
        if (operator === 'includes') {
          if (Array.isArray(actual)) {
            if (Array.isArray(expected)) return expected.every(e => actual.some(a => JSON.stringify(a) === JSON.stringify(e)));
            return actual.some(a => JSON.stringify(a) === JSON.stringify(expected));
          }
          if (typeof actual === 'string' && typeof expected === 'string') return actual.includes(expected);
          return JSON.stringify(expected) === JSON.stringify(actual);
        }
        if (operator === 'in') {
          if (Array.isArray(expected)) return expected.some(e => JSON.stringify(e) === JSON.stringify(actual));
          return JSON.stringify(expected) === JSON.stringify(actual);
        }
        return JSON.stringify(expected) === JSON.stringify(actual);
      };

      const liveMap = (liveResources && typeof liveResources === 'object' && !Array.isArray(liveResources)) ? liveResources : {};
      const refResources = tpl.resources || {};
      const items = [];
      const watched = tpl.watched_keys || [];

      for (const refKey of Object.keys(refResources)) {
        const ref = refResources[refKey];
        if (!Array.isArray(watched) || watched.length === 0) {
          items.push({ refId: refKey, refDisplayName: ref.displayName || '', status: 'no_watched_keys' });
          continue;
        }

        // Only consider watched keys that are present in this reference entry
        const relevant = watched.filter(wk => getByPath(ref, wk.path) !== undefined);
        if (relevant.length === 0) {
          items.push({ refId: refKey, refDisplayName: ref.displayName || '', status: 'no_watched_keys' });
          continue;
        }

        const matchAll = [];
        const perKeyMatches = {};
        for (const wk of relevant) perKeyMatches[wk.path] = [];

        for (const [lid, lres] of Object.entries(liveMap)) {
          let allMatch = true;
          for (const wk of relevant) {
            const path = wk.path;
            const refVal = getByPath(ref, path);
            const liveVal = getByPath(lres, path);
            const op = wk.match || wk.operator || 'equals';
            const ok = evalMatch(refVal, liveVal, op);
            if (ok) perKeyMatches[path].push({ id: lid, displayName: lres.displayName || '' });
            if (!ok) allMatch = false;
          }
          if (allMatch) matchAll.push({ id: lid, displayName: lres.displayName || '' });
        }

        const matchedCount = matchAll.length;
        const matchedSamples = matchAll.slice(0,3).map(m => {
          const r = liveMap && liveMap[m.id] ? liveMap[m.id] : null;
          let matchedPaths = [];
          if (Array.isArray(m.matchedPaths) && m.matchedPaths.length > 0) {
            matchedPaths = m.matchedPaths.map(mp => ({ path: mp.path || null, expected: mp.expected === undefined ? null : mp.expected, actual: mp.actual === undefined ? null : mp.actual, operator: mp.operator || 'equals' }));
          } else if (r && Array.isArray(relevant)) {
            for (const wk of relevant) {
              matchedPaths.push({ path: wk.path, expected: getByPath(ref, wk.path), actual: getByPath(r, wk.path), operator: wk.match || wk.operator || 'equals' });
            }
          }
          return { id: m.id, displayName: m.displayName || '', area_key: tpl.area_key, matchedPaths };
        });
        const presentInPolicies = matchAll.map(m => m.displayName || m.id);
        const detail = matchedCount > 0 ? `Found in ${matchedCount} live resource(s): ${presentInPolicies.slice(0,3).join(', ')}` : 'Setting not present in any live resource';

        items.push({ refId: refKey, refDisplayName: ref.displayName || '', status: matchAll.length > 0 ? 'matched' : 'noMatch', matchAll, perKeyMatches, matchedCount, matchedSamples, presentInPolicies, detail });
      }

      const total = items.length;
      const matchedCount = items.filter(i => i.status === 'matched').length;
      const mismatchedCount = items.filter(i => i.status === 'mismatched').length;
      const missingCount = items.filter(i => i.status === 'missing').length;

      console.log(JSON.stringify({ templateId: tpl.id, tenantId, summary: { total, matched: matchedCount, mismatched: mismatchedCount, missing: missingCount }, items, sampleLiveResourceCount: Object.keys(liveMap).length }, null, 2));
      process.exit(0);
    } catch (err) {
      console.error('Reference compare failed:', err && err.message ? err.message : String(err));
      process.exit(4);
    }
  } catch (err) {
    console.error('Fatal:', err && err.message ? err.message : String(err));
    process.exit(99);
  }
})();
