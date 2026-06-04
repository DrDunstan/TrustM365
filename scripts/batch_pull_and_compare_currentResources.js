#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

if (process.argv.length < 3) {
  console.error('Usage: node scripts/batch_pull_and_compare_currentResources.js <tenantInternalId>');
  process.exit(2);
}
const tenant = process.argv[2];

const dir = path.join(__dirname, '..', 'backend', 'data', 'reference-templates', 'open-intune-baseline');
if (!fs.existsSync(dir)) {
  console.error('Templates dir not found:', dir);
  process.exit(1);
}
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
if (files.length === 0) {
  console.log('No templates found');
  process.exit(0);
}

for (const f of files) {
  const tpl = path.basename(f, '.json');
  console.log('\n=== ' + tpl + ' ===');
  try {
    execSync(`node scripts/pull_and_compare_currentResources.js ${tpl} ${tenant}`, { stdio: 'inherit' });
  } catch (err) {
    console.error('Error running compare for', tpl, err && err.message ? err.message : err);
  }
}

process.exit(0);
