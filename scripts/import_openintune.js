#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function slugify(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,''); }

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.error('Usage: node scripts/import_openintune.js <file-or-folder> [--overwrite]');
    process.exit(2);
  }
  const target = argv[0];
  const overwrite = argv.includes('--overwrite');

  const resolved = path.resolve(process.cwd(), target);
  if (!fs.existsSync(resolved)) {
    console.error('File/folder not found:', resolved);
    process.exit(2);
  }

  const outDir = path.resolve(__dirname, '../data/reference-templates');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const toProcess = [];
  const stat = fs.statSync(resolved);
  if (stat.isDirectory()) {
    for (const f of fs.readdirSync(resolved)) {
      if (f.toLowerCase().endsWith('.json')) toProcess.push(path.join(resolved, f));
    }
  } else {
    toProcess.push(resolved);
  }

  const saved = [];
  for (const p of toProcess) {
    try {
      const raw = fs.readFileSync(p, 'utf8');
      const parsed = JSON.parse(raw);
      const entries = Array.isArray(parsed) ? parsed : [parsed];
      for (const t of entries) {
        if (!t || typeof t !== 'object') continue;
        t.metadata = t.metadata || {};
        if (!t.metadata.source) t.metadata.source = t.source || 'OpenIntuneBaseline';
        // Mark imported templates as 'custom' owner so they appear under Custom in the UI
        if (!t.metadata.owner) t.metadata.owner = 'custom';
        if (!t.metadata.owner_display) t.metadata.owner_display = 'Custom';
        if (!t.id) t.id = t.template_id || t.templateId || slugify(t.display_name || t.name || (`oib-${Date.now()}`));

        const filename = `${t.id}.json`;
        const filePath = path.join(outDir, filename);
        if (fs.existsSync(filePath) && !overwrite) {
          saved.push({ file: filename, skipped: true });
          continue;
        }
        fs.writeFileSync(filePath, JSON.stringify(t, null, 2), 'utf8');
        saved.push({ file: filename, skipped: false });
      }
    } catch (e) {
      console.error('Failed to import', p, e && e.message);
    }
  }

  // Try to reload the registry if running in-process (best-effort)
  try {
    const registry = require('../backend/src/referenceTemplates/registry');
    if (registry && typeof registry.reload === 'function') registry.reload();
  } catch (e) {
    // ignore
  }

  console.log('Import complete:', saved);
}

main().catch(e => { console.error(e); process.exit(1); });
