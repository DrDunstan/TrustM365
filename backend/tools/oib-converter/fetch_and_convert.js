#!/usr/bin/env node
const https = require('https');
const fs = require('fs');
const path = require('path');
const mapper = require('./mappers/oibToTrustMapper');
const writer = require('./writer');

const REPO_RAW_BASE = 'https://raw.githubusercontent.com/SkipToTheEndpoint/OpenIntuneBaseline/main/WINDOWS/IntuneManagement/SettingsCatalog/';

const TEMPLATE_MAP = {
  defender: 'Win - OIB - ES - Defender Antivirus - D - AV Configuration - v3.3.json',
  bitlocker: 'Win - OIB - ES - Encryption - D - BitLocker (OS Disk) - v3.7.json',
  asr: 'Win - OIB - ES - Attack Surface Reduction - D - ASR Rules (L2) - v3.7.json',
  firewall: 'Win - OIB - ES - Windows Firewall - D - Firewall Configuration - v3.1.json',
  laps: 'Win - OIB - ES - Windows LAPS - D - LAPS Configuration - v3.1.json'
};

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      let data = '';
      res.setEncoding('utf8');
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

function loadMappingHints() {
  const mappingDir = path.join(__dirname, 'mappings');
  const hints = {};
  if (!fs.existsSync(mappingDir)) return hints;
  for (const f of fs.readdirSync(mappingDir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const key = path.basename(f, '.json');
      hints[key] = JSON.parse(fs.readFileSync(path.join(mappingDir, f), 'utf8'));
    } catch (e) {
      // ignore
    }
  }
  return hints;
}

async function run(selected) {
  const mappingHints = loadMappingHints();
  const outDir = path.join(__dirname, '..', '..', 'data', 'reference-templates', 'open-intune-baseline');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  for (const key of selected) {
    const filename = TEMPLATE_MAP[key];
    if (!filename) {
      console.warn('No upstream filename mapped for', key);
      continue;
    }
    const url = REPO_RAW_BASE + encodeURIComponent(filename).replace(/%20/g, '%20');
    console.log('Fetching', filename);
    try {
      const raw = await fetchJson(url);
      // Normalize the raw export into the shape mapper expects. Use existing parser logic in mapper by supplying object with expected fields
      const policy = {
        name: raw.name || raw.displayName || raw.Title || filename.replace('.json',''),
        description: raw.description || raw.Description || '',
        profileType: raw.profileType || raw.profile_type || 'Settings catalog',
        category: raw.category || raw.Category || '',
        policyType: raw.policyType || raw.policy_type || (raw.templateReference && raw.templateReference.templateDisplayName) || '',
        platformSupported: raw.platforms || raw.platformSupported || '',
        created: raw.createdDateTime || raw.created || '',
        lastModified: raw.lastModifiedDateTime || raw.lastModified || '',
        settings: []
      };

      if (Array.isArray(raw.settings)) {
        for (const s of raw.settings) {
          // The Intune export places the setting display text in different places; try a few keys
          const inst = s.settingInstance || s.setting || s.Setting || {};
          const title = s.displayName || s.name || (inst && inst.choiceSettingValue && inst.choiceSettingValue.value) || s.title || 'unknown';
          // Derive a friendly value where possible
          let value = '';
          if (inst) {
            value = inst.choiceSettingValue && inst.choiceSettingValue.value ? inst.choiceSettingValue.value : (inst.simpleSettingValue && inst.simpleSettingValue.value !== undefined ? inst.simpleSettingValue.value : '');
          }
          // fallback: raw simple fields
          if (!value && s.value) value = s.value;
          policy.settings.push({ name: title, value });
        }
      }

      // Choose mapping hints key by looking for a mapping key that matches the filename or fallback to supplied key
      const foundHintKey = Object.keys(mappingHints).find(k => filename.toLowerCase().includes(k)) || key;
      const hints = Object.assign({}, mappingHints[foundHintKey] || {});
      const mapped = mapper.mapPolicy(policy, hints);
      const outPath = writer.write(mapped, outDir);
      console.log('WROTE', outPath);
    } catch (e) {
      console.error('Failed to fetch/convert', filename, e.message || e);
    }
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const selected = [];
  for (let i=0;i<args.length;i++){
    const a = args[i];
    if (a === '--templates' && args[i+1]) { args[i+1].split(',').map(s=>s.trim()).forEach(t=>selected.push(t)); i++; }
    else if (a === '--all') selected.push(...Object.keys(TEMPLATE_MAP));
    else if (a === '--help') { console.log('Usage: node fetch_and_convert.js --templates defender,asr --out <dir>'); process.exit(0); }
  }
  return selected.length ? selected : Object.keys(TEMPLATE_MAP);
}

const selected = parseArgs();
run(selected).then(()=>console.log('done')).catch(err=>{ console.error(err); process.exit(1); });
