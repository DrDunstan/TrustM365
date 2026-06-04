#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function norm(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

const mappingsDir = path.join(__dirname, 'mappings');
const templatesDir = path.join(__dirname, '..', '..', 'data', 'reference-templates', 'open-intune-baseline');

if (!fs.existsSync(mappingsDir)) {
  console.error('No mappings directory:', mappingsDir);
  process.exit(1);
}
if (!fs.existsSync(templatesDir)) {
  console.error('No templates directory:', templatesDir);
  process.exit(1);
}

const mappingFiles = fs.readdirSync(mappingsDir).filter(f => f.endsWith('.json'));
for (const mf of mappingFiles) {
  const mapPath = path.join(mappingsDir, mf);
  let mapping;
  try { mapping = JSON.parse(fs.readFileSync(mapPath, 'utf8')); } catch (e) { console.warn('Skipping malformed mapping', mf); continue; }
  const base = path.basename(mf, '.json');
  const settingsMap = mapping.settingsMap || {};

  // find candidate template file
  const candidateFiles = fs.readdirSync(templatesDir).filter(t => t.toLowerCase().includes(base));
  if (candidateFiles.length === 0 && mapping.display_name) {
    const dn = norm(mapping.display_name);
    const alt = fs.readdirSync(templatesDir).filter(t => norm(t).includes(dn));
    if (alt.length) candidateFiles.push(...alt);
  }
  if (candidateFiles.length === 0) {
    console.log(`No template found matching mapping '${base}', skipping.`);
    continue;
  }

  const tplFile = path.join(templatesDir, candidateFiles[0]);
  let tpl;
  try { tpl = JSON.parse(fs.readFileSync(tplFile, 'utf8')); } catch (e) { console.warn('Failed to read template', tplFile); continue; }
  const tplSettings = tpl.settings || [];
  let added = 0;

  // build normalized map of existing friendly keys
  const friendlyKeys = Object.keys(settingsMap || {});
  const normFriendly = friendlyKeys.map(k => ({ key: k, n: norm(k) }));

  for (const s of tplSettings) {
    const title = s.title || s.control_id || s.recommended_value || '';
    if (!title || title === 'unknown') continue;
    if (settingsMap[title]) continue; // already present
    const nt = norm(title);
    // attempt to find matching friendly key
    const match = normFriendly.find(f => nt.includes(f.n) || f.n.includes(nt));
    if (match) {
      settingsMap[title] = JSON.parse(JSON.stringify(settingsMap[match.key]));
      added++;
      // also add variant without trailing _digits
      const alt = title.replace(/_[0-9]+$/, '');
      if (alt !== title && !settingsMap[alt]) {
        settingsMap[alt] = JSON.parse(JSON.stringify(settingsMap[match.key]));
        added++;
      }
      console.log(`Added alias '${title}' -> '${match.key}' in ${mf}`);
    }
  }

  if (added > 0) {
    mapping.settingsMap = settingsMap;
    fs.writeFileSync(mapPath, JSON.stringify(mapping, null, 2), 'utf8');
    console.log(`Updated mapping file ${mf}: added ${added} entries.`);
  } else {
    console.log(`No aliases added for ${mf}`);
  }
}

console.log('Done expanding mappings.');
