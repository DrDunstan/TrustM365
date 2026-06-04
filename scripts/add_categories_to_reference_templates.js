#!/usr/bin/env node
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..', 'backend', 'data', 'reference-templates')

function walk(dir) {
  const files = []
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    const stat = fs.statSync(full)
    if (stat.isDirectory()) files.push(...walk(full))
    else if (stat.isFile() && full.endsWith('.json')) files.push(full)
  }
  return files
}

function detectCategory(obj) {
  const area = String((obj.area_key || obj.areaKey || obj.area || '')).toLowerCase()
  const owner = String(((obj.metadata && obj.metadata.owner) || obj.source || '')).toLowerCase()
  if (area.includes('intune') || area.includes('device') || area.includes('endpoint') || area.includes('tpm') || owner.includes('openintune')) return 'Devices'
  if (area.includes('entra') || area.includes('auth') || area.includes('authorization') || area.includes('identity') || area.includes('mfa') || area.includes('pim') || area.includes('passwordless')) return 'Identity'
  if (area.includes('exchange') || area.includes('mail') || area.includes('transport') || area.includes('teams') || area.includes('sharepoint') || area.includes('office') || area.includes('onedrive')) return 'Collaboration'
  if (area.includes('security') || area.includes('defender') || area.includes('antivirus') || area.includes('attack') || area.includes('hardening')) return 'Security'
  return 'Uncategorized'
}

const files = walk(root)
const changed = []
for (const f of files) {
  try {
    const txt = fs.readFileSync(f, 'utf8')
    const obj = JSON.parse(txt)
    obj.metadata = obj.metadata || {}
    if (!Object.prototype.hasOwnProperty.call(obj.metadata, 'category') || !obj.metadata.category || String(obj.metadata.category).trim() === '') {
      const cat = detectCategory(obj)
      obj.metadata.category = cat
      fs.writeFileSync(f, JSON.stringify(obj, null, 2) + '\n', 'utf8')
      changed.push({ file: f, category: cat })
    }
  } catch (e) {
    console.error('Failed to process', f, e && e.message)
  }
}

console.log('Updated', changed.length, 'files')
for (const c of changed) console.log(c.file, '->', c.category)
