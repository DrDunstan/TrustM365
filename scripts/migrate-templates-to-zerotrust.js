#!/usr/bin/env node
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const DIR = path.resolve(ROOT, 'backend', 'data', 'reference-templates')

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const DRY = !APPLY

function walk(dir) {
  const out = []
  for (const e of fs.readdirSync(dir)) {
    const full = path.join(dir, e)
    try {
      const st = fs.statSync(full)
      if (st.isDirectory()) out.push(...walk(full))
      else if (st.isFile() && full.toLowerCase().endsWith('.json')) out.push(full)
    } catch (e) {
      // ignore
    }
  }
  return out
}

function toPosix(p) { return p.replace(/\\/g, '/').toLowerCase() }

function guessOwner(filePath, metadata) {
  const p = toPosix(filePath)
  const src = (metadata && metadata.source) ? String(metadata.source).toLowerCase() : ''
  if (p.includes('/maester') || p.includes('/cisa') || p.includes('/cisa-scuba') || src.includes('maester') || src.includes('cisa')) return 'zerotrust'
  if (p.includes('/zerotrust') || src.includes('zerotrust')) return 'zerotrust'
  if (src.includes('openintune') || p.includes('openintune') || src.includes('open-intune')) return 'openintune'
  return null
}

function guessCategory(t) {
  const area = String(t.area_key || t.areaKey || '').toLowerCase()
  const name = String(t.name || t.display_name || t.id || t.template_id || '').toLowerCase()
  const sample = `${area} ${name}`
  const identity = ['role', 'pim', 'privileged', 'identity', 'sign', 'risk', 'auth', 'conditional', 'ca', 'admin']
  const devices = ['intune', 'device', 'endpoint', 'ep', 'tpm', 'compliance', 'profile', 'configuration', 'bitlocker', 'autopilot']
  if (identity.some(k => sample.includes(k))) return 'Identity'
  if (devices.some(k => sample.includes(k))) return 'Devices'
  return null
}

function processFile(file) {
  let raw
  try { raw = fs.readFileSync(file, 'utf8') } catch (err) { console.error('read error', file, err.message); return null }
  let parsed
  try { parsed = JSON.parse(raw) } catch (err) { console.error('parse error', file, err.message); return null }
  const isArr = Array.isArray(parsed)
  const entries = isArr ? parsed : [parsed]
  const updates = []
  for (const t of entries) {
    if (!t || typeof t !== 'object') continue
    t.metadata = t.metadata || {}
    const beforeOwner = t.metadata.owner || null
    const guessed = guessOwner(file, t.metadata)
    if (guessed === 'zerotrust' && String(beforeOwner || '').toLowerCase() !== 'zerotrust') {
      t.metadata.owner = 'zerotrust'
      t.metadata.owner_display = t.metadata.owner_display || 'Zero Trust Assessment'
      updates.push({ field: 'owner', from: beforeOwner, to: 'zerotrust' })
    }

    const beforeCat = t.metadata.category || null
    if (!beforeCat) {
      const cat = guessCategory(t)
      if (cat) {
        t.metadata.category = cat
        updates.push({ field: 'category', from: beforeCat, to: cat })
      }
    }
  }

  if (updates.length === 0) return null

  const outObj = isArr ? entries : entries[0]
  return { file, raw, outObj, updates }
}

function main() {
  if (!fs.existsSync(DIR)) {
    console.error('Reference templates directory not found:', DIR)
    process.exit(2)
  }

  const files = walk(DIR)
  const changed = []
  for (const f of files) {
    const r = processFile(f)
    if (r) changed.push(r)
  }

  if (changed.length === 0) {
    console.log(DRY ? 'Dry-run: no changes detected.' : 'No changes applied.')
    return
  }

  console.log((DRY ? 'Dry-run:' : 'Applying:') + ` ${changed.length} file(s) would be modified:`)
  for (const c of changed) {
    console.log(`- ${path.relative(process.cwd(), c.file)}`)
    for (const u of c.updates) console.log(`    * ${u.field}: ${u.from} -> ${u.to}`)
  }

  if (DRY) return

  // Apply changes with backups
  for (const c of changed) {
    try {
      const bak = `${c.file}.bak`
      if (!fs.existsSync(bak)) fs.writeFileSync(bak, c.raw, 'utf8')
      fs.writeFileSync(c.file, JSON.stringify(c.outObj, null, 2) + '\n', 'utf8')
      console.log('WROTE:', c.file)
    } catch (err) {
      console.error('Failed to write', c.file, err.message)
    }
  }

  console.log('Applied changes and created .bak files for modified files.')
}

main()
