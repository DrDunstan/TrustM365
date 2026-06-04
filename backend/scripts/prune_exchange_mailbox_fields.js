const path = require('path');
const fs = require('fs');
const { openDatabase } = require('../src/database/sqlite');

(async function main() {
  try {
    const DB_PATH = process.env.DATABASE_PATH
      ? path.resolve(process.env.DATABASE_PATH)
      : path.resolve(__dirname, '../../data/trustm365.db');

    if (!fs.existsSync(DB_PATH)) {
      console.error('[abort] Database file not found at', DB_PATH);
      process.exit(2);
    }

    const args = process.argv.slice(2);
    const apply = args.includes('--apply') || args.includes('-a');

    if (!apply) console.log('[info] Dry-run mode (no changes). To apply changes, re-run with --apply');
    if (apply) {
      const bakPath = `${DB_PATH}.pruneexchange.${Date.now()}`;
      fs.copyFileSync(DB_PATH, bakPath);
      console.log('[backup] Database backed up to', bakPath);
    }

    const db = await openDatabase(DB_PATH);

    const tablesToCheck = ['live_snapshots', 'baselines', 'baseline_history', 'restore_log'];
    let totalAffected = 0;

    for (const tbl of tablesToCheck) {
      // Some tables may not exist in older DBs — skip errors
      try {
        const rows = db.prepare(`SELECT id, tenant_id, area_key, resources FROM ${tbl} WHERE area_key LIKE 'exchange_%'`).all();
        for (const r of rows) {
          if (!r.resources) continue;
          let parsed;
          try { parsed = JSON.parse(r.resources); } catch { continue; }
          let changed = false;
          for (const [rid, res] of Object.entries(parsed || {})) {
            if (!res) continue;
            // Remove mailbox-level fields if present
            const keysToRemove = ['mailboxSettings', 'forwardingEnabled', 'forwardingSamples', 'inboxRulesCount', 'inboxRulesSamples'];
            for (const k of keysToRemove) {
              if (k in res) {
                delete res[k];
                changed = true;
              }
            }
          }
          if (changed) {
            totalAffected++;
            console.log(`[would-update] ${tbl} id=${r.id} tenant=${r.tenant_id} area=${r.area_key}`);
            if (apply) {
              db.prepare(`UPDATE ${tbl} SET resources = ? WHERE id = ?`).run(JSON.stringify(parsed), r.id);
            }
          }
        }
      } catch (err) {
        // ignore missing tables or other read errors
      }
    }

    if (db && db.close) db.close();
    console.log(`\nDone. Rows affected: ${totalAffected} (applied: ${apply ? 'yes' : 'no'})`);
  } catch (err) {
    console.error('[error]', err);
    process.exit(1);
  }
})();
