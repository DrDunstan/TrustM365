const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const DIR = path.resolve(__dirname, '../../data/reference-templates');

let templates = new Map();
const openintuneNormalizer = require('./openintune-normalizer');

function loadTemplates() {
  templates = new Map();
  const SKIP_DIRS = new Set(['archive', 'archived']);
  function walk(dir) {
    let out = [];
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      try {
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          if (!SKIP_DIRS.has(String(entry).toLowerCase())) {
            out = out.concat(walk(full));
          }
        }
        else if (stat.isFile() && full.toLowerCase().endsWith('.json')) out.push(full);
      } catch (e) {
        // ignore unreadable entries
      }
    }
    return out;
  }

  const files = walk(DIR);
  for (const filePath of files) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(content);
      const entries = Array.isArray(parsed) ? parsed : [parsed];
      for (let t of entries) {
        if (!t) continue;
        // ensure an `id` exists for older or generated files
        if (!t.id) t.id = t.id || t.template_id || t.templateId || (t.display_name ? String(t.display_name).toLowerCase().replace(/[^a-z0-9]+/g,'-') : path.basename(filePath, '.json'));
        // ensure metadata object and propagate `source` into metadata when present
        t.metadata = t.metadata || {};
        if (!t.metadata.source && t.source) t.metadata.source = t.source;
        if (!t.metadata.owner) t.metadata.owner = ownerFromSource(t.metadata.source);
        try {
          const src = String((t.metadata && t.metadata.source) || '').toLowerCase();
          const tplOwner = String((t.metadata && t.metadata.owner) || '').toLowerCase();
          const nameStr = String(t.name || t.display_name || t.template_id || t.templateId || '').toLowerCase();
          const fp = String(filePath || '').toLowerCase();

          // Detect OpenIntuneBaseline/SettingsCatalog files by source, owner, id, name or filename
          if (
            src.includes('openintune') || src.includes('open-intune') ||
            tplOwner === 'openintune' ||
            (t.id && String(t.id).startsWith('oib:')) ||
            nameStr.includes('oib') ||
            fp.includes('oib') || fp.includes('openintune')
          ) {
            const normalized = openintuneNormalizer.normalize(t, filePath);
            if (normalized) t = normalized;
          }
        } catch (err) {
          logger.warn({ err, file: filePath }, 'OpenIntune normalizer failed for template');
        }
        templates.set(t.id, t);
      }
    } catch (err) {
      logger.warn({ file: filePath, err }, 'Failed to load reference template');
    }
  }
}

loadTemplates();

function listTemplates() {
  return Array.from(templates.values()).map(t => ({
    id: t.id,
    // Prefer explicit display_name from templates (e.g., OpenIntuneBaseline) when present
    name: t.name || t.display_name || t.displayName || t.template_id || t.templateId || t.id,
    display_name: t.display_name || t.displayName || t.template_id || t.templateId || null,
    area_key: t.area_key,
    description: t.description || '',
    metadata: t.metadata || {}
  }));
}

function ownerFromSource(src) {
  if (!src) return 'community'
  const s = String(src).toLowerCase()
  if (s.includes('openintune') || s.includes('open-intune')) return 'openintune'
  // Map legacy Maester/CISA sources to Zero Trust owner
  if (s.includes('maester') || s.includes('cisa') || s.includes('cisa-scuba')) return 'zerotrust'
  return 'community'
}

function listTemplatesFiltered(options = {}) {
  const { owner } = options || {}
  let list = Array.from(templates.values()).map(t => ({
    id: t.id,
    // Prefer explicit display_name from templates when present
    name: t.name || t.display_name || t.displayName || t.template_id || t.templateId || t.id,
    display_name: t.display_name || t.displayName || t.template_id || t.templateId || null,
    area_key: t.area_key,
    description: t.description || '',
    metadata: t.metadata || {}
  }))
  // No default owner filtering: return all templates unless an owner is explicitly requested

  if (owner) {
    list = list.filter(tpl => {
      const meta = tpl.metadata || {}
      const tplOwner = meta.owner || ownerFromSource(meta.source)
      return tplOwner === owner
    })
  }

  return list
}

function listOwners() {
  const map = new Map()
  for (const t of templates.values()) {
    const meta = t.metadata || {}
    const key = meta.owner || ownerFromSource(meta.source)
    const display = meta.owner_display || (
        key === 'openintune' ? 'OpenIntuneBaseline' :
      (key === 'zerotrust' ? 'Zero Trust Assessment' :
      (key === 'community' ? 'Community' : key))
    )
    if (!map.has(key)) map.set(key, { key, display })
  }
  return Array.from(map.values())
}

function getTemplate(id) {
  const tpl = templates.get(id) || null;
  if (!tpl) return null;
  try {
    const src = String((tpl.metadata && tpl.metadata.source) || '').toLowerCase();
    const tplOwner = String((tpl.metadata && tpl.metadata.owner) || '').toLowerCase();
    const hasResources = tpl.resources && Object.keys(tpl.resources).length > 0;
    if (!hasResources && (src.includes('openintune') || src.includes('open-intune') || tplOwner === 'openintune' || (tpl.id && String(tpl.id).startsWith('oib:')))) {
      const normalized = openintuneNormalizer.normalize(tpl);
      if (normalized) return normalized;
    }
  } catch (err) {
    // ignore normalization fallback errors
  }
  return tpl;
}

function reload() { loadTemplates(); return listTemplatesFiltered(); }

module.exports = {
  listTemplates: listTemplatesFiltered,
  listOwners,
  getTemplate,
  reload,
}
