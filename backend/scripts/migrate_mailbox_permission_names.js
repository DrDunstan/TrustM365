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

    if (!apply) {
      console.log('[info] Dry-run mode (no changes). To apply changes, re-run with --apply');
    }

    if (apply) {
      const bakPath = `${DB_PATH}.mailboxpermigrate.${Date.now()}`;
      fs.copyFileSync(DB_PATH, bakPath);
      console.log('[backup] Database backed up to', bakPath);
    }

    const db = await openDatabase(DB_PATH);
    const tenants = db.prepare('SELECT id, permissions_json FROM tenants').all();

    let updated = 0;
    for (const t of tenants) {
      if (!t.permissions_json) continue;
      let parsed;
      try {
        parsed = JSON.parse(t.permissions_json);
      } catch (err) {
        console.log(`[skip] tenant ${t.id} — permissions_json parse error`);
        continue;
      }
      if (!Array.isArray(parsed.areas)) continue;
      let changed = false;
      for (const a of parsed.areas) {
        if (Array.isArray(a.readPermissions)) {
          const newRead = a.readPermissions.map(p => (typeof p === 'string' && p.startsWith('MailboxSettings.') && p.endsWith('.All') ? p.slice(0, -4) : p));
          if (JSON.stringify(newRead) !== JSON.stringify(a.readPermissions)) {
            a.readPermissions = newRead;
            changed = true;
          }
        }
        if (Array.isArray(a.writePermissions)) {
          const newWrite = a.writePermissions.map(p => (typeof p === 'string' && p.startsWith('MailboxSettings.') && p.endsWith('.All') ? p.slice(0, -4) : p));
          if (JSON.stringify(newWrite) !== JSON.stringify(a.writePermissions)) {
            a.writePermissions = newWrite;
            changed = true;
          }
        }
      }
      if (changed) {
        console.log(`[update] tenant ${t.id} — updating mailbox permission names`);
        if (apply) {
          db.prepare('UPDATE tenants SET permissions_json = ? WHERE id = ?').run(JSON.stringify(parsed), t.id);
        }
        updated++;
      }
    }

    if (db && db.close) db.close();

    console.log(`\nDone. Tenants affected: ${updated} (applied: ${apply ? 'yes' : 'no'})`);
  } catch (err) {
    console.error('[error]', err);
    process.exit(1);
  }
})();
