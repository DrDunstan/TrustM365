const { initDatabase } = require('../src/database/init');

(async () => {
  try {
    const db = await initDatabase();
    const rows = db.prepare("SELECT id,name,description,area_key,resources FROM baseline_templates").all();
    console.log('baseline_templates count:', rows.length);
    let found = 0;
    for (const r of rows) {
      const id = r.id || '';
      const name = r.name || '';
      const desc = r.description || '';
      const area = r.area_key || '';
      const resources = r.resources || '';
      const hay = (id + ' ' + name + ' ' + desc + ' ' + area + ' ' + resources).toLowerCase();
      const match = hay.includes('zerotrust') || hay.includes('zero trust') || hay.includes('zerotrustassessment') || hay.includes('zero-trust') || hay.includes('zerotrust-');
      if (match) {
        console.log('MATCH:', id, '|', name, '|', area);
        found++;
      }
    }
    console.log('matches:', found);
    process.exit(0);
  } catch (e) {
    console.error('error', e && e.message);
    process.exit(2);
  }
})();
