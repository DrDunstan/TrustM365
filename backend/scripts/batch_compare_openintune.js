const fs = require('fs');
const path = require('path');

function slugify(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,''); }

function findRecommendedOrControlValue(t, prop) {
  // prefer resource mapping -> control id -> lookup recommended_value in t.settings
  for (const r of Object.values(t.resources || {})) {
    if (r && typeof r.settings === 'object' && Object.prototype.hasOwnProperty.call(r.settings, prop)) {
      const ctrl = r.settings[prop];
      const s = (t.settings || []).find(s => (s.control_id && s.control_id === ctrl) || (s.title && s.title === ctrl) || (s.title && String(s.title).toLowerCase() === String(ctrl).toLowerCase()));
      if (s) return s.recommended_value || s.value || s.title || ctrl;
      return ctrl;
    }
  }
  // fallback: try to find by title/control_id containing prop
  const s = (t.settings || []).find(s => ((s.title||'').toLowerCase().includes((prop||'').toLowerCase()) || (s.control_id||'').toLowerCase().includes((prop||'').toLowerCase())));
  if (s) return s.recommended_value || s.value || s.title;
  return undefined;
}

function findRecommendedValueForSettingId(t, idVal) {
  if (!idVal) return undefined;
  const needle = String(idVal).toLowerCase();
  const s = (t.settings || []).find(s => {
    return String(s.settingDefinitionId || s.setting_definition_id || s.control_id || s.title || '').toLowerCase().includes(needle);
  });
  if (s) return s.recommended_value || s.value || s.title;
  return undefined;
}

async function run() {
  const base = path.join(__dirname, '..', 'data', 'reference-templates', 'open-intune-baseline');
  if (!fs.existsSync(base)) { console.error('OpenIntuneBaseline folder not found:', base); process.exit(2); }
  const files = fs.readdirSync(base).filter(f => f.toLowerCase().endsWith('.json'));
  const results = [];

  for (const f of files) {
    const full = path.join(base, f);
    let parsed;
    try {
      const txt = fs.readFileSync(full, 'utf8');
      parsed = JSON.parse(txt);
    } catch (e) {
      console.error('Failed to parse', f, e.toString());
      continue;
    }
    const entries = Array.isArray(parsed) ? parsed : [parsed];
    for (const t of entries) {
      if (!t || !t.id) continue;
      const templateId = t.id;
      const sampleId = `sample-${templateId}`;
      const lres = { id: sampleId, displayName: `Sample ${t.display_name || t.name || templateId}` };

      const settingsObj = {};
      const settingsArray = [];

      const watched = Array.isArray(t.watched_keys) ? t.watched_keys.slice() : [];
      // if watched_keys empty, try synthesizing from settings list
      if (watched.length === 0 && Array.isArray(t.settings)) {
        for (const s of t.settings) {
          if (s && (s.control_id || s.title)) watched.push({ path: `settings.${s.title || s.control_id}` , label: s.title || s.control_id });
        }
      }

      for (const wk of watched) {
        const pathStr = typeof wk === 'string' ? wk : (wk && wk.path ? wk.path : null);
        if (!pathStr) continue;
        // settings[settingDefinitionId=xyz].value
        const m = pathStr.match(/^settings\[([^=]+)=([^\]]+)\]\.value$/i);
        if (m) {
          const idKey = m[1];
          const idVal = m[2];
          const val = findRecommendedValueForSettingId(t, idVal) || findRecommendedOrControlValue(t, idVal) || true;
          const el = { value: val };
          el[idKey] = idVal;
          settingsArray.push(el);
          continue;
        }
        if (pathStr.startsWith('settings.')) {
          const prop = pathStr.split('.').slice(1).join('.');
          const val = findRecommendedOrControlValue(t, prop);
          const finalVal = (val === undefined) ? true : val;
          settingsObj[prop] = finalVal;
          settingsArray.push({ name: prop, value: finalVal });
          continue;
        }
        // top-level property
        const prop = pathStr;
        const val = findRecommendedOrControlValue(t, prop);
        if (val !== undefined) lres[prop] = val; else lres[prop] = true;
      }

      // expose multiple shapes for comparator heuristics
      if (Object.keys(settingsObj).length > 0) lres.settings = settingsObj;
      if (settingsArray.length > 0) {
        lres.settings_array = settingsArray;
        lres.settingsArray = settingsArray;
        lres.settings_list = settingsArray;
      }

      const body = { currentResources: { [lres.id]: lres } };
      const url = `http://127.0.0.1:3001/api/reference-templates/${encodeURIComponent(templateId)}/compare`;
      try {
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const data = await res.json().catch(() => null);
        results.push({ templateId, file: f, status: res.status, summary: data && data.summary ? data.summary : null });
        console.log('Processed', templateId, '->', res.status, data && data.summary ? JSON.stringify(data.summary) : 'no-summary');
      } catch (e) {
        console.error('Request failed for', templateId, e.toString());
        results.push({ templateId, file: f, error: String(e) });
      }
      // small pause to avoid bursting the API
      await new Promise(r => setTimeout(r, 50));
    }
  }

  const outDir = path.join(__dirname, '..', 'tmp');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'batch_compare_openintune_results.json');
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8');
  console.log('Done. Results written to', outPath);
}

run().catch(e => { console.error(e); process.exit(2); });
