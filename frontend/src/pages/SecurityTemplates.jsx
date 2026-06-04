import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  ShieldCheck, CheckCircle, XCircle, AlertCircle, ChevronDown, ChevronRight,
  RefreshCw, Info, ExternalLink, Users, Tag, Shield, Eye
} from 'lucide-react'
import { tenantApi, templateApi, referenceApi } from '../api/client.js'

export default function SecurityTemplates({ showToast }) {
  const [tenants, setTenants] = useState([])
  const [selectedTenants, setSelectedTenants] = useState([])
  const [results, setResults] = useState({})
  const [lastRun, setLastRun] = useState(null)
  const [assessmentTemplates, setAssessmentTemplates] = useState([])
  const [selectedAssessmentTemplates, setSelectedAssessmentTemplates] = useState([])
  const [selectedControls, setSelectedControls] = useState([])
  // Security UI is Zero Trust only — no owner selection required
  const [owners, setOwners] = useState([{ key: 'zerotrust', display: 'Zero Trust Assessment' }])
  const [selectedOwner, setSelectedOwner] = useState('zerotrust')
  const [assessmentRunning, setAssessmentRunning] = useState(false)
  const [assessmentResults, setAssessmentResults] = useState({})
  const [detailModal, setDetailModal] = useState({ open: false, tplId: null, tenantId: null })
  const [ownerSummaryData, setOwnerSummaryData] = useState({ occurrences: { total: 0, passing: 0, failing: 0 }, unique: { total: 0, passing: 0, failing: 0 } })
  const [ownerSummaryLoading, setOwnerSummaryLoading] = useState(false)
  const [perTemplateSummary, setPerTemplateSummary] = useState({})
  const [modalShowOnlyFailures, setModalShowOnlyFailures] = useState(false)
  const [modalExpandAll, setModalExpandAll] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState('all')

  // Merge multiple template arrays uniquely by `id` (preserves first-seen order)
  const mergeTemplatesUnique = (...arrays) => {
    const map = new Map()
    for (const arr of arrays) {
      if (!Array.isArray(arr)) continue
      for (const t of arr) {
        if (t && t.id && !map.has(t.id)) map.set(t.id, t)
      }
    }
    return Array.from(map.values())
  }

  const stripZeroTrustPrefix = (s) => {
    if (!s && s !== '') return s
    try {
      return String(s).replace(/^\s*(?:zero\s*trust|zerotrust)\s*(?:[:\-–—]\s*)?/i, '').trim()
    } catch (e) {
      return s
    }
  }

  const selectedOwnerDisplay = (selectedOwner && selectedOwner !== 'all') ? (owners.find(o => o.key === selectedOwner)?.display || selectedOwner) : 'Zero Trust Assessment'
  const headerDescription = 'Zero Trust Assessment: curated checks for Identity and Devices.'

  const makeControlKey = (tplId, refKey) => `${tplId}||${refKey}`
  const toggleControlSelection = (key) => setSelectedControls(prev => {
    // toggle a single control key in the selectedControls array
    return prev && prev.includes(key) ? prev.filter(k => k !== key) : [...(prev || []), key]
  })

  useEffect(() => {
    tenantApi.list()
      .then(data => {
        setTenants(data)
        setSelectedTenants([])
      })
      .catch(() => showToast('Failed to load tenants', 'error'))

    // Security UI targets Zero Trust only — owners are static for this view
    setOwners([{ key: 'zerotrust', display: 'Zero Trust Assessment' }])
    setSelectedOwner('zerotrust')

    const loadInitialTemplates = async () => {
      try {
        const [dbRes, regRes] = await Promise.allSettled([
          templateApi.list(undefined, { full: true }),
          referenceApi.list(undefined, { forSecurity: true })
        ])

        const dbList = (dbRes && dbRes.status === 'fulfilled') ? (dbRes.value || []) : []
        const registryList = (regRes && regRes.status === 'fulfilled') ? (regRes.value || []) : []

        // Merge DB + registry results, prefer DB items first
        const merged = mergeTemplatesUnique(dbList, registryList)

        // Normalize templates: ensure `name` exists (fallback to display_name),
        // and ensure `resources` and `watched_keys` are proper objects/arrays.
        const normalized = (merged || []).map(t => {
          const name = t.name || t.display_name || t.displayName || ''
          const description = t.description || t.desc || ''
          let resources = t.resources || {}
          try { if (typeof resources === 'string' && resources.trim().length > 0) resources = JSON.parse(resources) } catch (e) { resources = t.resources || {} }
          let watched_keys = t.watched_keys || t.watchedKeys || []
          try { if (typeof watched_keys === 'string' && watched_keys.trim().length > 0) watched_keys = JSON.parse(watched_keys) } catch (e) { watched_keys = watched_keys || [] }
          return { ...t, name, description, resources, watched_keys }
        })

        // Only include Zero Trust templates in categories Identity / Devices
        const filterFn = (t) => {
          if (!t) return false
          const nm = t.name || t.display_name || t.displayName || ''
          if (!nm || String(nm).trim().length === 0) return false
          const owner = (t.metadata && t.metadata.owner) ? String(t.metadata.owner).toLowerCase() : ''
          const category = (t.metadata && t.metadata.category) ? String(t.metadata.category).toLowerCase() : ''
          if (owner !== 'zerotrust') return false
          // allow templates with no category defined, otherwise restrict to Identity/Devices
          if (category && !['identity', 'devices'].includes(category)) return false
          return true
        }

        const filtered = (normalized || []).filter(filterFn)

        setAssessmentTemplates(filtered)
        setSelectedAssessmentTemplates([])
      } catch (err) {
        /* ignore */
      }
    }

    loadInitialTemplates()
  }, [])

    // Owner summary runs only when explicitly requested by the user.
    // Use `fetchOwnerSummary` to trigger a live run.
    const mountedRef = useRef(true)

    useEffect(() => {
      return () => { mountedRef.current = false }
    }, [])

    const fetchOwnerSummary = useCallback(async () => {
      if (selectedTenants.length === 0) {
          setOwnerSummaryData({ occurrences: { total: 0, passing: 0, partial: 0, failing: 0 }, unique: { total: 0, passing: 0, failing: 0 } })
          setPerTemplateSummary({})
          return
        }
      setOwnerSummaryLoading(true)
      try {
        const ownerKeys = selectedOwner === 'all' ? (owners || []).filter(o => o.key !== 'all').map(o => o.key) : [selectedOwner]
        const requests = []
        for (const tenantId of selectedTenants) {
          for (const ownerKey of ownerKeys) {
            requests.push(templateApi.ownerSummary(ownerKey, tenantId).then(r => ({ ownerKey, tenantId, res: r })).catch(() => null))
          }
        }
        const results = await Promise.all(requests)

        const tenantNameMap = Object.fromEntries((tenants || []).map(t => [t.id, t.display_name]))

        const totals = { total: 0, passing: 0, failing: 0 }
        const perTpl = {}
        for (const entry of results) {
          if (!entry || !entry.res) continue
          const r = entry.res
          const tenantId = entry.tenantId
          totals.total += r.summary?.total || 0
          totals.passing += r.summary?.passing || 0
          // partial counts are not surfaced in the summary cards; compute failing from totals later
          totals.failing += r.summary?.failing || 0

          for (const tpl of r.templates || []) {
            const id = tpl.templateId
            if (!perTpl[id]) perTpl[id] = { templateId: id, name: tpl.name, area_key: tpl.area_key, note: tpl.note, total: 0, passing: 0, partial: 0, failing: 0, items: {}, tenants: {} }
            perTpl[id].total += tpl.summary?.total || 0
            perTpl[id].passing += tpl.summary?.passing || 0
            perTpl[id].partial += tpl.summary?.partial || 0
            perTpl[id].failing += tpl.summary?.failing || 0

            if (!perTpl[id].tenants[tenantId]) perTpl[id].tenants[tenantId] = { tenantId, tenantName: tenantNameMap[tenantId] || tenantId, total: 0, passing: 0, partial: 0, failing: 0, items: {} }
            perTpl[id].tenants[tenantId].total += tpl.summary?.total || 0
            perTpl[id].tenants[tenantId].passing += tpl.summary?.passing || 0
            perTpl[id].tenants[tenantId].partial += tpl.summary?.partial || 0
            perTpl[id].tenants[tenantId].failing += tpl.summary?.failing || 0

            for (const it of tpl.items || []) {
              const rid = it.refId
              if (!perTpl[id].items[rid]) perTpl[id].items[rid] = { refId: rid, refDisplayName: it.refDisplayName || rid, matchedCount: 0, partialCount: 0, totalOccurrences: 0, sampleMatchAll: [] }
              perTpl[id].items[rid].totalOccurrences += 1
              if (it.status === 'matched') perTpl[id].items[rid].matchedCount += 1
              if (it.status === 'partial') perTpl[id].items[rid].partialCount += 1
              const samples = (it.matchedSamples && it.matchedSamples.length > 0)
                ? it.matchedSamples.slice(0,3)
                : (it.matchAll && it.matchAll.length > 0 ? it.matchAll.slice(0,3) : [])
              for (const m of samples) {
                const name = (m && (m.displayName || m.id)) || String(m)
                const key = name
                const exists = perTpl[id].items[rid].sampleMatchAll.find(s => (typeof s === 'string' ? s === key : s.key === key || s.displayName === key))
                if (!exists) {
                  perTpl[id].items[rid].sampleMatchAll.push(typeof m === 'string' ? m : { key, displayName: name, matchedPaths: (m && m.matchedPaths) || [] })
                }
              }

              if (!perTpl[id].tenants[tenantId].items[rid]) perTpl[id].tenants[tenantId].items[rid] = { refId: rid, refDisplayName: it.refDisplayName || rid, matchedCount: 0, partialCount: 0, totalOccurrences: 0, sampleMatchAll: [] }
              perTpl[id].tenants[tenantId].items[rid].totalOccurrences += 1
              if (it.status === 'matched') perTpl[id].tenants[tenantId].items[rid].matchedCount += 1
              if (it.status === 'partial') perTpl[id].tenants[tenantId].items[rid].partialCount += 1
              const tenantSamples = (it.matchedSamples && it.matchedSamples.length > 0)
                ? it.matchedSamples.slice(0,3)
                : (it.matchAll && it.matchAll.length > 0 ? it.matchAll.slice(0,3) : [])
              for (const m of tenantSamples) {
                const name = (m && (m.displayName || m.id)) || String(m)
                const key = name
                const exists = perTpl[id].tenants[tenantId].items[rid].sampleMatchAll.find(s => (typeof s === 'string' ? s === key : s.key === key || s.displayName === key))
                if (!exists) {
                  perTpl[id].tenants[tenantId].items[rid].sampleMatchAll.push(typeof m === 'string' ? m : { key, displayName: name, matchedPaths: (m && m.matchedPaths) || [] })
                }
              }
            }
          }
        }

        Object.values(perTpl).forEach(p => {
          p.items = Object.values(p.items || {})
          const tenantsObj = p.tenants || {}
          Object.entries(tenantsObj).forEach(([tid, t]) => {
            t.items = Object.values(t.items || {})
          })
          p.tenants = tenantsObj
        })

        const uniqueTotals = { total: 0, passing: 0, failing: 0 }
        Object.values(perTpl).forEach(p => {
          const itemsArr = p.items || []
          uniqueTotals.total += itemsArr.length
          uniqueTotals.passing += itemsArr.filter(it => (it.matchedCount || 0) > 0).length
        })
        uniqueTotals.failing = Math.max(0, uniqueTotals.total - uniqueTotals.passing)

        if (mountedRef.current) {
          setOwnerSummaryData({ occurrences: totals, unique: uniqueTotals })
          setPerTemplateSummary(perTpl)
        }
      } catch (err) {
        if (mountedRef.current) {
          setOwnerSummaryData({ occurrences: { total: 0, passing: 0, failing: 0 }, unique: { total: 0, passing: 0, failing: 0 } })
          setPerTemplateSummary({})
        }
      } finally {
        if (mountedRef.current) setOwnerSummaryLoading(false)
      }
    }, [selectedOwner, selectedTenants, owners, tenants])

  // Inline expansion removed; use the template detail modal for per-check details

  const fetchLiveData = useCallback(async (tenantIds) => {
    const areaKeys = [...new Set(
      (assessmentTemplates || [])
        .filter(t => selectedAssessmentTemplates.includes(t.id))
        .map(t => t.area_key)
    )].filter(Boolean)
    const data = {}
    for (const tenantId of tenantIds) {
      data[tenantId] = {}
      for (const areaKey of areaKeys) {
        try {
          const res = await fetch(`/api/areas/${tenantId}/${areaKey}/live`)
          if (res.ok) {
            const snap = await res.json()
            data[tenantId][areaKey] = snap.resources || {}
          }
        } catch { /* area not available */ }
      }
    }
    return data
  }, [assessmentTemplates, selectedAssessmentTemplates])

  const formatItemSentence = (it) => {
    if (!it) return ''
    const title = it.refDisplayName || it.refId || ''
    // aggregated item shape (only when totalOccurrences present): show tenant-level counts
    if (it.totalOccurrences !== undefined) {
      if (!it.totalOccurrences) return `${title} — No tenants scanned.`
      if (it.matchedCount === 0) return `${title} — 0 tenants with matching resources (no issues detected).`
      return `${title} — ${it.matchedCount} tenant${it.matchedCount !== 1 ? 's' : ''} with matching resources.`
    }
    if (it.status === 'matched') {
      // Determine whether there are actual matched resources (some tests are "negative" checks)
      const hasMatches = (Array.isArray(it.matchAll) && it.matchAll.length > 0) || (Array.isArray(it.matchedSamples) && it.matchedSamples.length > 0) || (it.presentInPolicies && it.presentInPolicies.length > 0)
      if (!hasMatches) {
        const detail = it.detail || 'No live resources matched this rule'
        return `${title} — Passed: ${detail}`
      }
      const sample = (it.matchedSamples && it.matchedSamples[0]) || (it.matchAll && it.matchAll[0])
      if (sample) {
        const paths = (sample.matchedPaths || []).map(p => `${p.path} = ${JSON.stringify(p.actual === undefined ? p.expected : p.actual)}`).join(' • ')
        const policy = sample.displayName || sample.id || (it.presentInPolicies && it.presentInPolicies[0]) || ''
        return `${title} — Matched: ${paths}${policy ? ` in policy "${policy}"` : ''}`
      }
      if (it.presentInPolicies && it.presentInPolicies.length > 0) {
        return `${title} — Matched: found in ${it.presentInPolicies.slice(0,3).join(', ')}${it.presentInPolicies.length > 3 ? ` +${it.presentInPolicies.length - 3} more` : ''}.`
      }
      return `${title} — Matched.`
    }
    if (it.status === 'mismatched') {
      if (it.mismatches && it.mismatches.length > 0) {
        const mm = it.mismatches[0]
        const path = mm.path || 'resource'
        return `${title} — Mismatch: expected ${JSON.stringify(mm.expected)} but actual ${JSON.stringify(mm.actual)} at ${path}.`
      }
      return `${title} — Mismatched.`
    }
    if (it.status === 'partial') {
      const count = it.matchAnyCount || (Array.isArray(it.matchAny) ? it.matchAny.length : 0)
      if (count > 0) {
        const sample = (it.matchedSamples && it.matchedSamples[0]) || (it.matchAny && it.matchAny[0])
        const paths = (sample?.matchedPaths || []).map(p => `${p.path} = ${JSON.stringify(p.actual === undefined ? p.expected : p.actual)}`).join(' • ')
        const policy = sample?.displayName || sample?.id || ''
        return `${title} — Partial: matched ${count} resource${count !== 1 ? 's' : ''}${paths ? ` (${paths})` : ''}${policy ? ` in policy "${policy}"` : ''}`
      }
      return `${title} — Partial: some watched keys matched in ${count} resource(s).`
    }
    // noMatch / missing
    const detail = it.detail || 'Setting not present in any live resource'
    return `${title} — Not present: ${detail}`
  }

  // Provide a short Zero Trust rationale for an individual test/control.
  // Uses template metadata, resource keys and setting hints to pick a concise
  // rationale tied to Zero Trust principles (identity, device, least-privilege).
  const getZeroTrustRationale = (tpl, refKey, matchedSetting) => {
    try {
      const category = tpl && tpl.metadata && tpl.metadata.category ? String(tpl.metadata.category).toLowerCase() : ''
      const key = String(refKey || '').toLowerCase()
      const rdef = tpl && tpl.resources && tpl.resources[refKey] ? tpl.resources[refKey] : null

      const patterns = [
        { test: k => /risk|risky|signins|sign-in/.test(k), text: 'Triage risky sign-ins and accounts so you can promptly detect and contain account compromise — Zero Trust: verify every access and assume breach.' },
        { test: k => /risky_users|risky/.test(k), text: 'Identify and remediate risky user accounts to reduce the chance of persistent credential misuse.' },
        { test: k => /high_risk_signins|signins/.test(k), text: 'Ensuring high-risk sign-ins are triaged helps detect takeover attempts and stop unauthorized access.' },
        { test: k => /bitlocker|filevault|encryption|disk/.test(k), text: 'Enforce device encryption to protect data at rest if devices are lost or stolen.' },
        { test: k => /asr|attack surface reduction/.test(k), text: 'Apply attack-surface reduction rules to limit exploitable vectors and reduce lateral movement.' },
        { test: k => /mfa|conditional|ca_|grantcontrols/.test(k), text: 'Require multi-factor authentication and Conditional Access to validate user and device context before granting access.' },
        { test: k => /fido|passwordless|phishing-resistant|authenticationmethod/.test(k), text: 'Use phishing-resistant authentication (FIDO2/passwordless) to reduce credential-phishing risks.' },
        { test: k => /pim|privileged/.test(k), text: 'Manage privileged roles with time-limited, just-in-time access to enforce least privilege.' },
        { test: k => /invite|guest|allowinvitesfrom/.test(k), text: 'Restrict guest invites to reduce external exposure and maintain least-privilege collaboration.' },
        { test: k => /compliance|device_compliance|tpm|windows_hello|tpmrequired/.test(k), text: 'Ensure devices are compliant and support hardware attestation (TPM) before trusting them.' },
        { test: k => /security_defaults|defaults/.test(k), text: 'Enable baseline security defaults (e.g., block legacy auth, require MFA) to provide foundational protections.' }
      ]

      for (const p of patterns) {
        try { if (p.test(key)) return p.text } catch (e) { /* ignore pattern errors */ }
      }

      if (category === 'identity') return 'This test validates identity controls — core Zero Trust practice: continuously verify identities and enforce least privilege.'
      if (category === 'devices') return 'This test validates device posture — Zero Trust requires devices be healthy, managed, and verified before granting access.'

      // Fallback generic rationale
      if (rdef && rdef.displayName) return `Checks related to “${rdef.displayName}” to ensure configurations align with Zero Trust principles.`
      if (matchedSetting && matchedSetting.title) return `${matchedSetting.title} — ensures configuration aligns with Zero Trust principles (verify identity/device, enforce least privilege).`
      return 'This check supports Zero Trust principles: continuously verify identity and device posture, and enforce least privilege.'
    } catch (e) {
      return 'This check supports Zero Trust principles: verify identity, secure devices, and enforce least privilege.'
    }
  }

  // Legacy Maester/CISA references removed

  // Compact modal item renderer — keeps list concise and provides a Details toggle
  const ModalItem = ({ it, tpl, isAggregate, openAll, showOnlyFailures, defaultOpenRef }) => {
    const [open, setOpen] = useState(false)
    const [selectedPolicyId, setSelectedPolicyId] = useState(null)
    useEffect(() => {
      if (typeof openAll === 'boolean') setOpen(openAll)
    }, [openAll])
    useEffect(() => {
      if (defaultOpenRef && it && it.refId && String(defaultOpenRef) === String(it.refId)) setOpen(true)
    }, [defaultOpenRef, it])
    useEffect(() => {
      setSelectedPolicyId((it && it.defaultPolicyId) || null)
    }, [it])
    if (!it) return null

    // prefer explicit prop; otherwise fall back to modal-level control
    const effectiveShowOnly = typeof showOnlyFailures === 'boolean' ? showOnlyFailures : modalShowOnlyFailures

    // If the modal is set to show only failures, skip items that are clearly passing
    // For aggregated views, an item is passing only when matchedCount === totalOccurrences
    const isPassing = isAggregate ? ((it.totalOccurrences || 0) > 0 && (it.matchedCount || 0) === (it.totalOccurrences || 0)) : (it.status === 'matched')
    if (effectiveShowOnly && isPassing) return null

    const counterpartPolicies = Array.isArray(it.counterpartPolicies) ? it.counterpartPolicies : []
    const effectivePolicyId = selectedPolicyId || (it.defaultPolicyId || (counterpartPolicies[0] && counterpartPolicies[0].id) || null)
    const effectiveMappings = (effectivePolicyId && it.settingMappingsByPolicy && it.settingMappingsByPolicy[effectivePolicyId])
      ? it.settingMappingsByPolicy[effectivePolicyId]
      : (it.settingMappings || [])
    const effectiveSummary = (counterpartPolicies.find(p => p.id === effectivePolicyId) || {}).summary || it.settingSummary

    // aggregated item (shows tenant counts)
    if (isAggregate && it.totalOccurrences !== undefined) {
      // Display aggregate as either fully matched or not; partials are treated as failing
      const status = (it.totalOccurrences && it.matchedCount === it.totalOccurrences) ? 'full' : 'none'
      const dotCls = status === 'full' ? 'bg-green-400' : 'bg-red-400'
      const textCls = status === 'full' ? 'text-green-400' : 'text-red-400'
      return (
        <div key={it.refId} className="border rounded p-3 bg-gray-950/20">
          <div className="flex items-center justify-between">
            <div className="text-sm text-white font-medium">{it.refDisplayName || it.refId}</div>
            <div className="text-xs">
              <span className="inline-flex items-center gap-2">
                <span className={`inline-block w-2 h-2 rounded-full ${dotCls}`}></span>
                <span className={`${textCls}`}>{it.matchedCount}/{it.totalOccurrences} tenants matched</span>
              </span>
            </div>
          </div>

              <div className="mt-2 text-xs text-gray-300 flex items-start gap-3">
            <div className="flex-1">{formatItemSentence(it).split('. ')[0]}{formatItemSentence(it).length > 120 ? '…' : ''}</div>
            <div className="flex-shrink-0 flex items-center gap-2">
              <button className="btn-secondary text-xs" onClick={() => setOpen(v => !v)}>{open ? 'Hide' : 'Details'}</button>
            </div>
          </div>

          {open && (
            <div className="mt-3 text-xs text-gray-300">
              {Array.isArray(effectiveMappings) && effectiveMappings.length > 0 && (
                <div className="mb-3">
                  <div className="text-gray-400">Settings coverage:</div>
                  {counterpartPolicies.length > 1 && (
                    <div className="mt-1 mb-2">
                      <label className="text-xs text-gray-400 mr-2">Counterpart policy</label>
                      <select className="input text-xs py-1 px-2" value={effectivePolicyId || ''} onChange={e => setSelectedPolicyId(e.target.value)}>
                        {counterpartPolicies.map(p => (
                          <option key={p.id} value={p.id}>{p.displayName || p.id}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  {effectiveSummary && (
                    <div className="text-xs text-gray-500 mt-1">
                      Total {effectiveSummary.totalSettings} · Matched {effectiveSummary.matchedSettings} · Partial {effectiveSummary.partialSettings} · No match {effectiveSummary.noMatchSettings}
                      {effectiveSummary.extraSettings ? ` · Extra ${effectiveSummary.extraSettings}` : ''}
                    </div>
                  )}
                  <ul className="mt-2 space-y-1">
                    {effectiveMappings.slice(0, 25).map((m, i) => (
                      <li key={`${m.logicalKey || m.referencePath || 'setting'}-${i}`} className="border border-gray-700 rounded px-2 py-1 bg-gray-900/40">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-gray-200 break-words">{m.label || m.logicalKey || m.referencePath}</span>
                          <span className={`text-[11px] px-1.5 py-0.5 rounded border ${m.status === 'matched' ? 'border-green-800 text-green-300 bg-green-950/30' : m.status === 'partial' ? 'border-yellow-800 text-yellow-300 bg-yellow-950/30' : m.status === 'extra' ? 'border-blue-800 text-blue-300 bg-blue-950/30' : 'border-red-800 text-red-300 bg-red-950/30'}`}>{m.status}</span>
                        </div>
                        <div className="text-gray-500 mt-1">Expected: <span className="text-gray-300">{JSON.stringify(m.expected)}</span></div>
                        <div className="text-gray-500">Actual: <span className="text-gray-300">{JSON.stringify(m.actual)}</span></div>
                        {m.counterpart && <div className="text-gray-600">Counterpart: {m.counterpart.displayName || m.counterpart.id}</div>}
                      </li>
                    ))}
                  </ul>
                  {effectiveMappings.length > 25 && (
                    <div className="text-xs text-gray-500 mt-1">Showing 25 of {effectiveMappings.length} settings.</div>
                  )}
                </div>
              )}
              
              {it.sampleMatchAll && it.sampleMatchAll.length > 0 && (
                <div>
                  <div className="text-gray-400">Sample matched resources:</div>
                  <ul className="mt-1 list-disc list-inside">
                    {it.sampleMatchAll.map(s => (
                      <li key={(s && (s.key || s.displayName)) || String(s)}>
                        <div className="font-medium">{(s && (s.displayName || s.key)) || String(s)}</div>
                        {s && Array.isArray(s.matchedPaths) && s.matchedPaths.length > 0 && (
                          <div className="text-xs text-gray-400">{s.matchedPaths.map(p => `${p.path}: ${JSON.stringify(p.actual === undefined ? p.expected : p.actual)}`).join(' • ')}</div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {/* Show resource/template-level guidance if available */}
              {tpl && tpl.resources && it && it.refId && tpl.resources[it.refId] && (
                <div className="mt-3 text-xs text-gray-300">
                  <div className="text-gray-400">Source / Location</div>
                  <div className="mt-1">{tpl.resources[it.refId].displayName || tpl.resources[it.refId].display_name || it.refId}</div>
                  {tpl.resources[it.refId].area_key && <div className="text-gray-500 text-xs">Area: {tpl.resources[it.refId].area_key}</div>}
                  {tpl.resources[it.refId].policy && <div className="text-gray-500 text-xs">Policy: {tpl.resources[it.refId].policy}</div>}
                  {Array.isArray(it.presentInPolicies) && it.presentInPolicies.length > 0 && (
                    <div className="text-gray-400 mt-2">Present in policy(s):</div>
                  )}
                  {Array.isArray(it.presentInPolicies) && it.presentInPolicies.length > 0 && (
                    <ul className="mt-1 list-disc list-inside text-xs text-gray-300">
                      {it.presentInPolicies.map((p, i) => <li key={i}>{p}</li>)}
                    </ul>
                  )}

                  {(tpl.resources[it.refId].note || tpl.resources[it.refId].recommendation || tpl.resources[it.refId].fix || tpl.resources[it.refId].resolution) && (
                    <div className="mt-3">
                      <div className="text-gray-400">Suggested fix</div>
                      <div className="text-xs text-gray-300 mt-1">{tpl.resources[it.refId].recommendation || tpl.resources[it.refId].note || tpl.resources[it.refId].fix || tpl.resources[it.refId].resolution}</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )
    }

    // Single-tenant item (compact with details toggle)
    const statusCls = it.status === 'matched' ? 'border-green-800 bg-green-950/10 text-green-300' : it.status === 'noMatch' ? 'border-red-800 bg-red-950/10 text-red-300' : 'border-gray-800 text-gray-400'
    return (
      <div key={it.refId} className="border rounded p-3 bg-gray-950/20">
        <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <ResultBadge result={{ status: it.status, pass: it.status === 'matched' }} />
            <div className="text-sm text-white font-medium">{it.refDisplayName || it.refId}</div>
          </div>
          <div className="text-xs">
            <span className={`inline-flex items-center gap-2 px-2 py-0.5 rounded ${statusCls}`}>
              <span className={`${it.status === 'matched' ? 'bg-green-400' : it.status === 'noMatch' ? 'bg-red-400' : 'bg-gray-500'} inline-block w-2 h-2 rounded-full`}></span>
              <span className="capitalize">{it.status === 'noMatch' ? 'No match' : it.status}</span>
            </span>
          </div>
        </div>

        <div className="mt-2 text-xs text-gray-300 flex items-start gap-3">
          <div className="flex-1">{formatItemSentence(it).split('. ')[0]}{formatItemSentence(it).length > 120 ? '…' : ''}</div>
          <div className="flex-shrink-0">
            <button className="btn-secondary text-xs" onClick={() => setOpen(v => !v)}>{open ? 'Hide' : 'Details'}</button>
          </div>
        </div>

        {open && (
          <div className="mt-3 text-xs text-gray-300">
            {Array.isArray(effectiveMappings) && effectiveMappings.length > 0 && (
              <div className="mb-3">
                <div className="text-gray-400">Settings coverage:</div>
                {counterpartPolicies.length > 1 && (
                  <div className="mt-1 mb-2">
                    <label className="text-xs text-gray-400 mr-2">Counterpart policy</label>
                    <select className="input text-xs py-1 px-2" value={effectivePolicyId || ''} onChange={e => setSelectedPolicyId(e.target.value)}>
                      {counterpartPolicies.map(p => (
                        <option key={p.id} value={p.id}>{p.displayName || p.id}</option>
                      ))}
                    </select>
                  </div>
                )}
                {effectiveSummary && (
                  <div className="text-xs text-gray-500 mt-1">
                    Total {effectiveSummary.totalSettings} · Matched {effectiveSummary.matchedSettings} · Partial {effectiveSummary.partialSettings} · No match {effectiveSummary.noMatchSettings}
                    {effectiveSummary.extraSettings ? ` · Extra ${effectiveSummary.extraSettings}` : ''}
                  </div>
                )}
                <ul className="mt-2 space-y-1">
                  {effectiveMappings.slice(0, 25).map((m, i) => (
                    <li key={`${m.logicalKey || m.referencePath || 'setting'}-${i}`} className="border border-gray-700 rounded px-2 py-1 bg-gray-900/40">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-gray-200 break-words">{m.label || m.logicalKey || m.referencePath}</span>
                        <span className={`text-[11px] px-1.5 py-0.5 rounded border ${m.status === 'matched' ? 'border-green-800 text-green-300 bg-green-950/30' : m.status === 'partial' ? 'border-yellow-800 text-yellow-300 bg-yellow-950/30' : m.status === 'extra' ? 'border-blue-800 text-blue-300 bg-blue-950/30' : 'border-red-800 text-red-300 bg-red-950/30'}`}>{m.status}</span>
                      </div>
                      <div className="text-gray-500 mt-1">Expected: <span className="text-gray-300">{JSON.stringify(m.expected)}</span></div>
                      <div className="text-gray-500">Actual: <span className="text-gray-300">{JSON.stringify(m.actual)}</span></div>
                      {m.counterpart && <div className="text-gray-600">Counterpart: {m.counterpart.displayName || m.counterpart.id}</div>}
                    </li>
                  ))}
                </ul>
                {effectiveMappings.length > 25 && (
                  <div className="text-xs text-gray-500 mt-1">Showing 25 of {effectiveMappings.length} settings.</div>
                )}
              </div>
            )}
            
            {it.status === 'matched' && (
              <div>
                {it.presentInPolicies && it.presentInPolicies.length > 0 && (
                  <div className="text-gray-400 mb-1">Present in: {it.presentInPolicies.slice(0,3).join(', ')}{it.presentInPolicies.length > 3 ? ` +${it.presentInPolicies.length - 3} more` : ''}</div>
                )}

                {it.matchedSamples && it.matchedSamples.length > 0 ? (
                  <div>
                    <div className="text-gray-400">Matched resources (sample):</div>
                    <ul className="mt-1 list-disc list-inside">
                      {it.matchedSamples.map(m => (
                        <li key={m.id}>
                          <div className="font-medium">{m.displayName || m.id}</div>
                          <div className="text-xs text-gray-400">{m.matchedPaths && m.matchedPaths.length > 0 ? m.matchedPaths.map(p => `${p.path}: ${JSON.stringify(p.actual === undefined ? p.expected : p.actual)}`).join(' • ') : 'No path details'}</div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : it.matchAll && it.matchAll.length > 0 ? (
                  <div>
                    <div className="text-gray-400">Matched resources:</div>
                    <ul className="mt-1 list-disc list-inside">
                      {it.matchAll.map(m => (
                        <li key={m.id || m.displayName || String(m)}>
                          <div className="font-medium">{(m && (m.displayName || m.id)) || String(m)}</div>
                          {m && Array.isArray(m.matchedPaths) && m.matchedPaths.length > 0 && (
                            <div className="text-xs text-gray-400">{m.matchedPaths.map(p => `${p.path}: ${JSON.stringify(p.actual === undefined ? p.expected : p.actual)}`).join(' • ')}</div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            )}

            {it.status === 'mismatched' && it.mismatches && (
              <div>
                <div className="text-gray-400">Mismatches:</div>
                <ul className="mt-1 space-y-1">
                  {it.mismatches.map((mm, i) => (
                    <li key={i} className="text-xs">
                      <strong>{mm.path || 'whole resource'}:</strong> expected <span className="text-green-300">{JSON.stringify(mm.expected)}</span> • actual <span className="text-red-300">{JSON.stringify(mm.actual)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {it.perKeyMatches && Object.keys(it.perKeyMatches).length > 0 && (
              <div className="mt-2">
                <div className="text-gray-400">Per-key matches:</div>
                <div className="mt-1 grid grid-cols-1 gap-2">
                  {Object.entries(it.perKeyMatches).map(([path, list]) => (
                    <div key={path} className="text-xs">
                      <div className="text-gray-300">{path}:</div>
                      <div className="flex gap-2 flex-wrap mt-1">
                        {list.map(m => (
                          <span key={m.id} className="text-xs px-2 py-0.5 rounded border border-gray-700 text-gray-300">{m.displayName || m.id}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

                {/* Show any resources that were inspected or partially matched so users can see why a check failed */}
                {((it.matchAll && it.matchAll.length > 0) || (it.matchAny && it.matchAny.length > 0) || (it.matchedSamples && it.matchedSamples.length > 0)) && (
                  <div className="mt-2">
                    <div className="text-gray-400">Affected resources:</div>
                    <ul className="mt-1 list-disc list-inside">
                      {(it.matchAll && it.matchAll.length > 0 ? it.matchAll : (it.matchAny && it.matchAny.length > 0 ? it.matchAny : it.matchedSamples)).map(m => (
                        <li key={m.id || m.displayName || String(m)} className="text-xs">
                          <div className="font-medium">{m.displayName || m.id}</div>
                          {m.matchedPaths && m.matchedPaths.length > 0 && (
                            <div className="text-xs text-gray-400">{m.matchedPaths.map(p => `${p.path}: ${JSON.stringify(p.actual === undefined ? p.expected : p.actual)}`).join(' • ')}</div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {(it.status === 'noMatch' || it.status === 'missing') && (
                  <div className="text-gray-500 mt-2">{it.detail || 'No live resources matched all watched keys for this reference item.'}</div>
                )}
          </div>
        )}
      </div>
    )
  }

  

  const toggleTenant = (id) => {
    // Single-tenant selection: select the clicked tenant or deselect if already selected
    setSelectedTenants(prev => prev.includes(id) ? [] : [id])
  }

  const toggleAssessmentTemplate = (id) => {
    setSelectedAssessmentTemplates(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const runAssessmentChecks = async (templateIds = null) => {
    // If specific controls are selected, group them by template id so we
    // can run compare once per template and filter returned items client-side.
    const controlFilters = (selectedControls && selectedControls.length > 0)
      ? selectedControls.reduce((acc, k) => {
          const parts = String(k || '').split('||')
          const tid = parts[0]
          const ref = parts[1]
          if (!acc[tid]) acc[tid] = new Set()
          acc[tid].add(ref)
          return acc
        }, {})
      : null

    const tplList = Array.isArray(templateIds) && templateIds.length > 0
      ? templateIds
      : (controlFilters ? Object.keys(controlFilters) : selectedAssessmentTemplates)

    if (selectedTenants.length === 0) { showToast('Select at least one tenant', 'error'); return }
    if (!tplList || tplList.length === 0) { showToast('Select at least one check or assessment template', 'error'); return }

    setAssessmentRunning(true)
    try {
      const tenantMap = Object.fromEntries(tenants.map(t => [t.id, t.display_name]))
      const newResults = {}
      for (const tplId of tplList) {
        newResults[tplId] = {}
        for (const tenantId of selectedTenants) {
            try {
            const res = await compareTemplate(tplId, { tenantId })
            // If controlFilters present for this template, filter items and recompute summary
            if (controlFilters && controlFilters[tplId]) {
              const keys = controlFilters[tplId]
              const filtered = Array.isArray(res.items) ? res.items.filter(it => keys.has(it.refId)) : []
              // If the user selected all controls for this template, preserve the
              // comparator-provided summary (it may represent resource-level counts
              // that don't map 1:1 to `items.length`). Otherwise, recompute a
              // conservative summary from the filtered items.
              const tplDef = (assessmentTemplates || []).find(t => t.id === tplId) || {}
              const totalControls = Array.isArray(tplDef.settings) && tplDef.settings.length > 0
                ? tplDef.settings.length
                : (tplDef.resources ? Object.keys(tplDef.resources).length : 0)
              let summary = { total: 0, matched: 0, partial: 0, noMatch: 0 }
              if (totalControls > 0 && keys.size === totalControls) {
                summary = res.summary || summary
              } else {
                const total = filtered.length
                const matched = filtered.filter(i => i.status === 'matched').length
                const partial = filtered.filter(i => i.status === 'partial').length
                const noMatch = Math.max(0, total - matched - partial)
                summary = { total, matched, partial, noMatch }
              }
              newResults[tplId][tenantId] = { ...res, items: filtered, summary, tenantName: tenantMap[tenantId] || tenantId }
            } else {
              newResults[tplId][tenantId] = { ...res, tenantName: tenantMap[tenantId] || tenantId }
            }
          } catch (err) {
            newResults[tplId][tenantId] = { error: err.message, tenantName: tenantMap[tenantId] || tenantId }
          }
        }
      }
      setAssessmentResults(newResults)
      showToast('Assessment checks complete', 'success')
    } catch (err) {
      showToast('Assessment checks failed', 'error')
    } finally {
      setAssessmentRunning(false)
    }
  }
  const runSingleAssessmentCheck = async (tplId, refId) => {
    if (selectedTenants.length === 0) { showToast('Select at least one tenant', 'error'); return }
    setAssessmentRunning(true)
    try {
      const tenantMap = Object.fromEntries(tenants.map(t => [t.id, t.display_name]))
      const newResults = { ...(assessmentResults || {}) }
      if (!newResults[tplId]) newResults[tplId] = {}
      for (const tenantId of selectedTenants) {
        try {
          const res = await compareTemplate(tplId, { tenantId })
          const filtered = Array.isArray(res.items) ? res.items.filter(it => String(it.refId) === String(refId)) : []
          const total = filtered.length
          const matched = filtered.filter(i => i.status === 'matched').length
          const partial = filtered.filter(i => i.status === 'partial').length
          const noMatch = Math.max(0, total - matched - partial)
          const summary = { total, matched, partial, noMatch }
          newResults[tplId][tenantId] = { ...res, items: filtered, summary, tenantName: tenantMap[tenantId] || tenantId }
        } catch (err) {
          newResults[tplId][tenantId] = { error: err.message, tenantName: tenantMap[tenantId] || tenantId }
        }
      }
      setAssessmentResults(newResults)
      showToast('Assessment checks complete', 'success')
    } catch (err) {
      showToast('Assessment checks failed', 'error')
    } finally {
      setAssessmentRunning(false)
    }
  }

  // Compare helper: try DB-backed security templates first, then fallback
  // to reference templates (registry) when the template isn't stored in DB.
  const compareTemplate = async (tplId, body) => {
    try {
      return await templateApi.compare(tplId, body)
    } catch (err) {
      // If template not found in DB, fallback to registry reference compare
      if (err && err.response && err.response.status === 404) {
        try {
          return await referenceApi.compare(tplId, body)
        } catch (e2) {
          throw e2
        }
      }
      throw err
    }
  }

  // Build aggregated list of failing assessment items from the last owner summary
  const buildFailingList = () => {
    // Prefer the aggregated perTemplateSummary when available.
    const rows = []
    const tplMap = perTemplateSummary || {}
    if (Object.keys(tplMap || {}).length > 0) {
      Object.values(tplMap).forEach(tpl => {
        const tplId = tpl.templateId
        const tplName = tpl.name || ''
        const areaKey = tpl.area_key || ''
        (tpl.items || []).forEach(it => {
          // include items where at least one tenant was scanned and not all tenants matched
          const totalOcc = it.totalOccurrences || 0
          const matched = it.matchedCount || 0
          if (totalOcc > 0 && matched !== totalOcc) {
            const row = {
              templateId: tplId,
              templateName: tplName,
              area_key: areaKey,
              refId: it.refId,
              refDisplayName: it.refDisplayName || '',
              matchedCount: it.matchedCount || 0,
              partialCount: it.partialCount || 0,
              totalOccurrences: it.totalOccurrences || 0,
              tenants: [],
              failureContexts: [],
              recommendedResolution: ''
            }

            // try to pick up a recommended resolution from the template resource definition when available
            try {
              const tplDef = (assessmentTemplates || []).find(t => t.id === tplId) || {}
              const resDef = tplDef.resources && tplDef.resources[it.refId] ? tplDef.resources[it.refId] : null
              if (resDef) {
                row.recommendedResolution = resDef.note || resDef.recommendation || resDef.fix || resDef.resolution || ''
              }
            } catch (e) {
              // ignore
            }

            // collect tenant-level counts (from owner summary) and try to augment with last-run details (from assessmentResults)
            Object.values(tpl.tenants || {}).forEach(t => {
              const tid = t.tenantId
              const tenantItem = (t.items || []).find(x => x.refId === it.refId)
              if (tenantItem) {
                row.tenants.push({ tenantId: tid, tenantName: t.tenantName, matchedCount: tenantItem.matchedCount || 0, totalOccurrences: tenantItem.totalOccurrences || 0 })
              }

              // augment with any detailed failure context from most recent assessmentResults
              const lastRun = (assessmentResults && assessmentResults[tplId] && assessmentResults[tplId][tid]) || null
              if (lastRun && !lastRun.error && Array.isArray(lastRun.items)) {
                const found = lastRun.items.find(x => x.refId === it.refId)
                if (found && found.status !== 'matched') {
                  row.failureContexts.push({
                    tenantId: tid,
                    tenantName: lastRun.tenantName || tid,
                    status: found.status,
                    note: found.note || '',
                    detail: found.detail || '',
                    mismatches: found.mismatches || [],
                    matchedSamples: (found.matchedSamples || []).map(s => ({ id: s.id, displayName: s.displayName, matchedPaths: s.matchedPaths || [] }))
                  })
                }
              }
            })

            // if no detailed failure contexts were found, include any sampleMatchAll aggregated values
            if (row.failureContexts.length === 0 && Array.isArray(it.sampleMatchAll) && it.sampleMatchAll.length > 0) {
              row.failureContexts.push({ tenantId: null, tenantName: null, status: 'no-match', note: '', detail: '', mismatches: [], matchedSamples: it.sampleMatchAll })
            }

            rows.push(row)
          }
        })
      })
      return rows
    }

    // Fallback: build from last-run per-template `assessmentResults` (populated by Run Assessment Checks)
    const agg = {}
    for (const [tplId, tenantsMap] of Object.entries(assessmentResults || {})) {
      const tpl = (assessmentTemplates || []).find(t => t.id === tplId) || {}
      const tplName = tpl.name || ''
      const areaKey = tpl.area_key || ''
      for (const [tenantId, res] of Object.entries(tenantsMap || {})) {
        if (!res || res.error) continue
        const items = res.items || []
        for (const it of items) {
          if (it.status === 'matched') continue
          const key = `${tplId}||${it.refId}`
          if (!agg[key]) {
            agg[key] = { templateId: tplId, templateName: tplName, area_key: areaKey, refId: it.refId, refDisplayName: it.refDisplayName || '', matchedCount: 0, partialCount: 0, totalOccurrences: 0, tenants: [], failureContexts: [], recommendedResolution: '' }
            // try to pull recommended resolution from template definition
            const tplDef = (assessmentTemplates || []).find(t => t.id === tplId) || {}
            const resDef = tplDef.resources && tplDef.resources[it.refId] ? tplDef.resources[it.refId] : null
            if (resDef) agg[key].recommendedResolution = resDef.note || resDef.recommendation || resDef.fix || resDef.resolution || ''
          }
          agg[key].totalOccurrences += 1
          agg[key].partialCount += it.status === 'partial' ? 1 : 0
          agg[key].tenants.push({ tenantId, tenantName: res.tenantName || tenantId, matchedCount: 0, partialCount: it.status === 'partial' ? 1 : 0, totalOccurrences: 1 })
          agg[key].failureContexts.push({ tenantId, tenantName: res.tenantName || tenantId, status: it.status, note: it.note || '', detail: it.detail || '', mismatches: it.mismatches || [], matchedSamples: (it.matchedSamples || []).map(s => ({ id: s.id, displayName: s.displayName, matchedPaths: s.matchedPaths || [] })) })
        }
      }
    }
    return Object.values(agg)
  }

  const exportFailingJSON = () => {
    const rows = buildFailingList()
    if (!rows || rows.length === 0) { showToast('No failing items to export — run Assessment Checks or generate a summary first', 'info'); return }
    const mode = getAggregationMode()
    if (mode === 'occurrence') {
      const hasTenantDetails = rows.some(r => Array.isArray(r.tenants) && r.tenants.length > 0)
      if (!hasTenantDetails) {
        showToast('No tenant-level details available. Run Assessment Checks to include per-tenant data in the export.', 'info')
        // continue and export the available rows
      }
    }
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `failing-reference-items-${selectedOwner || 'all'}-${new Date().toISOString().slice(0,19)}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    showToast('Export started', 'success')
  }

  const exportFailingCSV = () => {
    const rows = buildFailingList()
    if (!rows || rows.length === 0) { showToast('No failing items to export — run Assessment Checks or generate a summary first', 'info'); return }
    const mode = getAggregationMode()
    const header = ['templateId','templateName','area_key','refId','refDisplayName','matchedCount','partialCount','totalOccurrences','tenants','recommendedResolution','failureSummary']
    const lines = rows.map(r => {
      let tenantsStr = ''
      if (mode === 'occurrence') {
        // include full tenant JSON for occurrence mode
        tenantsStr = JSON.stringify(r.tenants || [])
      } else {
        tenantsStr = (r.tenants || []).map(t => `${t.tenantName || t.tenantId}:${t.matchedCount}/${t.partialCount || 0}/${t.totalOccurrences}`).join('; ')
      }
      // build a concise failure summary from failureContexts
      const summaries = (r.failureContexts || []).slice(0,5).map(fc => {
        const tn = fc.tenantName || 'aggregate'
        const st = fc.status || ''
        const note = fc.note || ''
        const detail = fc.detail || ''
        const mm = (fc.mismatches || []).slice(0,3).map(m => `${m.path||''}: expected ${JSON.stringify(m.expected)} -> actual ${JSON.stringify(m.actual)}`).join(' | ')
        const samples = (fc.matchedSamples || []).slice(0,2).map(s => `${s.displayName||s.id}${s.matchedPaths && s.matchedPaths.length ? ` (${s.matchedPaths.map(p=>p.path+':'+JSON.stringify(p.actual===undefined?p.expected:p.actual)).join(';')})` : ''}`).join('; ')
        const parts = [tn ? `${tn}` : null, st ? `status=${st}` : null, note ? note : null, detail ? detail : null, mm ? `mismatches: ${mm}` : null, samples ? `samples: ${samples}` : null]
        return parts.filter(Boolean).join(' • ')
      })
      const failureSummary = summaries.join(' || ')
      const vals = [r.templateId, r.templateName, r.area_key, r.refId, r.refDisplayName, r.matchedCount, r.partialCount || 0, r.totalOccurrences, tenantsStr, r.recommendedResolution || '', failureSummary]
      return vals.map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(',')
    })
    const csv = header.join(',') + '\r\n' + lines.join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `failing-reference-items-${selectedOwner || 'all'}-${new Date().toISOString().slice(0,19)}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    showToast('Export started', 'success')
  }

  // per-template inline expansion removed; use the detail modal instead

  const openDetail = (tplId, tenantId, refId = null) => setDetailModal({ open: true, tplId, tenantId, refId })
  const closeDetail = () => setDetailModal({ open: false, tplId: null, tenantId: null, refId: null })



  // Compute per-resource status for display badges (prefers aggregated owner summary,
  // falls back to last-run `assessmentResults` across selected tenants).
  const computeResourceStatus = (tplId, refKey) => {
    try {
      const agg = perTemplateSummary && perTemplateSummary[tplId]
      if (agg && Array.isArray(agg.items)) {
        const found = (agg.items || []).find(i => i.refId === refKey)
          if (found) {
          const total = found.totalOccurrences || 0
          const matched = found.matchedCount || 0
          if (total === 0) return { status: null }
          if (matched === total) return { status: 'matched' }
          // Treat any non-full match as a failing condition (no partials in aggregated view)
          return { status: 'noMatch' }
        }
      }

      // fallback to last-run results per selected tenant
      const tenantsToCheck = (selectedTenants && selectedTenants.length > 0) ? selectedTenants : []
      if (!tenantsToCheck || tenantsToCheck.length === 0) return { status: null }
      let total = 0, matched = 0, partial = 0, noMatch = 0
      for (const tid of tenantsToCheck) {
        const last = (assessmentResults && assessmentResults[tplId] && assessmentResults[tplId][tid]) || null
        if (!last || last.error) continue
        const item = Array.isArray(last.items) ? last.items.find(x => x.refId === refKey) : null
        if (!item) continue
        total += 1
        if (item.status === 'matched') matched += 1
        else if (item.status === 'partial') partial += 1
        else if (item.status === 'noMatch' || item.status === 'missing') noMatch += 1
      }
      if (total === 0) return { status: null }
      if (matched === total) return { status: 'matched' }
      // Any tenant with less than full matches is considered a failing tenant
      return { status: 'noMatch' }
    } catch (e) {
      return { status: null }
    }
  }

  // Compute status for an individual control (setting) inside the modal.
  // Uses single-tenant `res.items` when viewing a tenant, or the aggregated
  // `perTemplateSummary` when viewing aggregate results. Supports an explicit
  // `resource` mapping on the `setting` object for tighter linking in tests.
  const computeControlStatus = (tpl, setting, res, isAggregate) => {
    try {
      const resourceKey = setting && (setting.resource || setting.refId || setting.resourceId || setting.resource_id)

      if (!isAggregate) {
        // Single-tenant modal: consult the last-run results for this template/tenant
        if (!res || !Array.isArray(res.items)) return null
        if (resourceKey) {
          const it = res.items.find(x => x.refId === resourceKey)
          return it ? (it.status || null) : null
        }
        const stitle = (setting && setting.title || '').toLowerCase()
        const found = res.items.find(x => {
          const name = ((x.refDisplayName || x.refId || '')).toLowerCase()
          return (stitle && name.includes(stitle)) || (name && stitle.includes(name))
        })
        return found ? (found.status || null) : null
      }

      // Aggregate view: prefer perTemplateSummary when available
      const per = perTemplateSummary && perTemplateSummary[tpl.id]
      if (per && Array.isArray(per.items)) {
        if (resourceKey) {
          const p = per.items.find(i => i.refId === resourceKey)
            if (p) {
            const total = p.totalOccurrences || 0
            const matched = p.matchedCount || 0
            if (total === 0) return null
            if (matched === total) return 'matched'
            // treat partial aggregated results as failing
            return 'noMatch'
          }
        }
        const stitle = (setting && setting.title || '').toLowerCase()
        const p = per.items.find(i => {
          const name = (i.refDisplayName || i.refId || '').toLowerCase()
          return (stitle && name.includes(stitle)) || (name && stitle.includes(name))
        })
          if (p) {
          const total = p.totalOccurrences || 0
          const matched = p.matchedCount || 0
          if (total === 0) return null
          if (matched === total) return 'matched'
          return 'noMatch'
        }
      }

      // If no explicit per-template aggregate found, and the setting lacks a
      // `resource` mapping, try to resolve status from the last-run
      // `assessmentResults` by matching the setting title to `refDisplayName`.
      if (!resourceKey) {
        try {
          const stitle = (setting && (setting.title || '')).toLowerCase()
          if (stitle && selectedTenants && selectedTenants.length > 0) {
            for (const tid of selectedTenants) {
              const last = (assessmentResults && assessmentResults[tpl.id] && assessmentResults[tpl.id][tid]) || null
              if (!last || last.error || !Array.isArray(last.items)) continue
              const found = last.items.find(x => {
                const name = ((x.refDisplayName || x.refId || '')).toLowerCase()
                return (stitle && name.includes(stitle)) || (name && stitle.includes(name))
              })
              if (found) return found.status || null
            }
          }
        } catch (e) {
          /* ignore */
        }
      }

      // If we couldn't find an aggregate status from perTemplateSummary, fall back
      // to the last-run `assessmentResults` across selected tenants so the UI can show
      // Pass/Fail/Partial even when owner-summary wasn't run.
      try {
        const fallback = computeResourceStatus(tpl.id, resourceKey)
        if (fallback && fallback.status) return fallback.status
      } catch (e) {}

      return null
    } catch (e) {
      return null
    }
  }

      // Decide aggregation mode: 'occurrence' (count per-tenant occurrences) or 'unique' (one per visible control)
      const getAggregationMode = () => {
        // Prefer occurrence mode when any run/summary data exists so totals reflect
        // actual per-tenant occurrences rather than only unique visible controls.
        try {
          const hasAssessmentResults = Object.keys(assessmentResults || {}).length > 0
          const hasPerTpl = Object.keys(perTemplateSummary || {}).length > 0
          const hasOwnerOcc = !!(ownerSummaryData && ownerSummaryData.occurrences && (ownerSummaryData.occurrences.total || 0) > 0)
            if (hasAssessmentResults || hasPerTpl || hasOwnerOcc) return 'occurrence'
        } catch (e) { /* ignore and fall back */ }
        return 'unique'
      }

      // Compute dashboard totals for either 'occurrence' or 'unique' aggregation.
      // 'occurrence' sums per-tenant occurrences (uses `assessmentResults` / `perTemplateSummary`)
      // 'unique' counts visible controls once (uses `computeControlStatus`).
      const computeDashboardTotals = (modeParam) => {
        if (ownerSummaryLoading) return { passing: '…', failing: '…', total: '…' }
        const mode = modeParam || getAggregationMode()

          const visibleTemplates = selectedCategory === 'all'
          ? (assessmentTemplates || [])
          : (assessmentTemplates || []).filter(t => ((t.metadata && t.metadata.category) ? t.metadata.category : 'Uncategorized') === selectedCategory)

        // Occurrence mode: sum per-tenant summaries from assessmentResults (preferred),
        // fall back to perTemplateSummary tenant buckets if assessmentResults missing.
        if (mode === 'occurrence') {
          // If no explicit selection, prefer aggregated owner summary occurrences
          if ((selectedAssessmentTemplates.length === 0 && selectedControls.length === 0) && ownerSummaryData?.occurrences && (ownerSummaryData.occurrences.total || 0) > 0) {
              const occ = ownerSummaryData.occurrences || {}
              return { passing: occ.passing || 0, failing: Math.max(0, (occ.total || 0) - (occ.passing || 0)), total: occ.total || 0, notRun: 0 }
            }

          const tplIds = (selectedAssessmentTemplates && selectedAssessmentTemplates.length > 0)
            ? Array.from(new Set(selectedAssessmentTemplates))
            : (selectedControls && selectedControls.length > 0)
              ? Array.from(new Set(selectedControls.map(k => String(k || '').split('||')[0]).filter(Boolean)))
              : (visibleTemplates || []).map(t => t.id)

          let total = 0, matched = 0
          for (const tplId of tplIds) {
            // prefer recent run results
            const tenantsMap = (assessmentResults || {})[tplId] || {}
            if (Object.keys(tenantsMap || {}).length > 0) {
              for (const [tid, r] of Object.entries(tenantsMap || {})) {
                if (!r || r.error) continue
                if (selectedTenants && selectedTenants.length > 0 && !selectedTenants.includes(tid)) continue
                const s = r.summary || {}
                total += s.total || 0
                matched += s.matched || 0
              }
              continue
            }

            // fallback to perTemplateSummary tenant buckets
            const per = perTemplateSummary && perTemplateSummary[tplId]
            if (per && per.tenants) {
              for (const [tid, t] of Object.entries(per.tenants || {})) {
                if (selectedTenants && selectedTenants.length > 0 && !selectedTenants.includes(tid)) continue
                total += t.total || 0
                matched += t.passing || 0
              }
            }
          }

          if (total > 0) return { passing: matched, failing: Math.max(0, total - matched), total, notRun: 0 }
          // if we couldn't find occurrence data, fall through to unique mode
        }

        // Unique mode (fallback): count unique visible controls and derive status via computeControlStatus
        const items = []
        for (const tpl of (visibleTemplates || [])) {
          if (Array.isArray(tpl.settings) && tpl.settings.length > 0) {
            for (const s of tpl.settings) {
              const resourceKey = s.resource || s.refId || s.resourceId || s.resource_id || (tpl.resources ? Object.keys(tpl.resources)[0] : null)
              items.push({ tpl, setting: s, resourceKey })
            }
          } else if (tpl.resources) {
            for (const [rkey, rdef] of Object.entries(tpl.resources)) {
              items.push({ tpl, setting: { control_id: `${tpl.id}:${rkey}`, title: rdef.displayName || rdef.display_name || rkey, resource: rkey }, resourceKey: rkey })
            }
          }
        }

        const totals = { total: items.length, passing: 0, failing: 0, notRun: 0 }
        for (const it of items) {
          const status = computeControlStatus(it.tpl, it.setting, null, true) || null
          if (!status) totals.notRun += 1
          else if (status === 'matched') totals.passing += 1
          else totals.failing += 1
        }

        return { passing: totals.passing, failing: totals.failing, total: totals.total, notRun: totals.notRun }
      }

      // Compute displayTotals using selected aggregation mode (owner summary still preferred when no selection)
      const displayTotals = (() => {
        if (ownerSummaryLoading) return { passing: '…', failing: '…', total: '…' }
        // Prefer aggregated owner summary when user hasn't selected controls/templates
        const occ = ownerSummaryData?.occurrences || {}
        if ((selectedAssessmentTemplates.length === 0 && selectedControls.length === 0) && (occ.total || 0) > 0) {
          const passing = occ.passing || 0
          const total = occ.total || 0
          return { passing, failing: Math.max(0, total - passing), total }
        }
        const mode = getAggregationMode()
        return computeDashboardTotals(mode)
      })()

  function ResultBadge({ result }) {
    if (!result) return (
      <span className="text-xs px-2 py-0.5 rounded border border-gray-700 text-gray-500 shrink-0">Not run</span>
    )
    
    if (result.pass === null) return (
      <span className="text-xs px-2 py-0.5 rounded border border-yellow-800 text-yellow-400 bg-yellow-950/30 flex items-center gap-1 shrink-0">
        <AlertCircle size={10}/> Unavailable
      </span>
    )
    return result.pass
      ? <span className="text-xs px-2 py-0.5 rounded border border-green-800 text-green-400 bg-green-950/30 flex items-center gap-1 shrink-0"><CheckCircle size={10}/> Pass</span>
      : <span className="text-xs px-2 py-0.5 rounded border border-red-800 text-red-400 bg-red-950/30 flex items-center gap-1 shrink-0"><XCircle size={10}/> Fail</span>
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <ShieldCheck size={20} className="text-brand-500"/> {selectedOwnerDisplay}
          </h1>
          <p className="text-gray-500 text-sm mt-1">{headerDescription}</p>
          <p className="text-xs text-yellow-400 mt-2">IMPORTANT: These security assessment checks are static, read-only guidance and may produce false positives or negatives. They are provided for informational purposes only and do not replace a full manual security audit. Always verify findings before acting. The maintainers and operators accept no responsibility or liability for the security posture of any tenant based on these results.</p>
        </div>
        <div />
      </div>

      {detailModal.open && (() => {
        const tplId = detailModal.tplId
        const tenantId = detailModal.tenantId
        const tpl = assessmentTemplates.find(t => t.id === tplId) || {}
        const isAggregate = tenantId === 'aggregate'
        const res = isAggregate ? (perTemplateSummary[tplId] || {}) : (assessmentResults[tplId] || {})[tenantId]
        let items = isAggregate ? (res.items || []) : (res?.items || [])
        // If a specific refId was requested when opening the modal, filter to that item
        if (detailModal.refId) {
          items = (items || []).filter(it => String(it.refId) === String(detailModal.refId))
        }
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/60" onClick={closeDetail}></div>
            <div className="relative w-11/12 max-w-3xl bg-gray-900 border border-gray-800 rounded-lg p-4">
                <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold text-white">{(stripZeroTrustPrefix(tpl.name) || tpl.name)} — {isAggregate ? 'Aggregated results' : (res?.tenantName || tenantId)}</h3>
                  <div className="text-xs text-gray-400">{(stripZeroTrustPrefix(tpl.description) || tpl.description)}</div>
                  
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setModalExpandAll(true)} className="btn-secondary text-xs">Expand all</button>
                  <button onClick={() => setModalExpandAll(false)} className="btn-secondary text-xs">Collapse all</button>
                  <button onClick={closeDetail} className="text-sm text-gray-400 hover:text-gray-200">Close</button>
                </div>
              </div>

              <div className="mt-3 space-y-3 max-h-[60vh] overflow-auto">
                {isAggregate && res.tenants && Object.keys(res.tenants).length > 0 && (
                  <div className="mb-3">
                    <div className="text-sm text-gray-400 mb-2">Breakdown by tenant</div>
                    <div className="grid grid-cols-2 gap-2">
                      {Object.entries(res.tenants).map(([tid, t]) => (
                        <div key={tid} className="rounded border px-3 py-2 flex items-center justify-between text-xs">
                          <div>
                            <div className="text-gray-300 font-medium">{t.tenantName || tid}</div>
                            <div className="text-gray-500">{t.passing || 0} matching / {t.total || 0} total</div>
                          </div>
                          <div>
                            <button className="text-xs text-gray-400 hover:text-gray-300" onClick={() => openDetail(tplId, tid)}>View</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {/* Controls (settings) badges */}
                {tpl.settings && tpl.settings.length > 0 && (
                  <div className="mb-3">
                    <div className="text-sm text-gray-400 mb-2">{detailModal.refId ? 'Selected Control' : 'Controls'}</div>
                    <div className="flex flex-wrap gap-2">
                      {(() => {
                        const settingsList = detailModal.refId
                          ? (() => {
                              // If a specific resource is selected, prefer showing the corresponding setting if available
                              if (detailModal.refId && tpl.resources && tpl.resources[detailModal.refId]) {
                                const r = tpl.resources[detailModal.refId]
                                const matchSetting = tpl.settings && tpl.settings.find(s => s.resource === detailModal.refId || (s.control_id && String(s.control_id).endsWith(`:${detailModal.refId}`)) || (s.control_id && s.control_id.includes(detailModal.refId)))
                                if (matchSetting) return [matchSetting]
                                // include a `resource` key so computeControlStatus can resolve status
                                return [{ control_id: `${tpl.id}:${detailModal.refId}`, title: r.displayName || detailModal.refId, resource: detailModal.refId }]
                              }
                              return tpl.settings
                            })()
                          : tpl.settings
                        return settingsList.map(s => {
                          const st = computeControlStatus(tpl, s, res, isAggregate)
                          const resultObj = st ? { status: st, pass: st === 'matched' } : null
                          return (
                            <div key={s.control_id} className="flex items-center gap-2 rounded border px-2 py-1 bg-gray-900 text-xs">
                              <ResultBadge result={resultObj} />
                              <div className="text-xs text-gray-300">{s.title}</div>
                            </div>
                          )
                        })
                      })()}
                    </div>
                  </div>
                )}
                {items.length === 0 ? (
                  // When no live items are present, show resource/template-level details
                  detailModal.refId ? (
                    (() => {
                      const ref = detailModal.refId
                      const rdef = (tpl.resources && tpl.resources[ref]) ? tpl.resources[ref] : null
                      return (
                        <div className="border rounded p-3 bg-gray-950/10 text-sm text-gray-300">
                          <div className="text-sm font-medium">{(rdef && (rdef.displayName || rdef.display_name)) || ref}</div>
                          <div className="text-xs text-gray-400">Resource id: {ref}</div>
                          {tpl.area_key && <div className="text-xs text-gray-400">Area: {tpl.area_key}</div>}
                          {rdef && rdef.testId && <div className="text-xs text-gray-400">Test id: {rdef.testId}</div>}

                          <div className="mt-3">
                            <div className="text-gray-400">Why this test</div>
                            {(() => {
                              const refKey = ref
                              const rdef = (tpl.resources && tpl.resources[refKey]) ? tpl.resources[refKey] : null
                              const matchedSetting = (tpl.settings && tpl.settings.length > 0)
                                ? tpl.settings.find(s => {
                                    const sres = s.resource || s.refId || s.resourceId || null
                                    if (sres && String(sres) === String(refKey)) return true
                                    if (s.control_id && String(s.control_id).endsWith(`:${refKey}`)) return true
                                    return false
                                  })
                                : null

                              const rationale = getZeroTrustRationale(tpl, refKey, matchedSetting)

                              return (
                                <div>
                                  <div className="text-xs text-gray-300 mt-1">{rationale}</div>

                                  {(matchedSetting?.recommended_value !== undefined || (rdef && (rdef.recommendation || rdef.note || rdef.fix || rdef.resolution))) && (
                                    <div className="mt-2">
                                      <div className="text-gray-400">Suggested actions</div>
                                      <ul className="mt-1 list-disc list-inside text-xs text-gray-300">
                                        {matchedSetting && matchedSetting.recommended_value !== undefined && (
                                          <li>Recommended value: {String(matchedSetting.recommended_value)}</li>
                                        )}
                                        {rdef && rdef.recommendation && (
                                          <li>{rdef.recommendation}</li>
                                        )}
                                        {tpl.watched_keys && tpl.watched_keys.length > 0 && tpl.watched_keys.map((wk, i) => (
                                          <li key={i}>{wk.label || wk.path}{wk.match ? ` — expected: ${wk.match}` : ''}</li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}

                                  {rdef && rdef.testId && (
                                    <div className="mt-2 text-xs text-gray-400">Test id: {rdef.testId}</div>
                                  )}
                                </div>
                              )
                            })()}
                          </div>

                          {((rdef && rdef.authenticationMethodConfigurations) || (tpl.watched_keys && tpl.watched_keys.length > 0)) && (
                            <div className="mt-3">
                              <div className="text-gray-400">What to look for</div>
                              <div className="text-xs text-gray-300 mt-1">
                                {rdef && rdef.authenticationMethodConfigurations && rdef.authenticationMethodConfigurations.map((c, i) => (
                                  <div key={i}>{c.id}: expected {c.state}</div>
                                ))}
                                {tpl.watched_keys && tpl.watched_keys.length > 0 && (
                                  <ul className="list-disc list-inside mt-1 text-xs text-gray-300">
                                    {tpl.watched_keys.map((wk, i) => <li key={i}>{wk.label || wk.path}</li>)}
                                  </ul>
                                )}
                              </div>
                            </div>
                          )}

                          {(tpl.metadata && tpl.metadata.source) && (
                            <div className="mt-3 text-xs text-gray-300">
                              <div className="text-gray-400">Source</div>
                              <div className="mt-1"><a href={tpl.metadata.source} className="text-blue-400 underline" target="_blank" rel="noreferrer">{tpl.metadata.source}</a></div>
                            </div>
                          )}

                          {/* Show aggregated owner-summary matches or last-run samples if available */}
                          {(() => {
                            const per = perTemplateSummary && perTemplateSummary[tplId]
                            const perItem = per && Array.isArray(per.items) ? per.items.find(i => String(i.refId) === String(ref)) : null
                            const lastRunItems = assessmentResults && assessmentResults[tplId] ? Object.values(assessmentResults[tplId]).flatMap(r => Array.isArray(r.items) ? r.items : []) : []
                            const lastRunItem = lastRunItems.find(i => String(i.refId) === String(ref)) || null
                            if (perItem && (perItem.matchedCount || perItem.totalOccurrences)) {
                              return (
                                <div className="mt-3">
                                  <div className="text-gray-400">Aggregated results</div>
                                  <div className="text-xs text-gray-300 mt-1">{(perItem.matchedCount || 0)}/{(perItem.totalOccurrences || 0)} tenants matched</div>
                                  {perItem.sampleMatchAll && perItem.sampleMatchAll.length > 0 && (
                                    <ul className="mt-2 list-disc list-inside">
                                      {perItem.sampleMatchAll.map((s, i) => (
                                        <li key={i} className="text-xs">
                                          <div className="font-medium">{(s && (s.displayName || s.key)) || String(s)}</div>
                                          {s && Array.isArray(s.matchedPaths) && s.matchedPaths.length > 0 && (
                                            <div className="text-xs text-gray-400">{s.matchedPaths.map(p => `${p.path}: ${JSON.stringify(p.actual === undefined ? p.expected : p.actual)}`).join(' • ')}</div>
                                          )}
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </div>
                              )
                            }
                            if (lastRunItem && (lastRunItem.matchedSamples || lastRunItem.matchAll || lastRunItem.matchAny)) {
                              const samples = lastRunItem.matchedSamples && lastRunItem.matchedSamples.length > 0 ? lastRunItem.matchedSamples : (lastRunItem.matchAll && lastRunItem.matchAll.length > 0 ? lastRunItem.matchAll : (lastRunItem.matchAny || []))
                              return (
                                <div className="mt-3">
                                  <div className="text-gray-400">Last-run sample results</div>
                                  <div className="text-xs text-gray-300 mt-1">Status: {lastRunItem.status || 'unknown'}</div>
                                  <ul className="mt-2 list-disc list-inside">
                                    {samples.map((s, i) => (
                                      <li key={i} className="text-xs">
                                        <div className="font-medium">{(s && (s.displayName || s.id)) || String(s)}</div>
                                        {s && Array.isArray(s.matchedPaths) && s.matchedPaths.length > 0 && (
                                          <div className="text-xs text-gray-400">{s.matchedPaths.map(p => `${p.path}: ${JSON.stringify(p.actual === undefined ? p.expected : p.actual)}`).join(' • ')}</div>
                                        )}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )
                            }
                            return null
                          })()}

                          <div className="mt-3 flex items-center gap-2">
                            <button onClick={closeDetail} className="btn-secondary text-xs">Close</button>
                          </div>
                        </div>
                      )
                    })()
                  ) : (
                    <div className="text-sm text-gray-500">No items returned for this check.</div>
                  )
                ) : (
                  <>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs text-gray-400 flex items-center gap-2">
                        <input type="checkbox" checked={modalShowOnlyFailures} onChange={() => setModalShowOnlyFailures(v => !v)} className="accent-indigo-500"/>
                        Show only failures
                      </label>
                      <div className="text-xs text-gray-400">{items.length} items</div>
                    </div>

                    {(() => {
                      const filtered = (items || []).filter(it => {
                        if (!modalShowOnlyFailures) return true
                        if (isAggregate) return ((it.totalOccurrences || 0) > 0 && (it.matchedCount || 0) !== (it.totalOccurrences || 0))
                        return it.status !== 'matched'
                      })
                      if (filtered.length === 0) return <div className="text-sm text-gray-500">No items match the filter.</div>
                      return filtered.map(it => <ModalItem key={it.refId} it={it} tpl={tpl} isAggregate={isAggregate} openAll={modalExpandAll} showOnlyFailures={modalShowOnlyFailures} defaultOpenRef={detailModal.refId} />)
                    })()}
                  </>
                )}
              </div>
            </div>
          </div>
        )
      })()}

      <div className="flex items-start gap-3 bg-blue-950/20 border border-blue-900/40 rounded-xl px-4 py-3 text-sm text-blue-300">
        <Info size={15} className="shrink-0 mt-0.5"/>
        <div>
          <strong className="text-white">Read-only assessment layer.</strong>{' '}
          Security checks run against live snapshots from your selected tenants. They do not modify or overwrite any tenant baseline.
          <br/>
          <span className="text-blue-400/80 text-xs mt-1 block">
            Pull live data from each area view first. Check results reflect the most recent snapshot — not real-time data.
          </span>
        </div>
      </div>

      {/* Tenant selector */}
      <div className="card space-y-3">
            <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Tenant to Check</h2>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400">Click a tenant to start</span>
          </div>
        </div>
        {tenants.length === 0 ? (
          <p className="text-sm text-gray-600">No tenants registered yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {tenants.map(tenant => {
              const selected = selectedTenants.includes(tenant.id)
              return (
                <label key={tenant.id}
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors
                    ${selected ? 'border-brand-700/60 bg-brand-950/20' : 'border-gray-800 hover:border-gray-700'}`}>
                  <input type="radio" name="tenant-select" checked={selected} onChange={() => toggleTenant(tenant.id)} className="accent-indigo-500"/>
                  <div className="min-w-0">
                    <div className="text-sm text-white font-medium truncate">{tenant.display_name}</div>
                    {(tenant.tags || []).length > 0 && (
                      <div className="flex gap-1 mt-0.5 flex-wrap">
                        {tenant.tags.map(tag => (
                          <span key={tag} className="text-xs text-gray-500 flex items-center gap-0.5">
                            <Tag size={9}/>{tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </label>
              )
            })}
          </div>
        )}
      </div>

          {/* Owner-scoped summary (Pass / Fail / Total) */}
          
  
      <div className="flex justify-end mb-2 items-center gap-2">
        <button
          onClick={() => exportFailingCSV()}
          disabled={selectedTenants.length === 0 || (Object.keys(perTemplateSummary || {}).length === 0 && Object.keys(assessmentResults || {}).length === 0)}
          className="btn-secondary text-xs"
          title="Export failing items as CSV — uses results from Run Assessment Checks or owner summary"
        >
          Export failing (CSV)
        </button>

        <button
          onClick={() => exportFailingJSON()}
          disabled={selectedTenants.length === 0 || (Object.keys(perTemplateSummary || {}).length === 0 && Object.keys(assessmentResults || {}).length === 0)}
          className="btn-secondary text-xs"
          title="Export failing items as JSON — uses results from Run Assessment Checks or owner summary"
        >
          Export failing (JSON)
        </button>
      </div>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div className="card-sm text-center">
              <div className="text-2xl font-bold text-green-400">{ownerSummaryLoading ? '…' : (displayTotals.passing ?? 0)}</div>
              <div className="text-xs text-gray-500">Pass</div>
            </div>

              <div className="card-sm text-center">
                <div className={`text-2xl font-bold ${((displayTotals.failing) || 0) > 0 ? 'text-red-400' : 'text-gray-500'}`}>{ownerSummaryLoading ? '…' : (displayTotals.failing ?? 0)}</div>
                <div className="text-xs text-gray-500">Fail</div>
              </div>

              <div className="card-sm text-center">
                <div className="text-2xl font-bold text-gray-300">{ownerSummaryLoading ? '…' : (displayTotals.total ?? 0)}</div>
                <div className="text-xs text-gray-500">Total Items</div>
              </div>
          </div>

          {/* Reference Sets (flat, grouped by category) */}
          <div className="card space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-white">Zero Trust Checks</h2>
                <div className="text-sm text-gray-500 mt-1">Select tenants and checks, then click <strong>Run Assessment Checks</strong>.</div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <select value={selectedCategory} onChange={e => setSelectedCategory(e.target.value)} className="text-xs bg-gray-900 border border-gray-800 rounded px-2 py-1">
                    <option key="all" value="all">All categories</option>
                    {Array.from(new Set((assessmentTemplates || []).map(t => (t.metadata && t.metadata.category) ? t.metadata.category : 'Uncategorized'))).map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>

                <button onClick={() => {
                  try {
                    const visible = (selectedCategory === 'all' ? assessmentTemplates : (assessmentTemplates || []).filter(t => ((t.metadata && t.metadata.category) ? t.metadata.category : 'Uncategorized') === selectedCategory))
                    // Select templates (preserve grouping) instead of switching to per-control flat view
                    const templateIds = (visible || []).map(t => t.id).filter(Boolean)
                    setSelectedAssessmentTemplates(Array.from(new Set(templateIds)))
                    // clear any explicit per-control selections so grouping remains
                    setSelectedControls([])
                    // compute approximate count of checks selected for user feedback
                    let count = 0
                    for (const tpl of (visible || [])) {
                      if (tpl.resources && Object.keys(tpl.resources).length > 0) count += Object.keys(tpl.resources).length
                      else if (Array.isArray(tpl.settings) && tpl.settings.length > 0) count += tpl.settings.length
                    }
                    showToast(`${count} checks selected`, 'success')
                  } catch (err) {
                    showToast('Failed to select checks', 'error')
                  }
                }} className="btn-secondary text-xs">Select All</button>
                <button onClick={() => { setSelectedAssessmentTemplates([]); setSelectedControls([]) }} className="btn-secondary text-xs">None</button>
                <button onClick={runAssessmentChecks} disabled={assessmentRunning || selectedTenants.length === 0 || (selectedAssessmentTemplates.length === 0 && selectedControls.length === 0)} className="btn-primary">
                  <RefreshCw size={13} className={assessmentRunning ? 'animate-spin' : ''}/>
                  {assessmentRunning ? 'Running…' : 'Run Assessment Checks'}
                </button>
              </div>
            </div>

            {assessmentTemplates.length === 0 ? (
              <p className="text-sm text-gray-600">No assessment templates available.</p>
            ) : (
              (() => {
                // Build flat list of controls grouped by category (Identity / Devices first)
                const groups = {}
                for (const tpl of (assessmentTemplates || [])) {
                  const cat = (tpl.metadata && tpl.metadata.category) ? tpl.metadata.category : 'Uncategorized'
                  if (!groups[cat]) groups[cat] = []
                  if (Array.isArray(tpl.settings) && tpl.settings.length > 0) {
                      const resourceKeys = tpl.resources ? Object.keys(tpl.resources) : []
                      for (let i = 0; i < tpl.settings.length; i++) {
                        const s = tpl.settings[i]
                        let resourceKey = s.resource || s.refId || s.resourceId || null
                        // Prefer index mapping when resource keys align with settings — this gives the
                        // actual resource key names (matching backend `refId`) rather than the
                        // presentation-only `control_id` suffix (e.g. "app-1").
                        if (!resourceKey && resourceKeys.length === tpl.settings.length) resourceKey = resourceKeys[i]
                        // Next, if a control_id suffix matches an actual resource key, use it.
                        if (!resourceKey && s.control_id) {
                          const parts = String(s.control_id).split(':')
                          if (parts.length > 1) {
                            const suffix = parts[parts.length - 1]
                            if (resourceKeys.includes(suffix)) resourceKey = suffix
                          }
                        }
                        // Fallback to first resource if nothing else found
                        if (!resourceKey && resourceKeys.length > 0) resourceKey = resourceKeys[0]
                        groups[cat].push({ tpl, setting: s, resourceKey })
                      }
                    } else if (tpl.resources) {
                    for (const [rkey, rdef] of Object.entries(tpl.resources)) {
                      groups[cat].push({ tpl, setting: { control_id: `${tpl.id}:${rkey}`, title: rdef.displayName || rdef.display_name || rkey }, resourceKey: rkey })
                    }
                  }
                }
                

                const allCats = Object.keys(groups)
                const cats = ['Identity', 'Devices', ...allCats.filter(c => !['Identity', 'Devices'].includes(c))]

                return (
                  <div className="space-y-4">
                    {cats.map(cat => {
                      const items = (groups[cat] || []).filter(i => selectedCategory === 'all' ? true : ((i.tpl && i.tpl.metadata && i.tpl.metadata.category) ? i.tpl.metadata.category === selectedCategory : selectedCategory === 'Uncategorized'))
                      if (!items || items.length === 0) return null
                      return (
                        <div key={cat}>
                          <div className="flex items-center justify-between mb-2">
                            <h3 className="text-sm font-semibold text-white">{cat}</h3>
                            <div className="text-xs text-gray-400">{items.length} checks</div>
                          </div>
                          <div className="space-y-2">
                            {items.map(it => {
                              const tpl = it.tpl
                              const setting = it.setting
                              const resourceKey = it.resourceKey
                              const st = computeControlStatus(tpl, setting, null, true) || (computeResourceStatus(tpl.id, resourceKey) || {}).status || null
                              const resultObj = st ? (typeof st === 'string' ? { status: st, pass: st === 'matched' } : { status: st.status, pass: !!st.pass }) : null
                              const resourceName = (tpl.resources && tpl.resources[resourceKey] && (tpl.resources[resourceKey].displayName || tpl.resources[resourceKey].display_name)) || resourceKey
                              const sanitizedTplName = stripZeroTrustPrefix(tpl.name) || tpl.name || ''
                              const controlKey = makeControlKey(tpl.id, resourceKey)
                              const checked = selectedControls.includes(controlKey) || selectedAssessmentTemplates.includes(tpl.id)
                              return (
                                <div
                                  key={`${tpl.id}||${setting.control_id || resourceKey}`}
                                  className="flex items-center justify-between rounded border px-4 py-3 cursor-pointer"
                                  role="button"
                                  tabIndex={0}
                                  data-testid={`control-row-${tpl.id}-${resourceKey}`}
                                  onClick={(e) => {
                                    try {
                                      const tgt = e && e.target
                                      if (tgt && (tgt.tagName === 'INPUT' || (tgt.closest && tgt.closest('input')))) return
                                    } catch (err) { /* ignore */ }
                                    openDetail(tpl.id, 'aggregate', resourceKey)
                                  }}
                                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') openDetail(tpl.id, 'aggregate') }}
                                >
                                  <div className="flex items-center min-w-0 mr-4 gap-3">
                                    <input
                                      type="checkbox"
                                      aria-label={`Select ${setting.title}`}
                                      checked={checked}
                                      onChange={(e) => {
                                        e.stopPropagation()
                                        if (selectedAssessmentTemplates.includes(tpl.id)) {
                                          const keysForTpl = []
                                          if (tpl.resources && Object.keys(tpl.resources).length > 0) {
                                            for (const r of Object.keys(tpl.resources)) keysForTpl.push(makeControlKey(tpl.id, r))
                                          } else if (Array.isArray(tpl.settings) && tpl.settings.length > 0) {
                                            for (let si = 0; si < tpl.settings.length; si++) {
                                              const s = tpl.settings[si]
                                              let rk = s.resource || s.refId || s.resourceId || null
                                              const resourceKeysInner = tpl.resources ? Object.keys(tpl.resources) : []
                                              // prefer index mapping when counts align
                                              if (!rk && resourceKeysInner.length === tpl.settings.length) rk = resourceKeysInner[si]
                                              if (!rk && s.control_id) {
                                                const parts = String(s.control_id).split(':')
                                                if (parts.length > 1) {
                                                  const suffix = parts[parts.length - 1]
                                                  if (resourceKeysInner.includes(suffix)) rk = suffix
                                                }
                                              }
                                              if (!rk && resourceKeysInner.length > 0) rk = resourceKeysInner[0] || null
                                              keysForTpl.push(makeControlKey(tpl.id, rk))
                                            }
                                          }
                                          setSelectedControls(prev => {
                                            const next = new Set(prev.filter(k => !k.startsWith(`${tpl.id}||`)))
                                            for (const k of keysForTpl) next.add(k)
                                            if (next.has(controlKey)) next.delete(controlKey)
                                            else next.add(controlKey)
                                            return Array.from(next)
                                          })
                                          setSelectedAssessmentTemplates(prev => prev.filter(id => id !== tpl.id))
                                        } else {
                                          toggleControlSelection(controlKey)
                                        }
                                      }}
                                      onMouseDown={(e) => e.stopPropagation()}
                                      onPointerDown={(e) => e.stopPropagation()}
                                      onClick={(e) => e.stopPropagation()}
                                      className="accent-indigo-500"
                                    />
                                    <div>
                                      <div className="text-sm text-gray-300 font-medium">{setting.title}</div>
                                      <div className="text-xs text-gray-500">{sanitizedTplName} • {resourceName}</div>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-3">
                                    <ResultBadge result={resultObj} />
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })()
            )}
          </div>

      

      
    </div>
  )
}
