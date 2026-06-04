const fs = require('fs');
const path = require('path');

const upstreamDir = path.resolve(__dirname, '..', 'backend', 'data', 'reference-templates', 'upstream');
const targetDir = path.resolve(__dirname, '..', 'backend', 'data', 'reference-templates', 'open-intune-baseline');
const mkdirp = (d) => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); };

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed ${url} -> ${res.status}`);
  return await res.text();
}

async function main() {
  mkdirp(upstreamDir);
  mkdirp(targetDir);

  console.log('Fetching repository tree...');
  const apiUrl = 'https://api.github.com/repos/SkipToTheEndpoint/OpenIntuneBaseline/git/trees/main?recursive=1';
  const treeRes = await fetch(apiUrl);
  if (!treeRes.ok) {
    console.error('Failed to fetch repo tree', treeRes.status);
    process.exit(1);
  }
  const tree = await treeRes.json();
  const files = (tree.tree || []).filter(i => i.path && i.path.startsWith('WINDOWS/IntuneManagement/SettingsCatalog/') && i.path.toLowerCase().endsWith('.json'))
    .map(i => i.path);
  console.log('Found', files.length, 'SettingsCatalog entries');

  for (const p of files) {
    try {
      const rawUrl = 'https://raw.githubusercontent.com/SkipToTheEndpoint/OpenIntuneBaseline/main/' + encodeURI(p);
      const name = path.basename(p);
      const outPath = path.join(upstreamDir, name);
      if (fs.existsSync(outPath)) {
        console.log('Skipping (exists):', name);
        continue;
      }
      console.log('Downloading', name);
      const txt = await fetchJson(rawUrl);
      fs.writeFileSync(outPath, txt, 'utf8');
      console.log('Saved upstream:', outPath);
    } catch (err) {
      console.error('Error downloading', p, err && err.message);
    }
  }

  // Reload registry and write normalized templates
  console.log('Reloading registry and writing normalized templates...');
  const reg = require('../backend/src/referenceTemplates/registry');
  try {
    reg.reload();
  } catch (e) { console.warn('Warning: registry.reload() threw', e && e.message); }

  const list = reg.listTemplates({ owner: 'openintune' });
  console.log('OpenIntune templates loaded:', list.length);
  for (const meta of list) {
    try {
      const tpl = reg.getTemplate(meta.id);
      if (!tpl) continue;
      const out = path.join(targetDir, `${tpl.id}.json`);
      fs.writeFileSync(out, JSON.stringify(tpl, null, 2), 'utf8');
      console.log('Wrote normalized template:', out);
    } catch (err) {
      console.error('Error writing template', meta.id, err && err.message);
    }
  }

  console.log('Ingest complete.');
}

main().catch(err => { console.error(err && err.stack); process.exit(2); });
