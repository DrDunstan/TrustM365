#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TEMPLATES_DIR = path.join(ROOT, 'backend', 'data', 'reference-templates');
const ARCHIVE_DIR = path.join(TEMPLATES_DIR, 'archive');

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir)) {
    const full = path.join(dir, e);
    try {
      const s = fs.statSync(full);
      if (s.isDirectory()) out.push(...walk(full));
      else if (s.isFile() && full.toLowerCase().endsWith('.json')) out.push(full);
    } catch (err) { /* ignore */ }
  }
  return out;
}

function parseVersion(v) {
  if (!v) return null;
  let s = String(v).trim();
  s = s.replace(/^v/i, '');
  s = s.replace(/[-_]/g, '.');
  s = s.replace(/[^0-9.]/g, '');
  if (!s) return null;
  return s.split('.').map(p => parseInt(p, 10) || 0);
}

function cmpVersion(a, b) {
  if (!a && !b) return 0;
  if (a && !b) return 1;
  if (!a && b) return -1;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] || 0;
    const bv = b[i] || 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

function extractVersionFromId(id) {
  if (!id) return null;
  const m = String(id).match(/-v(\d+(?:[.-]\d+)*)$/i);
  if (m) return 'v' + m[1];
  return null;
}

function familyKeyFor(entry, id) {
  if (entry && entry.metadata && entry.metadata.family_id) return String(entry.metadata.family_id);
  const v = entry && entry.version ? entry.version : extractVersionFromId(id) || null;
  if (v) return id.replace(/-v\d+(?:[.-]\d+)*$/i, '');
  return id;
}

function safeReadJson(fp) {
  try {
    const txt = fs.readFileSync(fp, 'utf8');
    return JSON.parse(txt);
  } catch (err) {
    return null;
  }
}

function main() {
  const args = process.argv.slice(2);
  const doApply = args.includes('--apply');
  console.log('Scanning', TEMPLATES_DIR);
  if (!fs.existsSync(TEMPLATES_DIR)) { console.error('Templates dir not found:', TEMPLATES_DIR); process.exit(2); }

  const files = walk(TEMPLATES_DIR).filter(f => !f.toLowerCase().includes(path.join('reference-templates', 'archive')));

  const records = []; // {file, id, entry, familyKey, versionArr, mtime}
  const fileEntries = new Map();

  for (const fp of files) {
    // Skip zerotrust folder entirely to avoid impacting Security Templates
    if (fp.toLowerCase().includes(path.join('reference-templates', 'zerotrust').toLowerCase())) continue;
    const parsed = safeReadJson(fp);
    if (!parsed) continue;
    const entries = Array.isArray(parsed) ? parsed : [parsed];
    const stats = fs.statSync(fp);
    for (const e of entries) {
      const id = (e && (e.id || e.template_id || e.templateId)) || path.basename(fp, '.json');
      let versionStr = e && e.version ? String(e.version) : null;
      if (!versionStr) {
        // try display_name
        if (e && e.display_name) {
          const m = String(e.display_name).match(/v\d+(?:[.-]\d+)*/i);
          if (m) versionStr = m[0];
        }
        if (!versionStr) versionStr = extractVersionFromId(id);
      }
      const versionArr = parseVersion(versionStr);
      const fk = familyKeyFor(e, id);
      const rec = { file: fp, id: String(id), entry: e, familyKey: fk, versionStr: versionStr || null, versionArr, mtime: stats.mtimeMs };
      records.push(rec);
      if (!fileEntries.has(fp)) fileEntries.set(fp, []);
      fileEntries.get(fp).push(rec);
    }
  }

  // Group by familyKey
  const families = new Map();
  for (const r of records) {
    if (!families.has(r.familyKey)) families.set(r.familyKey, []);
    families.get(r.familyKey).push(r);
  }

  const toArchiveFiles = new Set();
  const summary = [];

  for (const [fk, list] of families.entries()) {
    if (list.length <= 1) continue;
    // choose latest
    list.sort((a, b) => {
      // prefer versioned > non-versioned
      if (a.versionArr && b.versionArr) return -cmpVersion(a.versionArr, b.versionArr);
      if (a.versionArr && !b.versionArr) return -1;
      if (!a.versionArr && b.versionArr) return 1;
      // both unversioned: newest mtime wins
      return b.mtime - a.mtime;
    });
    const keep = list[0];
    const remove = list.slice(1);
    // If files containing remove entries also contain keep entries, skip (manual)
    for (const r of remove) {
      const fileHasKeep = fileEntries.get(r.file).some(x => x.file === keep.file && x.id === keep.id);
      // if file contains multiple entries and not all toRemove, avoid moving entire file
      const entriesInFile = fileEntries.get(r.file) || [];
      const allEntriesInFileMarked = entriesInFile.every(e => {
        // if this entry is also in 'remove' set
        return list.some(rem => rem.file === e.file && rem.id === e.id && rem !== keep);
      });
      if (allEntriesInFileMarked) {
        toArchiveFiles.add(r.file);
      } else {
        // cannot safely move the file (mixed entries), mark for manual review
        summary.push({ family: fk, keep: keep.id, remove: r.id, file: r.file, note: 'Contains mixed entries - manual review required' });
      }
    }
    summary.push({ family: fk, keep: keep.id, removedCount: remove.length });
  }

  if (toArchiveFiles.size === 0 && summary.length === 0) {
    console.log('No duplicate families detected; nothing to archive.');
    process.exit(0);
  }

  console.log('\nProposed archive actions:');
  for (const f of Array.from(toArchiveFiles)) console.log('  Archive file:', path.relative(TEMPLATES_DIR, f));
  for (const s of summary) console.log('  Summary:', s);

  if (!doApply) {
    console.log('\nDry-run complete. To apply these moves run with --apply');
    process.exit(0);
  }

  // Apply: move files to archive/<timestamp>/...
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  for (const f of Array.from(toArchiveFiles)) {
    const rel = path.relative(TEMPLATES_DIR, f);
    const dest = path.join(ARCHIVE_DIR, stamp, rel);
    const destDir = path.dirname(dest);
    fs.mkdirSync(destDir, { recursive: true });
    fs.renameSync(f, dest);
    console.log('Moved', rel, '->', path.relative(TEMPLATES_DIR, dest));
  }

  console.log('\nArchive applied. Please POST /api/reference-templates/reload to refresh the running server registry.');
}

if (require.main === module) main();
