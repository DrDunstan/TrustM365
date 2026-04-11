#!/usr/bin/env node
const crypto = require('crypto');
const key = crypto.randomBytes(32).toString('hex');
console.log('\n✅ Copy this into your .env as ENCRYPTION_KEY:\n');
console.log(key + '\n');
