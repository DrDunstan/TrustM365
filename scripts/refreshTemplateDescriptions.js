#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const DIR = path.resolve(__dirname, '../backend/data/reference-templates');
const DISCLAIMER = "IMPORTANT: These reference checks are static, read-only guidance and may produce false positives or negatives. They are provided for informational purposes only and do not replace a full manual security audit. Always verify findings before acting. The maintainers and operators accept no responsibility or liability for the security posture of any tenant based on these results.";

function ownerIsTarget(meta) {
  const owner = (meta && meta.owner) ? String(meta.owner).toLowerCase() : '';
  const source = (meta && meta.source) ? String(meta.source).toLowerCase() : '';
  // Target Zero Trust Assessment templates for description refresh
  return owner === 'zerotrust' || source.includes('zerotrust');
}

function summarizeDisplayNames(resources) {
  if (!resources) return [];
  const names = Object.values(resources).map(r => (r && r.displayName) ? r.displayName : (r && r.id) ? r.id : null).filter(Boolean);
  // dedupe while preserving order
  const seen = new Set();
  const out = [];
  for (const n of names) {
    if (!seen.has(n)) { seen.add(n); out.push(n); }
  }
  return out;
}

function buildDescription(meta, tplName, category, names) {
  const ownerDisplay = (meta && meta.owner_display) ? meta.owner_display : (meta && meta.source) ? meta.source : tplName;
  const cat = category ? ` — ${category}` : '';
  if (!names || names.length === 0) {
    return `${ownerDisplay}${cat}. ${DISCLAIMER}`;
  }
  const max = 12;
  const listed = names.slice(0, max).join('; ');
  const more = names.length > max ? ` +${names.length - max} more` : '';
  return `${ownerDisplay}${cat}. Includes: ${listed}${more}. ${DISCLAIMER}`;
}

(async () => {
  try {
    if (!fs.existsSync(DIR)) {
      console.error('Templates dir not found:', DIR);
      process.exit(1);
    }
    const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json'));
    const modified = [];
    for (const file of files) {
      const p = path.join(DIR, file);
      let raw = fs.readFileSync(p, 'utf8');
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        console.warn('Skipping invalid JSON:', file);
        continue;
      }

      // Support both single template object and array of templates
      if (Array.isArray(parsed)) {
        let changedAny = false;
        parsed = parsed.map(t => {
          if (!t || typeof t !== 'object') return t;
          const meta = t.metadata || {};
          if (!ownerIsTarget(meta)) return t;
          const names = summarizeDisplayNames(t.resources || {});
          const category = meta.category || t.area_key || '';
          const newDesc = buildDescription(meta, t.name || t.id, category, names);
          if (t.description !== newDesc) { t.description = newDesc; changedAny = true; }
          return t;
        });
        if (changedAny) {
          fs.writeFileSync(p, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
          modified.push(file);
        }
      } else if (parsed && typeof parsed === 'object') {
        const meta = parsed.metadata || {};
        if (!ownerIsTarget(meta)) continue;
        const names = summarizeDisplayNames(parsed.resources || {});
        const category = meta.category || parsed.area_key || '';
        const newDesc = buildDescription(meta, parsed.name || parsed.id, category, names);
        if (parsed.description !== newDesc) {
          parsed.description = newDesc;
          fs.writeFileSync(p, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
          modified.push(file);
        }
      }
    }

    console.log('Updated descriptions for:', modified);
    process.exit(0);
  } catch (err) {
    console.error('Failed to refresh template descriptions:', err && err.message ? err.message : String(err));
    process.exit(2);
  }
})();
