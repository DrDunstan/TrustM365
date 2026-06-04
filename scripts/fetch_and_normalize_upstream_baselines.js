const https = require('https');
const fs = require('fs');
const path = require('path');

const genericNormalizer = require('../backend/src/referenceTemplates/generic-normalizer');

function downloadText(url) {
  return new Promise((resolve, reject) => {
    const opts = { headers: { 'User-Agent': 'TrustM365-fetcher' } };
    https.get(url, opts, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadText(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to fetch ${url}: ${res.statusCode}`));
        res.resume();
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    }).on('error', err => reject(err));
  });
}

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function ownerDisplay(owner) {
  if (!owner) return 'community';
  // Map legacy Maester/CISA sources to Zero Trust Assessment V2
  if (owner === 'maester' || owner === 'cisa-scuba' || owner === 'zerotrust') return 'Zero Trust Assessment V2';
  return owner;
}

function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }

async function processItem(item) {
  const { url, owner, name } = item;
  console.log('Fetching', url);
  const text = await downloadText(url);
  let parsed = null;
  let wrapper = {};
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    parsed = null;
  }

  const idBase = slugify(name || path.basename(url).replace(/\.json$|\.ps1$/i, '')) || slugify(url);

  if (parsed !== null) {
    let settings;
    if (Array.isArray(parsed)) {
      if (parsed.length === 1 && typeof parsed[0] === 'object') settings = parsed[0];
      else settings = { items: parsed };
    } else if (typeof parsed === 'object') settings = parsed;
    else settings = { value: parsed };

    const resourceKey = `${idBase}:data`;
    wrapper = {
      id: idBase,
      display_name: name || idBase,
      metadata: { owner: owner, owner_display: ownerDisplay(owner), source: url },
      area_key: owner,
      resources: {
        [resourceKey]: {
          id: resourceKey,
          displayName: `${name || idBase} data`,
          settings: settings
        }
      }
    };
  } else {
    // Not JSON: try to parse legacy PS1 tests, otherwise wrap as raw text
    const tests = [];
    const itRegex = /It\s+"(MT\.[0-9]+):\s*([^\"]+)"/g;
    let m;
    while ((m = itRegex.exec(text)) !== null) {
      tests.push({ id: m[1], title: m[2].trim() });
    }

    if (tests.length > 0) {
      const resourceKey = `${idBase}:tests`;
      const settingsObj = {};
      for (const t of tests) settingsObj[t.id] = t.title;
      wrapper = {
        id: idBase,
        display_name: name || idBase,
        metadata: { owner: owner, owner_display: ownerDisplay(owner), source: url },
        area_key: owner,
        resources: {
          [resourceKey]: {
            id: resourceKey,
            displayName: `${name || idBase} tests`,
            settings: settingsObj
          }
        },
        settings: tests.map(t => ({ control_id: `${idBase}:${slugify(t.id)}`, title: `${t.id} - ${t.title}`, recommended_value: true }))
      };
    } else {
      // Fallback: wrap raw text
      const resourceKey = `${idBase}:raw`;
      wrapper = {
        id: idBase,
        display_name: name || idBase,
        metadata: { owner: owner, owner_display: ownerDisplay(owner), source: url },
        area_key: owner,
        resources: {
          [resourceKey]: {
            id: resourceKey,
            displayName: `${name || idBase} raw`,
            settings: { raw: text }
          }
        }
      };
    }
  }

  // Normalize using existing generic normalizer
  let normalized = genericNormalizer.normalize(wrapper, url);
  if (!normalized.metadata) normalized.metadata = {};
  normalized.metadata.owner = owner;
  normalized.metadata.source = normalized.metadata.source || url;

  const outDir = path.resolve(__dirname, '../backend/data/reference-templates', owner);
  ensureDir(outDir);
  const outPath = path.join(outDir, `${normalized.id}.json`);
  fs.writeFileSync(outPath, JSON.stringify(normalized, null, 2), 'utf8');
  console.log('Wrote', outPath);
}

async function main() {
  const items = [];

  for (const it of items) {
    try { await processItem(it); }
    catch (err) { console.error('Error processing', it.url, err && err.message); }
  }

  console.log('Done.');
}

if (require.main === module) main().catch(err => { console.error(err); process.exit(1); });
