#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {
    target: '',
    family: '',
    policyType: '',
    source: 'Uploaded',
    api: 'http://127.0.0.1:3001',
    overwrite: true,
  };

  const parts = argv.slice(2);
  if (!parts.length) return args;
  args.target = parts[0];

  for (let i = 1; i < parts.length; i++) {
    const a = parts[i];
    if (a === '--family' && parts[i + 1]) { args.family = parts[++i]; continue; }
    if (a === '--policyType' && parts[i + 1]) { args.policyType = parts[++i]; continue; }
    if (a === '--source' && parts[i + 1]) { args.source = parts[++i]; continue; }
    if (a === '--api' && parts[i + 1]) { args.api = parts[++i]; continue; }
    if (a === '--no-overwrite') { args.overwrite = false; continue; }
    if (a === '--overwrite') { args.overwrite = true; continue; }
  }

  return args;
}

function familyToPolicyType(family) {
  const key = String(family || '').toLowerCase();
  const map = {
    'compliance-policy': 'Compliance Policy',
    'configuration-profile': 'Configuration Profile',
    'settings-catalog': 'Settings Catalog',
    'endpoint-security-antivirus': 'Endpoint Security Antivirus',
    'endpoint-security-firewall': 'Endpoint Security Firewall',
    'endpoint-security-disk-encryption': 'Endpoint Security Disk Encryption',
    'endpoint-security-asr': 'Endpoint Security Attack Surface Reduction',
    'windows-update-ring': 'Windows Update Ring',
    'app-protection-policy': 'App Protection Policy',
    'mobile-threat-defense-connector': 'Mobile Threat Defense Connector',
    'identity-policy': 'Identity Policy',
  };
  return map[key] || '';
}

function readJsonEntries(targetPath) {
  const out = [];
  const stat = fs.statSync(targetPath);
  const files = [];
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(targetPath)) {
      if (name.toLowerCase().endsWith('.json')) files.push(path.join(targetPath, name));
    }
  } else {
    files.push(targetPath);
  }

  for (const filePath of files) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    const entries = Array.isArray(parsed) ? parsed : [parsed];
    for (const e of entries) {
      if (e && typeof e === 'object') out.push(e);
    }
  }

  return out;
}

function decorateEntries(entries, opts) {
  const inferred = opts.policyType || familyToPolicyType(opts.family);
  return entries.map((tpl) => {
    const metadata = { ...(tpl.metadata || {}) };
    if (!metadata.source) metadata.source = opts.source;
    if (!metadata.owner) metadata.owner = 'custom';
    if (!metadata.owner_display) metadata.owner_display = 'Custom';
    if (opts.family) metadata.family_id = opts.family;
    if (inferred) {
      metadata.policy_type = inferred;
      metadata.policy_type_normalized = inferred;
    }

    return {
      ...tpl,
      ...(inferred ? { policy_type: inferred } : {}),
      metadata,
    };
  });
}

async function main() {
  const opts = parseArgs(process.argv);
  if (!opts.target) {
    console.error('Usage: node scripts/import_reference_template.js <file-or-folder> [--family <id>] [--policyType <name>] [--source <label>] [--api <url>] [--overwrite|--no-overwrite]');
    process.exit(2);
  }

  const resolved = path.resolve(process.cwd(), opts.target);
  if (!fs.existsSync(resolved)) {
    console.error('Target not found:', resolved);
    process.exit(2);
  }

  let entries;
  try {
    entries = readJsonEntries(resolved);
  } catch (err) {
    console.error('Failed to read JSON input:', err && err.message ? err.message : err);
    process.exit(1);
  }

  if (!entries.length) {
    console.error('No importable template entries found.');
    process.exit(1);
  }

  const payload = decorateEntries(entries, opts);
  const url = `${String(opts.api).replace(/\/$/, '')}/api/reference-templates/import${opts.overwrite ? '?overwrite=true' : ''}`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    console.error('Import API failed:', resp.status, data && (data.error || data.message || JSON.stringify(data)));
    process.exit(1);
  }

  console.log('Import completed.');
  console.log(JSON.stringify(data, null, 2));
}

main().catch((err) => {
  console.error('Import failed:', err && err.message ? err.message : err);
  process.exit(1);
});
