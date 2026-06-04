const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

(async () => {
  try {
    const SQL = await initSqlJs();
    const dbPath = path.resolve(__dirname, '../../data/trustm365.db');
    if (!fs.existsSync(dbPath)) {
      console.error('DB file not found:', dbPath);
      process.exit(2);
    }
    const buffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(buffer);

    const res = db.exec('SELECT count(*) as cnt FROM baseline_templates');
    if (!res || res.length === 0) {
      console.log('No baseline_templates table present or no results');
      process.exit(0);
    }
    const cnt = res[0].values && res[0].values[0] && res[0].values[0][0];
    console.log('baseline_templates count =', cnt);

    const rows = db.exec('SELECT id, name, area_key FROM baseline_templates LIMIT 20');
    if (rows && rows.length > 0) {
      const cols = rows[0].columns;
      for (const r of rows[0].values) {
        const obj = {};
        for (let i = 0; i < cols.length; i++) obj[cols[i]] = r[i];
        console.log(obj.id + '\t' + obj.name + '\t' + obj.area_key);
      }
    } else {
      console.log('No rows returned from baseline_templates');
    }

    db.close();
  } catch (err) {
    console.error('Error reading DB:', err && err.message ? err.message : err);
    process.exit(1);
  }
})();
