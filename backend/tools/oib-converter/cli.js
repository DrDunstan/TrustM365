#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const parser = require('./parsers/intuneExportParser');
const mapper = require('./mappers/oibToTrustMapper');
const writer = require('./writer');

function printHelp() {
  console.log('Usage: node cli.js --input <inputDir> --templates <comma-separated names> --out <outDir> [--dry-run] [--area-key <area_key>] [--owner <owner>] [--owner-display <owner_display>]');
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { input: null, templates: [], out: null, dryRun: false, areaKey: null, owner: null, ownerDisplay: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--input') opts.input = args[++i];
    else if (a === '--templates') opts.templates = args[++i].split(',').map(s => s.trim());
    else if (a === '--out') opts.out = args[++i];
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--area-key') opts.areaKey = args[++i];
    else if (a === '--owner') opts.owner = args[++i];
    else if (a === '--owner-display') opts.ownerDisplay = args[++i];
    else if (a === '--help') { printHelp(); process.exit(0); }
  }
  return opts;
}

async function main() {
  const opts = parseArgs();
  if (!opts.input) { console.error('Missing --input'); printHelp(); process.exit(1); }
  if (!opts.templates || opts.templates.length === 0) { console.error('Missing --templates'); printHelp(); process.exit(1); }
  const outDir = opts.out || path.join('backend','data','reference-templates','open-intune-baseline');

  const mappingDir = path.join(__dirname,'mappings');
  const mappingHints = {};
  if (fs.existsSync(mappingDir)) {
    for (const f of fs.readdirSync(mappingDir)) {
      if (f.endsWith('.json')) {
        try {
          mappingHints[path.basename(f, '.json')] = JSON.parse(fs.readFileSync(path.join(mappingDir, f), 'utf8'));
        } catch (e) { /* ignore malformed */ }
      }
    }
  }

  // normalize requested templates to lower-case keys
  const requested = opts.templates.map(t => t.toLowerCase());

  const inputFiles = fs.existsSync(opts.input) ? fs.readdirSync(opts.input).filter(f => f.toLowerCase().endsWith('.json')) : [];
  if (inputFiles.length === 0) { console.error('No JSON files found in input:', opts.input); process.exit(1); }

  for (const req of requested) {
    // attempt to find mapping key matching req
    const mappingKey = Object.keys(mappingHints).find(k => k.toLowerCase().includes(req) || (mappingHints[k].display_name && mappingHints[k].display_name.toLowerCase().includes(req))) || req;

    const inFile = inputFiles.find(f => f.toLowerCase().includes(mappingKey));
    if (!inFile) {
      console.warn(`No input JSON matched for template '${req}'. Searched for '${mappingKey}'.`);
      continue;
    }

    const fullPath = path.join(opts.input, inFile);
    let policy;
    try {
      policy = parser.parseFile(fullPath);
    } catch (e) {
      console.error('Failed to parse', fullPath, e.message);
      continue;
    }

    // Clone mappingHints for this template and allow CLI overrides (area_key, owner, owner_display)
    const hints = Object.assign({}, mappingHints[mappingKey] || {});
    if (opts.areaKey) hints.area_key = opts.areaKey;
    if (opts.owner) hints.owner = opts.owner;
    if (opts.ownerDisplay) hints.owner_display = opts.ownerDisplay;
    const mapped = mapper.mapPolicy(policy, hints);
    if (opts.dryRun) {
      console.log('DRY RUN - mapped template:');
      console.log(JSON.stringify(mapped, null, 2));
    } else {
      try {
        const outPath = writer.write(mapped, outDir);
        console.log('WROTE', outPath);
      } catch (e) {
        console.error('Failed to write mapped template', e.message);
      }
    }
  }
}

main();
