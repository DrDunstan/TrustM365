#!/usr/bin/env node
'use strict'
const http = require('http')
const https = require('https')
const { URL } = require('url')
const fs = require('fs')
const path = require('path')

function req(method, base, p, body) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(base)
      const isHttps = u.protocol === 'https:'
      const opts = {
        method: method,
        hostname: u.hostname,
        port: u.port || (isHttps ? 443 : 80),
        path: (u.pathname.replace(/\/$/, '') || '') + p,
        headers: { 'Accept': 'application/json' }
      }
      let dataString = null
      if (body) {
        dataString = JSON.stringify(body)
        opts.headers['Content-Type'] = 'application/json'
        opts.headers['Content-Length'] = Buffer.byteLength(dataString)
      }
      const lib = isHttps ? https : http
      const r = lib.request(opts, res => {
        const chunks = []
        res.on('data', c => chunks.push(c))
        res.on('end', () => {
          const buf = Buffer.concat(chunks)
          const txt = buf.toString('utf8')
          if (res.statusCode >= 200 && res.statusCode < 300) {
            if (!txt) return resolve(null)
            try { return resolve(JSON.parse(txt)) } catch (e) { return resolve(txt) }
          }
          let msg = `HTTP ${res.statusCode} ${res.statusMessage}`
          try { const parsed = txt ? JSON.parse(txt) : null; msg += ' ' + JSON.stringify(parsed) } catch (e) { msg += ' ' + txt }
          const err = new Error(msg)
          err.statusCode = res.statusCode
          return reject(err)
        })
      })
      r.on('error', e => reject(e))
      if (dataString) r.write(dataString)
      r.end()
    } catch (e) { reject(e) }
  })
}

async function main() {
  const args = process.argv.slice(2)
  if (!args[0]) {
    console.error('Usage: node scripts/run_zerotrust_compare_for_tenant.js <tenantDisplayNameOrId> [baseURL] [outFile]')
    process.exit(2)
  }
  const tenantArg = args[0]
  const base = args[1] || 'http://127.0.0.1:3001'
  const outFile = args[2] || 'frontend/exports/contoso-zerotrust.json'

  console.log('Base URL:', base)
  console.log('Looking for tenant matching:', tenantArg)

  const tenants = await req('GET', base, '/api/tenants').catch(e => { console.error('Failed to list tenants:', e.message); process.exit(1) })
  if (!Array.isArray(tenants) || tenants.length === 0) {
    console.error('No tenants returned from API')
    process.exit(1)
  }

  const matches = tenants.filter(t => {
    if (!t) return false
    if (String(t.id) === tenantArg) return true
    if (t.display_name && t.display_name.toLowerCase() === tenantArg.toLowerCase()) return true
    if (t.display_name && t.display_name.toLowerCase().includes(tenantArg.toLowerCase())) return true
    return false
  })

  if (matches.length === 0) {
    console.error('No tenants matched. Available tenants:')
    tenants.forEach(t => console.error(`- ${t.id} => ${t.display_name || t.id}`))
    process.exit(2)
  }
  if (matches.length > 1) {
    console.error('Multiple tenants matched. Candidates:')
    matches.forEach(t => console.error(`- ${t.id} => ${t.display_name || t.id}`))
    console.error('Please provide a more specific tenant id or display name.')
    process.exit(2)
  }

  const tenant = matches[0]
  console.log('Using tenant:', tenant.id, tenant.display_name)

  const templates = await req('GET', base, '/api/reference-templates?forSecurity=true').catch(e => { console.error('Failed to list templates:', e.message); process.exit(1) })
  if (!Array.isArray(templates) || templates.length === 0) {
    console.error('No reference templates returned')
    process.exit(1)
  }

  console.log(`Found ${templates.length} Zero Trust templates. Running compare for tenant ${tenant.display_name}...`)

  const results = []
  for (const tpl of templates) {
    const id = tpl.id
    const name = tpl.name || tpl.display_name || tpl.template_id || id
    process.stdout.write(`Comparing ${id} — ${name} ... `)
    try {
      const cmp = await req('POST', base, `/api/reference-templates/${encodeURIComponent(id)}/compare`, { tenantId: tenant.id, scan: true })
      const items = Array.isArray(cmp && cmp.items) ? cmp.items : []
      const total = (cmp && cmp.summary && (cmp.summary.total || cmp.summary.totalItems)) || items.length || 0
      const matched = (cmp && cmp.summary && (cmp.summary.matched || cmp.summary.passing)) || items.filter(it => it && it.status === 'matched').length || 0
      const partial = (cmp && cmp.summary && (cmp.summary.partial || 0)) || items.filter(it => it && it.status === 'partial').length || 0
      const failing = Math.max(0, total - matched - partial)
      console.log(`OK — total:${total} matched:${matched} partial:${partial} failing:${failing}`)
      results.push({ id, name, total, matched, partial, failing, itemsCount: items.length, rawSummary: cmp && cmp.summary ? cmp.summary : undefined })
    } catch (e) {
      console.error('ERR', e && e.message ? e.message : e)
      results.push({ id, name, error: e && e.message ? e.message : String(e) })
    }
  }

  const totals = results.reduce((acc, r) => {
    if (r && typeof r.total === 'number') {
      acc.total += r.total
      acc.matched += r.matched || 0
      acc.partial += r.partial || 0
      acc.failing += r.failing || 0
    }
    return acc
  }, { total: 0, matched: 0, partial: 0, failing: 0 })

  const out = { tenant: { id: tenant.id, display_name: tenant.display_name }, base, generatedAt: new Date().toISOString(), totals, perTemplate: results }

  const outDir = path.dirname(outFile)
  try { fs.mkdirSync(outDir, { recursive: true }) } catch (e) {}
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2), 'utf8')
  console.log('Wrote results to', outFile)
  console.log('Summary — total items:', totals.total, 'matched:', totals.matched, 'failing:', totals.failing, 'partial:', totals.partial)
}

main().catch(e => { console.error('Fatal:', e && e.message ? e.message : e); process.exit(1) })
