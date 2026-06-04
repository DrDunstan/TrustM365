const path = require('path')
const fs = require('fs')

const registry = require(path.resolve(__dirname, '../src/referenceTemplates/registry'))
const collectorsIndex = require(path.resolve(__dirname, '../src/collectors/index'))
let tests = {}
try { tests = require(path.resolve(__dirname, '../src/referenceTemplates/tests')) } catch (e) { tests = {} }

function getByPath(obj, pathStr) {
  if (!pathStr) return undefined
  const parts = String(pathStr).split('.')
  let cur = obj
  for (let p of parts) {
    if (cur === undefined || cur === null) return undefined
    const sel = p.match(/^([^\[]+)\[([^=]+)=([^\]]+)\]$/)
    if (sel) {
      const prop = sel[1]
      const idProp = sel[2]
      const idVal = sel[3]
      cur = cur[prop]
      if (!Array.isArray(cur)) return undefined
      const found = cur.find(el => String((el && el[idProp]) ?? '') === String(idVal))
      cur = found
      continue
    }
    if (Array.isArray(cur) && /^[0-9]+$/.test(p)) {
      cur = cur[Number(p)]
    } else {
      cur = cur[p]
    }
  }
  return cur
}

function firstSegment(pathStr) {
  if (!pathStr) return ''
  const s = String(pathStr)
  const m = s.match(/^([^\.\[]+)/)
  return m ? m[1] : s
}

function checkOwner(ownerKey) {
  const list = registry.listTemplates({ owner: ownerKey })
  const problems = []
  for (const summary of list) {
    const tpl = registry.getTemplate(summary.id)
    if (!tpl) { problems.push({ template: summary.id, message: 'Template file missing' }); continue }
    const watched = tpl.watched_keys || []
    // For each watched_key ensure at least one resource contains that path
    for (const wk of watched) {
      const path = (typeof wk === 'string') ? wk : (wk.path || '')
      const foundIn = Object.values(tpl.resources || {}).some(r => getByPath(r, path) !== undefined)
      if (!foundIn) problems.push({ template: tpl.id, watched_key: path, message: 'watched_key not present in any resource' })
    }

    // For each resource, ensure it has either a testId or at least one watched_key that applies to it
    for (const [rid, res] of Object.entries(tpl.resources || {})) {
      if (res.testId) {
        if (!tests[res.testId]) problems.push({ template: tpl.id, resource: rid, message: `testId '${res.testId}' not found in tests` })
      }
      // check if any watched_key points into this resource
      const relevant = (watched || []).some(wk => {
        const p = typeof wk === 'string' ? wk : (wk.path || '')
        return getByPath(res, p) !== undefined
      })
      if (!res.testId && !relevant) problems.push({ template: tpl.id, resource: rid, message: 'no testId and no relevant watched_keys' })
    }

    // Collector presence and watchableKeys alignment
    const collector = collectorsIndex[tpl.area_key]
    if (!collector) {
      problems.push({ template: tpl.id, message: `no collector found for area_key '${tpl.area_key}'` })
    } else {
      const ck = (collector.watchableKeys || []).map(k => k.path || k)
      for (const wk of watched) {
        const p = typeof wk === 'string' ? wk : (wk.path || '')
        const first = firstSegment(p)
        const has = ck.some(cpath => first === cpath || first === firstSegment(cpath))
        if (!has) problems.push({ template: tpl.id, watched_key: p, message: `watch key prefix '${first}' not exposed by collector for area '${tpl.area_key}'` })
      }
    }
  }
  return problems
}

function run() {
  const ownerList = registry.listOwners().map(o => o.key).filter(k => k && !['community', 'openintune', 'custom'].includes(k))
  const allProblems = []
  for (const o of ownerList) {
    console.log(`Checking owner: ${o}`)
    const p = checkOwner(o)
    if (p.length === 0) console.log(`  OK: No structural problems found for '${o}'`)
    else {
      console.log(`  Found ${p.length} problems for '${o}':`)
      for (const pr of p) {
        console.log('   -', JSON.stringify(pr))
        allProblems.push(pr)
      }
    }
  }

  if (allProblems.length === 0) {
    console.log('\nVerification complete — no mismatches detected (structural checks).')
    process.exit(0)
  }
  console.log(`\nVerification complete — ${allProblems.length} potential issues found.`)
  process.exit(0)
}

run()
