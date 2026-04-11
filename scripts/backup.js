#!/usr/bin/env node
const fs = require('fs'), path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const dbPath = process.env.DATABASE_PATH || './data/trustm365.db';
const backupDir = path.join(path.dirname(dbPath), 'backups');
if (!fs.existsSync(dbPath)) { console.error('❌ Database not found:', dbPath); process.exit(1); }
if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
const dest = path.join(backupDir, `trustm365-${new Date().toISOString().replace(/[:.]/g,'-')}.db`);
fs.copyFileSync(dbPath, dest);
console.log('✅ Backup saved:', dest);
