const reg = require('../backend/src/referenceTemplates/registry');
const list = reg.listTemplates();
const open = list.filter(t => (t.metadata && t.metadata.owner) === 'openintune');
for (const t of open) {
  const full = reg.getTemplate(t.id);
  console.log('---', t.id);
  console.log('watched_keys:', (full.watched_keys || []).slice(0, 10));
}
