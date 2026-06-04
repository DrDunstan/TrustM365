const registry = require('../src/referenceTemplates/registry');

try {
  const templates = registry.reload();
  const owners = registry.listOwners();
  console.log('Owners:');
  console.log(JSON.stringify(owners, null, 2));
  console.log('\nTotal templates:', templates.length);
  console.log('Template IDs:');
  console.log(templates.map(t => t.id).join(',\n'));

  console.log('\nTemplates by owner:');
  for (const o of owners) console.log(`  ${o.key}: ${o.display}`);
} catch (err) {
  console.error('Failed to reload/list templates:', err && err.message ? err.message : err);
  process.exit(1);
}
