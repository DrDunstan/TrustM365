const reg = require('../backend/src/referenceTemplates/registry');
const list = reg.listTemplates();
console.log('Total templates:', list.length);
const owners = {};
for (const t of list) {
  const k = (t.metadata && t.metadata.owner) || 'unknown';
  owners[k] = (owners[k] || 0) + 1;
}
console.log('Owners summary:', owners);
console.log('OpenIntune samples:');
console.log(list.filter(t => (t.metadata && t.metadata.owner) === 'openintune').slice(0,10));
