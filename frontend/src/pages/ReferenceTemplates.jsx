import React, { useState, useEffect, useRef } from 'react'
import { FileText, Search, ExternalLink, ChevronDown, ChevronRight, Camera, SlidersHorizontal, CheckCircle, XCircle, AlertCircle, Eye } from 'lucide-react'
import { referenceApi, jobApi } from '../api/client.js'

export default function ReferenceTemplates({ tenants = [], showToast }) {
  const isZeroTrustTemplate = (tpl) => {
    if (!tpl || typeof tpl !== 'object') return false
    const owner = String((tpl.metadata && tpl.metadata.owner) || '').toLowerCase()
    const name = String(tpl.name || tpl.display_name || tpl.displayName || '').trim()
    return owner === 'zerotrust' || /^zerotrust\b/i.test(name)
  }

  const filterReferenceTemplates = (list) => (list || []).filter(t => !isZeroTrustTemplate(t))

  const filterOwners = (list) => (list || []).filter(o => {
    if (!o) return false
    const key = String(o.key || '').toLowerCase()
    return key !== 'community' && key !== 'zerotrust'
  })

  const [referenceTemplates, setReferenceTemplates] = useState([])
  const [owners, setOwners] = useState([{ key: 'all', display: 'All' }])
  const [selectedOwner, setSelectedOwner] = useState('all')
  const [detail, setDetail] = useState(null)
  const [compareTpl, setCompareTpl] = useState(null)
  const [compareTenant, setCompareTenant] = useState(null)
  const [compareResults, setCompareResults] = useState(null)
  const [comparePolicyType, setComparePolicyType] = useState('')
  const [compareUseV2, setCompareUseV2] = useState(false)
  const [compareUseFreshPull, setCompareUseFreshPull] = useState(true)
  const [compareStatusFilter, setCompareStatusFilter] = useState('all')
  const [compareSearch, setCompareSearch] = useState('')
  const [compareRegressionResult, setCompareRegressionResult] = useState(null)
  const [mappingPreflight, setMappingPreflight] = useState(null)
  const [mappingPreflightLoading, setMappingPreflightLoading] = useState(false)
  const [mappingPreflightError, setMappingPreflightError] = useState('')
  const [blockCompareOnPreflightFail, setBlockCompareOnPreflightFail] = useState(false)
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [importPreview, setImportPreview] = useState(null)
  const [importFileName, setImportFileName] = useState('')
  const [importFamilyId, setImportFamilyId] = useState('')
  const [importFamilyCustom, setImportFamilyCustom] = useState('')
  const [importFamilyDetected, setImportFamilyDetected] = useState('')
  const [importFamilyConfidence, setImportFamilyConfidence] = useState('')
  const [importLoading, setImportLoading] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const [importPreflightById, setImportPreflightById] = useState({})
  const [importPreflightLoadingById, setImportPreflightLoadingById] = useState({})
  const [dragActive, setDragActive] = useState(false)
  const [importProgress, setImportProgress] = useState(0)
  const [editingFamilyId, setEditingFamilyId] = useState(null)
  const [savingFamily, setSavingFamily] = useState(false)
  const [savingFamilyProgress, setSavingFamilyProgress] = useState(0)
  const [importCompareInProgress, setImportCompareInProgress] = useState(null)
  const [selectedRefId, setSelectedRefId] = useState(null)
  const fileInputRef = useRef(null)
  const [expandedRefs, setExpandedRefs] = useState({})
  const [isComparing, setIsComparing] = useState(false)
  const [openCompareItems, setOpenCompareItems] = useState({})
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerItem, setDrawerItem] = useState(null)
  const [drawerPolicyId, setDrawerPolicyId] = useState(null)
  const [compareMultiMode, setCompareMultiMode] = useState(false)
  const [selectedTenantIds, setSelectedTenantIds] = useState([])
  const [compareMultiResults, setCompareMultiResults] = useState(null)
  const [isComparingMulti, setIsComparingMulti] = useState(false)
  const [asyncJobId, setAsyncJobId] = useState(null)
  const [asyncJobStatus, setAsyncJobStatus] = useState(null)
  const [asyncJobPolling, setAsyncJobPolling] = useState(false)
  const [asyncJobResults, setAsyncJobResults] = useState(null)
  const pollRef = useRef(null)
  const [confirmBulkOpen, setConfirmBulkOpen] = useState(false)
  const [splitIntoBatches, setSplitIntoBatches] = useState(false)
  const [asyncJobIds, setAsyncJobIds] = useState([])
  const [deletingTemplateId, setDeletingTemplateId] = useState(null)

  const CUSTOM_FAMILY = '__custom__'

  useEffect(() => {
    referenceApi.owners().then(list => {
      const arr = filterOwners(list)
      if (!arr.find(o => o.key === 'openintune')) arr.push({ key: 'openintune', display: 'OpenIntuneBaseline' })
      if (!arr.find(o => o.key === 'custom')) arr.push({ key: 'custom', display: 'Custom' })
      setOwners([{ key: 'all', display: 'All' }, ...arr])
    }).catch(() => {
      // fallback: ensure OpenIntuneBaseline and Custom owners are present when owners API fails
      setOwners([{ key: 'all', display: 'All' }, { key: 'openintune', display: 'OpenIntuneBaseline' }, { key: 'custom', display: 'Custom' }])
    })
    referenceApi.list().then(list => setReferenceTemplates(filterReferenceTemplates(list))).catch(() => showToast && showToast('Failed to load reference templates', 'error'))
  }, [])

  // Grouping by owner; no client-side hidden-sections persisted

  useEffect(() => {
    const owner = selectedOwner === 'all' ? undefined : selectedOwner
    referenceApi.list(owner).then(list => setReferenceTemplates(filterReferenceTemplates(list))).catch(() => {})
  }, [selectedOwner])

  const openDetail = async (tpl) => {
    try {
      const full = await referenceApi.get(tpl.id)
      setDetail(full)
    } catch {
      showToast && showToast('Failed to load template', 'error')
    }
  }

  const openCompare = (tpl) => {
    if (!compareTenant) {
      showToast && showToast('Select a tenant first, then choose a template to compare', 'error')
      return
    }
    setSelectedRefId(null)
    setExpandedRefs({})
    setCompareTpl(tpl)
    setComparePolicyType('')
    setCompareUseV2(false)
    setCompareUseFreshPull(true)
    setCompareStatusFilter('all')
    setCompareSearch('')
    setCompareRegressionResult(null)
    setCompareResults(null)
    setMappingPreflight(null)
    setMappingPreflightError('')
    ;(async () => {
      try {
        const full = await referenceApi.get(tpl.id)
        setCompareTpl(full)
        const inferredPolicyType = (full && full.metadata && (full.metadata.policy_type_normalized || full.metadata.policy_type)) || full.policy_type || full.profile_type || ''
        setComparePolicyType(inferredPolicyType || '')
      } catch (err) {
        showToast && showToast('Failed to load template for compare', 'error')
      }
    })()
  }

  const isCustomTemplate = (tpl) => {
    if (!tpl || typeof tpl !== 'object') return false
    const owner = String((tpl.metadata && tpl.metadata.owner) || '').toLowerCase()
    return owner === 'custom'
  }

  const runMappingPreflight = async (opts = {}) => {
    if (!compareTpl || !isCustomTemplate(compareTpl)) return
    setMappingPreflightLoading(true)
    setMappingPreflightError('')
    try {
      const payload = {
        ...(compareTenant && compareTenant.id ? { tenantId: compareTenant.id } : {})
      }
      const res = await referenceApi.preflightMapping(compareTpl.id, payload)
      setMappingPreflight(res)
      if (opts && opts.notify) {
        const ok = Boolean(res && res.ok)
        showToast && showToast(ok ? 'Mapping preflight passed' : 'Mapping preflight found issues', ok ? 'success' : 'error')
      }
    } catch (err) {
      setMappingPreflight(null)
      setMappingPreflightError('Failed to run mapping preflight')
      if (opts && opts.notify) showToast && showToast('Failed to run mapping preflight', 'error')
    } finally {
      setMappingPreflightLoading(false)
    }
  }

  const getImportedEntryId = (entry) => {
    if (!entry || typeof entry !== 'object') return ''
    if (entry.id) return String(entry.id)
    if (entry.file) return String(entry.file).replace(/\.json$/i, '')
    return ''
  }

  const preloadImportResultPreflight = async (resultPayload) => {
    const list = (resultPayload && Array.isArray(resultPayload.imported)) ? resultPayload.imported : []
    if (!list.length) return
    const tenantIdForPreflight = (compareTenant && compareTenant.id) || ((tenants && tenants[0] && tenants[0].id) || null)

    for (const f of list) {
      const id = getImportedEntryId(f)
      if (!id || f.error) continue
      setImportPreflightLoadingById(prev => ({ ...prev, [id]: true }))
      try {
        const body = tenantIdForPreflight ? { tenantId: tenantIdForPreflight } : {}
        const preflight = await referenceApi.preflightMapping(id, body)
        setImportPreflightById(prev => ({ ...prev, [id]: preflight }))
      } catch (err) {
        setImportPreflightById(prev => ({
          ...prev,
          [id]: {
            ok: false,
            hasSnapshot: false,
            preflight: { requiredMappingsResolved: 0, requiredMappingsTotal: 0, requiredMappingsResolvedPct: 0 },
            validation: { errors: ['Preflight request failed'] }
          }
        }))
      } finally {
        setImportPreflightLoadingById(prev => ({ ...prev, [id]: false }))
      }
    }
  }

  // Grouping by owner will be used for rendering instead of legacy 'sections'

  const toggleRef = (refKey) => {
    setExpandedRefs(prev => {
      const next = { ...prev, [refKey]: !prev[refKey] }
      if (next[refKey]) setSelectedRefId(refKey)
      else if (selectedRefId === refKey) setSelectedRefId(null)
      return next
    })
  }

  const toggleOpenCompareItem = (refId) => {
    setOpenCompareItems(prev => ({ ...prev, [refId]: !prev[refId] }))
  }

  const getByPath = (obj, path) => {
    if (!obj || !path) return undefined
    return path.split('.').reduce((acc, k) => acc == null ? undefined : acc[k], obj)
  }

  // Basic pre-import validation to avoid obvious bad uploads
  const validateImportJson = (payload) => {
    const errors = []

    const validateMappingContractShape = (entry, idxLabel = '') => {
      const meta = (entry && typeof entry === 'object' && entry.metadata && typeof entry.metadata === 'object') ? entry.metadata : {}
      const owner = String(meta.owner || '').toLowerCase()
      if (owner !== 'custom') return
      const contract = meta.mappingContract
      if (contract === undefined || contract === null) return
      if (typeof contract !== 'object') {
        errors.push(`${idxLabel}metadata.mappingContract must be an object when provided`)
        return
      }
      const requiredMappings = Array.isArray(contract.requiredMappings) ? contract.requiredMappings : null
      if (!requiredMappings) {
        errors.push(`${idxLabel}metadata.mappingContract.requiredMappings must be an array`)
      } else {
        requiredMappings.forEach((m, i) => {
          if (!m || typeof m !== 'object') {
            errors.push(`${idxLabel}requiredMappings[${i}] must be an object`)
            return
          }
          if (!m.id) errors.push(`${idxLabel}requiredMappings[${i}].id is required`)
          if (!m.refId) errors.push(`${idxLabel}requiredMappings[${i}].refId is required`)
          if (!m.sourceType || !['anchor', 'path'].includes(String(m.sourceType).toLowerCase())) {
            errors.push(`${idxLabel}requiredMappings[${i}].sourceType must be 'anchor' or 'path'`)
          }
          if (!m.sourceKey) errors.push(`${idxLabel}requiredMappings[${i}].sourceKey is required`)
        })
      }
    }

    if (payload === null || payload === undefined) errors.push('JSON is empty')
    // allow array of templates as valid (server supports arrays)
    if (Array.isArray(payload)) {
      if (payload.length === 0) errors.push('Array is empty')
      payload.forEach((entry, idx) => {
        const idxLabel = `Template[${idx}]: `
        if (!entry || typeof entry !== 'object') {
          errors.push(`${idxLabel}must be an object`)
          return
        }
        const hasResources = entry.resources && Object.keys(entry.resources || {}).length > 0
        const hasSettings = Array.isArray(entry.settings) && entry.settings.length > 0
        const hasWatched = Array.isArray(entry.watched_keys) && entry.watched_keys.length > 0
        const hasIdLike = entry.id || entry.template_id || entry.templateId || entry.display_name || entry.name
        if (!hasResources && !hasSettings && !hasWatched && !hasIdLike) {
          errors.push(`${idxLabel}does not appear to be a valid reference template (no resources/settings/watched_keys or id/display_name)`)
        }
        validateMappingContractShape(entry, idxLabel)
      })
      return { ok: errors.length === 0, errors }
    }
    if (typeof payload !== 'object') errors.push('Top-level JSON must be an object or array')

    // Check for common template markers: resources, settings, watched_keys, id/display_name/template_id
    const hasResources = payload && payload.resources && Object.keys(payload.resources || {}).length > 0
    const hasSettings = payload && Array.isArray(payload.settings) && payload.settings.length > 0
    const hasWatched = payload && Array.isArray(payload.watched_keys) && payload.watched_keys.length > 0
    const hasIdLike = payload && (payload.id || payload.template_id || payload.templateId || payload.display_name || payload.name)
    if (!hasResources && !hasSettings && !hasWatched && !hasIdLike) {
      errors.push('JSON does not appear to be a valid reference template (no resources/settings/watched_keys or id/display_name)')
    }

    validateMappingContractShape(payload)

    return { ok: errors.length === 0, errors }
  }

  // family_id validation: allow letters, numbers, underscore, hyphen, colon and dot (1-128 chars)
  const FAMILY_ID_RE = /^[A-Za-z0-9_\-:.]{1,128}$/;
  const validateFamilyId = (id) => {
    if (id === null || id === undefined || String(id).trim() === '') return { ok: true }
    if (typeof id !== 'string') return { ok: false, error: 'Family id must be a string' }
    if (!FAMILY_ID_RE.test(id)) return { ok: false, error: 'Family id may only contain letters, numbers, underscore, hyphen, colon, dot (max 128 chars)' }
    return { ok: true }
  }

  const isOibTemplate = (tpl) => {
    if (!tpl || typeof tpl !== 'object') return false
    const meta = tpl.metadata || {}
    const owner = String(meta.owner || '').toLowerCase()
    const source = String(meta.source || '').toLowerCase()
    const id = String(tpl.id || '').toLowerCase()
    return owner === 'openintune' || source.includes('openintune') || source.includes('open-intune') || id.startsWith('oib:')
  }

  const canDeleteImportedTemplate = (tpl) => {
    if (!tpl || typeof tpl !== 'object') return false
    if (isOibTemplate(tpl)) return false
    const meta = tpl.metadata || {}
    const source = String(meta.source || '').toLowerCase()
    return Boolean(meta.importedAt || meta.originalFileName || source === 'uploaded')
  }

  // Helpers to normalize template family keys and pick the most-recent per family
  const stripVersionSuffix = (s) => {
    if (!s || typeof s !== 'string') return s || ''
    // Remove trailing " - vX", " - vX.Y", or just trailing " vX.Y" patterns
    let out = String(s).trim()
    out = out.replace(/[\s\-–—]+v?\d+(?:[\.\-]\d+)*$/i, '').trim()
    // extra pass in case of ' - v1.2' with spaces
    out = out.replace(/[\s\-–—]+v?\d+(?:[\.\-]\d+)*$/i, '').trim()
    return out
  }

  const pickLatestPerFamily = (templates) => {
    if (!Array.isArray(templates)) return templates || []
    const map = new Map()

    const parseDate = (obj) => Date.parse(obj || '') || 0

    for (const t of templates) {
      const meta = t && (t.metadata || {}) || {}

      // Strong grouping key preference (in order):
      // 1) metadata.family_id | metadata.familyId | metadata.family
      // 2) metadata.template_family | metadata.family_key
      // 3) policy_type / policyType
      // 4) fallback: stripped display name/template id
      let familyKey = null
      const candidateKeys = ['family_id', 'familyId', 'family', 'template_family', 'family_key', 'familyKey']
      for (const k of candidateKeys) {
        if (meta && Object.prototype.hasOwnProperty.call(meta, k) && meta[k]) {
          familyKey = String(meta[k]).trim().toLowerCase()
          break
        }
      }

      if (!familyKey) {
        const policyType = t && (t.policy_type || t.policyType)
        if (policyType) familyKey = String(policyType).trim().toLowerCase()
      }

      const rawName = t && (t.name || t.display_name || t.displayName || t.template_id || t.id) || ''
      if (!familyKey) familyKey = stripVersionSuffix(rawName).toLowerCase() || (t.id || '')

      const existing = map.get(familyKey)
      const tDate = parseDate(t && (t.last_modified || (t.metadata && t.metadata.importedAt) || t.updated_at || t.updated || t.created_at || t.created))
      if (!existing) { map.set(familyKey, t); continue }
      const eDate = parseDate(existing && (existing.last_modified || (existing.metadata && existing.metadata.importedAt) || existing.updated_at || existing.updated || existing.created_at || existing.created))

      if (tDate && eDate) {
        if (tDate > eDate) map.set(familyKey, t)
      } else if (tDate && !eDate) {
        map.set(familyKey, t)
      } else if (!tDate && !eDate) {
        // Fallback: prefer the one with a longer id (arbitrary but stable)
        if ((t.id || '').length > (existing.id || '').length) map.set(familyKey, t)
      }
    }
    return Array.from(map.values())
  }

  // Save family id for the currently viewed template (admin action)
  const saveTemplateFamily = async () => {
    if (!detail) return
    const v = validateFamilyId(editingFamilyId)
    if (!v.ok) {
      showToast && showToast(v.error || 'Invalid family id', 'error')
      return
    }
    setSavingFamily(true)
    setSavingFamilyProgress(5)
    try {
      const meta = detail.metadata ? { ...(detail.metadata || {}) } : {}
      if (editingFamilyId && String(editingFamilyId).trim() !== '') meta.family_id = editingFamilyId
      else delete meta.family_id

      const tenantIdForDetail = detail && (detail._tenantId || detail.tenantId) ? (detail._tenantId || detail.tenantId) : undefined

      await referenceApi.patchMetadata(detail.id, { metadata: meta }, { tenantId: tenantIdForDetail })
      try { await referenceApi.reload() } catch (e) {}
      try {
        const updated = tenantIdForDetail ? await referenceApi.getTenantTemplate(tenantIdForDetail, detail.id) : await referenceApi.get(detail.id)
        setDetail(updated)
      } catch (e) {
        // ignore
      }
      // refresh list
      try { const owner = selectedOwner === 'all' ? undefined : selectedOwner; const list = await referenceApi.list(owner); setReferenceTemplates(filterReferenceTemplates(list)) } catch (e) {}
      showToast && showToast('Family updated', 'success')
      setEditingFamilyId(null)
    } catch (err) {
      showToast && showToast('Failed to update family', 'error')
    } finally {
      setSavingFamily(false)
      setSavingFamilyProgress(0)
    }
  }

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

  // No client-side hidden-sections persistence needed when grouping by owner

  const runCompare = async () => {
    if (!compareTpl || !compareTenant) return showToast && showToast('Select a tenant to compare', 'error')
    if (isCustomTemplate(compareTpl) && blockCompareOnPreflightFail) {
      const hasPreflightFailure = mappingPreflight && mappingPreflight.ok === false
      if (hasPreflightFailure) {
        showToast && showToast('Compare blocked by mapping preflight. Disable blocking or fix mapping issues first.', 'error')
        return
      }
    }
    setIsComparing(true)
    try {
      const policyType = comparePolicyType && String(comparePolicyType).trim() ? String(comparePolicyType).trim() : undefined
      const useV2ForRun = Boolean(policyType) || compareUseV2
      const res = await referenceApi.compare(
        compareTpl.id,
        { tenantId: compareTenant.id, scan: compareUseFreshPull, useV2: useV2ForRun, policyType, strictPolicyType: Boolean(policyType) },
        { v2: useV2ForRun, policyType }
      )
      setCompareResults(res)
      // Auto-select first reference result if available to show matches immediately
      if (res && Array.isArray(res.items) && res.items.length > 0) {
        const first = res.items[0]
        setSelectedRefId(first.refId)
        setExpandedRefs(prev => ({ ...prev, [first.refId]: true }))
      }
    } catch (err) {
      showToast && showToast('Compare failed', 'error')
    } finally {
      setIsComparing(false)
    }
  }

  useEffect(() => {
    if (!compareTpl || !isCustomTemplate(compareTpl)) {
      setMappingPreflight(null)
      setMappingPreflightError('')
      return
    }
    runMappingPreflight({ notify: false })
  }, [compareTpl?.id, compareTenant?.id])

  const runCompareRegressionCheck = async () => {
    if (!compareTpl || !compareTenant) return showToast && showToast('Select a tenant to compare', 'error')
    setIsComparing(true)
    setCompareRegressionResult(null)
    try {
      const legacy = await referenceApi.compare(
        compareTpl.id,
        { tenantId: compareTenant.id, scan: compareUseFreshPull, useV2: false },
        { v2: false }
      )
      const v2 = await referenceApi.compare(
        compareTpl.id,
        { tenantId: compareTenant.id, scan: compareUseFreshPull, useV2: true },
        { v2: true }
      )

      const legacySummary = legacy && legacy.summary ? legacy.summary : {}
      const v2Summary = v2 && v2.summary ? v2.summary : {}
      const sameSummary = ['total', 'matched', 'partial', 'noMatch'].every(k => (legacySummary[k] || 0) === (v2Summary[k] || 0))

      const toStatusMap = (arr) => {
        const map = new Map()
        ;(arr || []).forEach(it => {
          if (it && it.refId) map.set(it.refId, it.status)
        })
        return map
      }
      const a = toStatusMap(legacy && legacy.items)
      const b = toStatusMap(v2 && v2.items)
      const keys = new Set([...Array.from(a.keys()), ...Array.from(b.keys())])
      let statusMismatches = 0
      keys.forEach(k => {
        if ((a.get(k) || 'missing') !== (b.get(k) || 'missing')) statusMismatches++
      })

      const ok = sameSummary && statusMismatches === 0
      const result = {
        ok,
        sameSummary,
        statusMismatches,
        legacySummary,
        v2Summary,
      }
      setCompareRegressionResult(result)
      showToast && showToast(ok ? 'Regression check passed (legacy == v2)' : 'Regression check found differences', ok ? 'success' : 'error')
    } catch (err) {
      showToast && showToast('Regression check failed to run', 'error')
    } finally {
      setIsComparing(false)
    }
  }

  const closeCompareModal = () => {
    setCompareTpl(null)
    setMappingPreflight(null)
    setMappingPreflightError('')
  }
    // Multi-tenant compare starter (used by multi-tenant UI)
  const runCompareMulti = async () => {
    if (!compareTpl) return showToast && showToast('Select a template to compare', 'error')
    // If no tenants explicitly selected, confirm bulk action
    if (!selectedTenantIds || selectedTenantIds.length === 0) {
      setConfirmBulkOpen(true)
      return
    }
    startAsyncCompare()
  }

  const toggleTenantId = (tenantId) => {
    setSelectedTenantIds(prev => {
      if (prev.includes(tenantId)) return prev.filter(id => id !== tenantId)
      return [...prev, tenantId]
    })
  }

  const startAsyncCompare = async () => {
    if (!compareTpl) return showToast && showToast('Select a template to compare', 'error')
    // If no tenants selected, default to all tenants (bulk)
    const tenantIdsToUse = (selectedTenantIds && selectedTenantIds.length > 0) ? selectedTenantIds : (tenants || []).map(t => t.id)
    if (!tenantIdsToUse || tenantIdsToUse.length === 0) return showToast && showToast('No tenants available to compare', 'error')

    setAsyncJobPolling(true)
    setAsyncJobStatus('pending')
    setAsyncJobId(null)
    setAsyncJobIds([])
    setAsyncJobResults(null)
    try {
      if (!splitIntoBatches) {
        const resp = await referenceApi.compareMultiAsync(compareTpl.id, { tenantIds: tenantIdsToUse })
        if (resp && resp.jobId) {
          setAsyncJobId(resp.jobId)
          // begin polling single job
          pollJob(resp.jobId)
          showToast && showToast('Compare job queued', 'info')
        } else {
          setAsyncJobPolling(false)
          showToast && showToast('Failed to queue compare job', 'error')
        }
      } else {
        // Split into batches to limit per-job size / concurrency
        const BATCH_SIZE = 50
        const batches = []
        for (let i = 0; i < tenantIdsToUse.length; i += BATCH_SIZE) batches.push(tenantIdsToUse.slice(i, i + BATCH_SIZE))
        const jobIds = []
        for (const batch of batches) {
          try {
            const resp = await referenceApi.compareMultiAsync(compareTpl.id, { tenantIds: batch })
            if (resp && resp.jobId) jobIds.push(resp.jobId)
          } catch (e) {
            // continue - record missing job for visibility
          }
          // small delay to avoid bursting the server
          await new Promise(r => setTimeout(r, 150))
        }
        if (jobIds.length === 0) {
          setAsyncJobPolling(false)
          showToast && showToast('Failed to queue any compare jobs', 'error')
        } else {
          setAsyncJobIds(jobIds)
          setAsyncJobStatus('queued')
          // Poll multiple jobs
          pollJobs(jobIds)
          showToast && showToast(`Queued ${jobIds.length} compare job(s)`, 'info')
        }
      }
    } catch (err) {
      setAsyncJobPolling(false)
      showToast && showToast('Failed to queue compare job', 'error')
    }
  }

  const pollJob = (jobId) => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const job = await jobApi.get(jobId)
        setAsyncJobStatus(job.status)
        // job.result may be present as job.result.results or job.results
        if (job.status === 'complete' || job.status === 'failed' || job.status === 'unavailable') {
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
          setAsyncJobPolling(false)
          const results = (job.result && job.result.results) ? job.result.results : (job.results || [])
          setAsyncJobResults(results)
          // reuse existing multi-results rendering for convenience
          setCompareMultiResults({ templateId: compareTpl && compareTpl.id, checked: results.length, results })
          showToast && showToast('Compare job finished', 'success')
        }
      } catch (err) {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
        setAsyncJobPolling(false)
        setAsyncJobStatus('failed')
        showToast && showToast('Failed to poll job status', 'error')
      }
    }, 2000)
  }

  const pollJobs = (jobIds) => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const statuses = await Promise.all(jobIds.map(id => jobApi.get(id).catch(e => ({ error: true }))))
        const allDone = statuses.every(j => j && (j.status === 'complete' || j.status === 'failed' || j.status === 'unavailable'))
        setAsyncJobStatus(allDone ? 'complete' : 'running')
        const resultsArr = statuses.map(j => (j && j.result && j.result.results) ? j.result.results : (j && j.results ? j.results : []) )
        const flat = [].concat(...resultsArr.filter(Boolean))
        if (allDone) {
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
          setAsyncJobPolling(false)
          setAsyncJobResults(flat)
          setCompareMultiResults({ templateId: compareTpl && compareTpl.id, checked: flat.length, results: flat })
          showToast && showToast('Compare jobs finished', 'success')
        }
      } catch (err) {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
        setAsyncJobPolling(false)
        setAsyncJobStatus('failed')
        showToast && showToast('Failed to poll jobs status', 'error')
      }
    }, 2000)
  }

  useEffect(() => {
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    }
  }, [])

  // Animate progress while importing to provide user feedback
  useEffect(() => {
    let t = null
    if (importLoading) {
      setImportProgress(5)
      t = setInterval(() => setImportProgress(p => Math.min(95, p + Math.floor(Math.random() * 12) + 3)), 300)
    } else {
      // leave progress at 100 briefly or reset to 0
      if (importProgress > 0 && importProgress < 100) setImportProgress(100)
      const reset = setTimeout(() => setImportProgress(0), 700)
      return () => clearTimeout(reset)
    }
    return () => { if (t) clearInterval(t) }
  }, [importLoading])

  const comparePolicyTypeOptions = React.useMemo(() => {
    const options = new Set()
    if (!compareTpl) return []
    const meta = compareTpl.metadata || {}
    ;[
      meta.policy_type_normalized,
      meta.policy_type,
      compareTpl.policy_type,
      compareTpl.profile_type,
      compareTpl.policyType,
      compareTpl.profileType,
    ].filter(Boolean).forEach(v => options.add(String(v)))
    return Array.from(options)
  }, [compareTpl])

  const displayTemplates = referenceTemplates || []

  const DEFAULT_FAMILY_OPTIONS = React.useMemo(() => ([
    { value: 'compliance-policy', label: 'Compliance Policy' },
    { value: 'configuration-profile', label: 'Configuration Profile' },
    { value: 'settings-catalog', label: 'Settings Catalog' },
    { value: 'endpoint-security-antivirus', label: 'Endpoint Security - Antivirus' },
    { value: 'endpoint-security-firewall', label: 'Endpoint Security - Firewall' },
    { value: 'endpoint-security-disk-encryption', label: 'Endpoint Security - Disk Encryption' },
    { value: 'endpoint-security-asr', label: 'Endpoint Security - Attack Surface Reduction' },
    { value: 'windows-update-ring', label: 'Windows Update Ring' },
    { value: 'app-protection-policy', label: 'App Protection Policy' },
    { value: 'mobile-threat-defense-connector', label: 'Mobile Threat Defense Connector' },
    { value: 'identity-policy', label: 'Identity Policy' }
  ]), [])

  // Debugging aid: log when templates update so users can inspect browser console
  React.useEffect(() => {
    try {
      // eslint-disable-next-line no-console
      console.debug('ReferenceTemplates: templates changed', (referenceTemplates || []).length, 'owner=', selectedOwner)
    } catch (e) {}
  }, [referenceTemplates, selectedOwner])

  const familyIdOptions = React.useMemo(() => {
    const set = new Set()
    ;(referenceTemplates || []).forEach(t => {
      const meta = t && t.metadata ? t.metadata : {}
      const fid = meta.family_id || meta.familyId || meta.family || ''
      if (fid && String(fid).trim()) set.add(String(fid).trim())
    })
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [referenceTemplates])

  const familyDropdownOptions = React.useMemo(() => {
    const map = new Map()
    ;(DEFAULT_FAMILY_OPTIONS || []).forEach(o => {
      if (o && o.value) map.set(String(o.value), { value: String(o.value), label: String(o.label || o.value) })
    })
    ;(familyIdOptions || []).forEach(v => {
      const key = String(v)
      if (!map.has(key)) map.set(key, { value: key, label: key })
    })
    return Array.from(map.values()).sort((a, b) => String(a.label).localeCompare(String(b.label)))
  }, [DEFAULT_FAMILY_OPTIONS, familyIdOptions])

  const getFamilyLabel = (value) => {
    const found = (familyDropdownOptions || []).find(o => String(o.value) === String(value || ''))
    return found ? found.label : (value || '')
  }

  const policyTypeFromFamilyId = (familyId) => {
    if (!familyId || String(familyId).trim() === '') return ''
    const key = String(familyId).toLowerCase()
    const map = {
      'compliance-policy': 'Compliance Policy',
      'configuration-profile': 'Configuration Profile',
      'settings-catalog': 'Settings Catalog',
      'endpoint-security-antivirus': 'Endpoint Security Antivirus',
      'endpoint-security-firewall': 'Endpoint Security Firewall',
      'endpoint-security-disk-encryption': 'Endpoint Security Disk Encryption',
      'endpoint-security-asr': 'Endpoint Security Attack Surface Reduction',
      'windows-update-ring': 'Windows Update Ring',
      'app-protection-policy': 'App Protection Policy',
      'mobile-threat-defense-connector': 'Mobile Threat Defense Connector',
      'identity-policy': 'Identity Policy'
    }
    return map[key] || getFamilyLabel(familyId) || String(familyId)
  }

  const inferFamilyIdFromPayload = (payload, options = []) => {
    const optList = Array.isArray(options) ? options.filter(Boolean) : []
    if (optList.length === 0) return { familyId: '', score: 0 }

    const normalized = optList.map(o => {
      if (typeof o === 'string') return { value: o, label: o }
      return { value: String(o.value || ''), label: String(o.label || o.value || '') }
    }).filter(o => o.value)

    const templates = Array.isArray(payload) ? payload : [payload]

    for (const t of templates) {
      const meta = t && t.metadata ? t.metadata : {}
      const explicit = meta.family_id || meta.familyId || meta.family || ''
      if (explicit) {
        const exact = normalized.find(o => o.value.toLowerCase() === String(explicit).toLowerCase())
        if (exact) return { familyId: exact.value, score: 100 }
      }
    }

    const keywordHints = {
      compliance: ['compliance', 'devicecompliance', 'device compliance', 'compliance policy'],
      configuration: ['configuration profile', 'configurationprofiles', 'deviceconfiguration', 'settings catalog', 'settingscatalog'],
      defender: ['defender', 'antivirus', 'asr', 'attack surface reduction', 'endpoint security'],
      bitlocker: ['bitlocker', 'disk encryption', 'encryption'],
      firewall: ['firewall'],
      update: ['update ring', 'windows update', 'quality update', 'feature update'],
      identity: ['identity', 'entra', 'azure ad', 'conditional access'],
      authentication: ['authentication', 'mfa', 'multifactor'],
      teams: ['teams'],
      exchange: ['exchange', 'mail flow', 'mailbox', 'transport rule'],
      sharepoint: ['sharepoint']
    }

    const blobs = templates.map(t => {
      const meta = t && t.metadata ? t.metadata : {}
      const watched = Array.isArray(t && t.watched_keys) ? t.watched_keys.map(w => `${w.path || ''} ${w.label || ''}`).join(' ') : ''
      const settings = Array.isArray(t && t.settings)
        ? t.settings.slice(0, 40).map(s => `${s.name || ''} ${s.title || ''} ${s.control_id || ''}`).join(' ')
        : ''
      return [
        t && t.id,
        t && t.name,
        t && t.display_name,
        t && t.template_id,
        t && t.area_key,
        t && t.policy_type,
        t && t.profile_type,
        meta.policy_type,
        meta.policy_type_normalized,
        meta.category,
        meta.source,
        watched,
        settings
      ].filter(Boolean).join(' ').toLowerCase()
    })
    const text = blobs.join(' ')

    let best = ''
    let bestScore = 0
    for (const option of normalized) {
      const o = String(option.value)
      const label = String(option.label || option.value)
      const ol = o.toLowerCase()
      const ll = label.toLowerCase()
      let score = 0

      if (text.includes(ol)) score += 60
      if (text.includes(ll)) score += 40

      const tokens = ol.split(/[^a-z0-9]+/).filter(tok => tok.length >= 4)
      tokens.forEach(tok => {
        if (text.includes(tok)) score += 6
      })
      ll.split(/[^a-z0-9]+/).filter(tok => tok.length >= 4).forEach(tok => {
        if (text.includes(tok)) score += 5
      })

      Object.entries(keywordHints).forEach(([key, hints]) => {
        if (!ol.includes(key) && !ll.includes(key)) return
        hints.forEach(h => {
          if (text.includes(h)) score += 8
        })
      })

      if (score > bestScore) {
        bestScore = score
        best = o
      }
    }

    return { familyId: bestScore > 0 ? best : '', score: bestScore }
  }

  const renderTemplatesList = () => {
    if (!displayTemplates || displayTemplates.length === 0) return (<div className="text-gray-400">No templates available. Try changing the owner filter or refresh the page.</div>)
    return (
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-white">Templates</h3>
          <div className="text-xs text-gray-400">{displayTemplates.length} items</div>
        </div>

        <div className="space-y-3">
          {(displayTemplates || []).map(tpl => (
            <div key={tpl.id} className={`border rounded-xl overflow-hidden`}>
              <div className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.02] transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-white text-sm truncate">{tpl.name}</span>
                  </div>
                  {(tpl && tpl.metadata && (tpl.metadata.family_id || tpl.metadata.family || tpl.metadata.familyId)) && (
                    <div className="mt-1 text-xs text-gray-400">Family: {(tpl.metadata.family_id || tpl.metadata.family || tpl.metadata.familyId)}</div>
                  )}
                  <div>
                    {tpl.metadata && tpl.metadata.owner && tpl.metadata.owner !== 'community' && (
                      String(tpl.metadata.owner).toLowerCase() === 'openintune' ? (
                        <a href="https://openintunebaseline.com" target="_blank" rel="noopener noreferrer" className="text-xs text-gray-400 hover:text-white">{tpl.metadata.owner_display || tpl.metadata.owner}</a>
                      ) : (
                        <span className="text-xs text-gray-400">{tpl.metadata.owner_display || tpl.metadata.owner}</span>
                      )
                    )}
                  </div>
                  {tpl.required_licenses && tpl.required_licenses.length > 0 && (
                    <div className="mt-2 flex gap-2 flex-wrap">
                      {tpl.required_licenses.map(r => <span key={r} className="text-xs px-2 py-0.5 rounded border border-gray-700 text-gray-300">{r}</span>)}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button onClick={() => openDetail(tpl)} className="btn-secondary text-xs">View</button>
                  <button onClick={() => openCompare(tpl)} disabled={!compareTenant} className="btn-primary text-xs disabled:opacity-50 disabled:cursor-not-allowed" title={!compareTenant ? 'Select a tenant first' : 'Compare this template'}>Compare</button>
                  {canDeleteImportedTemplate(tpl) && (
                    <button
                      onClick={async () => {
                        if (!window.confirm(`Delete imported template ${tpl.name || tpl.id}? This cannot be undone.`)) return
                        setDeletingTemplateId(tpl.id)
                        try {
                          await referenceApi.remove(tpl.id)
                          showToast && showToast('Imported template deleted', 'success')
                          const owner = selectedOwner === 'all' ? undefined : selectedOwner
                          const [list, ownerList] = await Promise.all([referenceApi.list(owner), referenceApi.owners()])
                          setReferenceTemplates(filterReferenceTemplates(list))
                          const arr = filterOwners(ownerList)
                          if (!arr.find(o => o.key === 'openintune')) arr.push({ key: 'openintune', display: 'OpenIntuneBaseline' })
                          if (!arr.find(o => o.key === 'custom')) arr.push({ key: 'custom', display: 'Custom' })
                          setOwners([{ key: 'all', display: 'All' }, ...arr])
                        } catch (err) {
                          showToast && showToast('Failed to delete template', 'error')
                        } finally {
                          setDeletingTemplateId(null)
                        }
                      }}
                      disabled={deletingTemplateId === tpl.id}
                      className="btn-secondary text-xs disabled:opacity-50"
                      title="Delete imported template"
                    >
                      {deletingTemplateId === tpl.id ? 'Deleting…' : 'Delete'}
                    </button>
                  )}
                  {tpl.source_url && <a className="text-xs text-gray-400 hover:text-white flex items-center gap-1" href={tpl.source_url} target="_blank" rel="noreferrer"><ExternalLink size={12}/> Source</a>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // Compare results helpers
  const normalizeCompareStatus = (status) => {
    const s = String(status || '').toLowerCase()
    if (s === 'matched') return 'matched'
    if (s === 'partial') return 'noMatch'
    if (s === 'nomatch' || s === 'no_match' || s === 'no-match') return 'noMatch'
    return 'other'
  }

  const compareItems = Array.isArray(compareResults && compareResults.items) ? compareResults.items : []
  const compactJson = (value) => {
    try {
      const text = typeof value === 'string' ? value : JSON.stringify(value)
      if (!text) return 'null'
      return text.length > 120 ? `${text.slice(0, 117)}...` : text
    } catch {
      return String(value)
    }
  }

  const formatComparisonReason = (reason) => {
    const key = String(reason || '').toLowerCase()
    if (key === 'match') return 'Semantically matched'
    if (key === 'valuemismatch') return 'Value mismatch'
    if (key === 'missingsetting') return 'Setting not present in counterpart policy'
    if (key === 'extraincollector') return 'Present in counterpart policy only'
    return null
  }

  const getPrimaryMismatch = (item) => {
    const list = Array.isArray(item && item.mismatches) ? item.mismatches : []
    return list.find(m => m && (m.expected !== undefined || m.actual !== undefined)) || null
  }

  const getPrimaryMatchedPath = (item) => {
    const candidates = []
    if (Array.isArray(item && item.matchedSamples)) candidates.push(...item.matchedSamples)
    if (Array.isArray(item && item.matchAll)) candidates.push(...item.matchAll)
    if (Array.isArray(item && item.matchAny)) candidates.push(...item.matchAny)
    for (const c of candidates) {
      if (Array.isArray(c && c.matchedPaths) && c.matchedPaths.length > 0) {
        return {
          policyName: c.displayName || c.id || null,
          path: c.matchedPaths[0]
        }
      }
    }
    return null
  }

  const filteredCompareItems = compareItems.filter(it => {
    const status = normalizeCompareStatus(it && it.status)
    if (compareStatusFilter !== 'all' && status !== compareStatusFilter) return false
    const q = String(compareSearch || '').trim().toLowerCase()
    if (!q) return true
    const hay = [it && it.refDisplayName, it && it.refId, it && it.note].filter(Boolean).join(' ').toLowerCase()
    return hay.includes(q)
  })

  const noCompareItems = compareResults && (!compareResults.items || (Array.isArray(compareResults.items) && compareResults.items.length === 0))
  const compareNote = compareResults && compareResults.note

  const getSummaryMetricTooltip = (metric) => {
    const key = String(metric || '').toLowerCase()
    if (key === 'total') return 'Total settings evaluated in this compare scope. This should equal Matched + No match.'
    if (key === 'matched') return 'Settings where expected and actual align semantically after normalization.'
    if (key === 'nomatch') return 'Settings from the template that were not found in the selected counterpart policy.'
    if (key === 'extra') return 'Additional settings found in the counterpart policy that are not defined in the selected template.'
    return ''
  }

  // animate saving progress
  React.useEffect(() => {
    let t = null
    if (savingFamily) {
      setSavingFamilyProgress(5)
      t = setInterval(() => setSavingFamilyProgress(p => Math.min(95, p + Math.floor(Math.random() * 12) + 3)), 300)
    } else {
      if (savingFamilyProgress > 0 && savingFamilyProgress < 100) setSavingFamilyProgress(100)
      const reset = setTimeout(() => setSavingFamilyProgress(0), 700)
      return () => clearTimeout(reset)
    }
    return () => { if (t) clearInterval(t) }
  }, [savingFamily])

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <FileText size={20} className="text-brand-500"/> Intune Reference Templates
          </h1>
          <p className="text-gray-500 text-sm mt-1">Intune-focused, read-only configuration reference sets for comparison and import workflows.</p>
        </div>
      </div>

      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Tenant to Compare</h2>
          <span className="text-xs text-gray-400">Select tenant first, then choose template</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {(tenants || []).map(t => (
            <label key={t.id} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${compareTenant && compareTenant.id === t.id ? 'border-brand-500 bg-brand-500/10' : 'border-gray-800 hover:border-gray-700'}`}>
              <input
                className="accent-indigo-500"
                name="reference-tenant-select"
                type="radio"
                checked={compareTenant ? compareTenant.id === t.id : false}
                onChange={() => {
                  setCompareTenant(t)
                  setCompareResults(null)
                  setCompareRegressionResult(null)
                  setCompareMultiResults(null)
                }}
              />
              <div className="min-w-0">
                <div className="text-sm text-white font-medium truncate">{t.display_name || t.tenant_id || t.id}</div>
              </div>
            </label>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <select value={selectedOwner} onChange={e => setSelectedOwner(e.target.value)}
          className="bg-gray-800 border border-gray-700 text-sm text-white px-3 py-2 rounded-lg">
          {(owners || []).map(o => <option key={o.key} value={o.key}>{o.display || o.name || o.key}</option>)}
        </select>

        <div>
          <button onClick={() => fileInputRef.current && fileInputRef.current.click()} className="btn-secondary text-xs">Import JSON</button>
          <input ref={fileInputRef} type="file" accept=".json,application/json" onChange={async (e) => {
            const f = e.target.files && e.target.files[0];
            if (!f) return;
            setImportFileName(f.name || 'file.json');
            try {
              const txt = await f.text();
              let parsed;
              try {
                parsed = JSON.parse(txt);
              } catch (parseErr) {
                showToast && showToast('Failed to read or parse JSON file', 'error');
                // reset input so selecting same file again triggers change
                e.target.value = '';
                return;
              }
              if (parsed === null) {
                showToast && showToast('Imported JSON is null or empty', 'error');
                e.target.value = '';
                return;
              }
              const validation = validateImportJson(parsed)
              if (!validation.ok) {
                showToast && showToast(validation.errors[0] || 'Imported JSON failed validation', 'error')
                e.target.value = ''
                return
              }
              const inferred = inferFamilyIdFromPayload(parsed, familyDropdownOptions)
              const inferredFamily = inferred && inferred.familyId ? inferred.familyId : ''
              const inferredScore = inferred && typeof inferred.score === 'number' ? inferred.score : 0
              const inferredConfidence = inferredScore >= 65 ? 'high' : (inferredScore >= 30 ? 'medium' : '')
              setImportPreview(parsed);
              setImportFamilyDetected(inferredFamily || '')
              setImportFamilyConfidence(inferredConfidence)
              setImportFamilyId(inferredFamily || '')
              setImportFamilyCustom('')
              setImportModalOpen(true);
            } catch (err) {
              showToast && showToast('Failed to read or parse JSON file', 'error');
            } finally {
              e.target.value = '';
            }
          }} className="hidden" />
        </div>

        {/* Owners filter shown above — templates are grouped by owner below */}
      </div>

      <div className="space-y-6">
        {renderTemplatesList()}
      </div>

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setDetail(null)}></div>
          <div className="relative w-11/12 max-w-4xl bg-gray-900 border border-gray-800 rounded-lg p-4 text-sm">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-semibold text-white">Template details</h3>
                {(() => {
                  const currentFamily = detail && detail.metadata ? (detail.metadata.family_id || detail.metadata.family || detail.metadata.familyId || '') : ''
                  if (editingFamilyId !== null) {
                    return (
                      <div className="flex items-center gap-2 mt-1">
                        <input value={editingFamilyId} onChange={e => setEditingFamilyId(e.target.value)} placeholder="metadata.family_id (e.g. defender-av)" className="text-xs bg-gray-800 border border-gray-700 px-2 py-1 rounded" />
                        <button onClick={saveTemplateFamily} disabled={savingFamily} className="btn-primary text-xs">{savingFamily ? 'Saving…' : 'Save'}</button>
                        <button onClick={() => setEditingFamilyId(null)} disabled={savingFamily} className="btn-secondary text-xs">Cancel</button>
                        {savingFamily && <div className="w-24 ml-2 bg-gray-800 rounded h-2 overflow-hidden"><div className="bg-brand-500 h-2" style={{ width: `${savingFamilyProgress}%` }} /></div>}
                      </div>
                    )
                  }
                  return (
                    <div className="mt-1 text-xs text-gray-400 flex items-center gap-2">
                      <div>{currentFamily ? `Family: ${currentFamily}` : 'Family: (none)'}</div>
                      <button onClick={() => setEditingFamilyId(currentFamily || '')} className="text-xs text-gray-400 hover:text-white">Edit</button>
                    </div>
                  )
                })()}
              </div>
              <button onClick={() => setDetail(null)} className="text-gray-400 hover:text-white">Close</button>
            </div>
            {(() => {
              const safe = { ...detail }
              if (safe && Object.prototype.hasOwnProperty.call(safe, 'name')) delete safe.name
              return <pre className="text-xs text-gray-300 overflow-auto max-h-[60vh] bg-black/20 p-3 rounded">{JSON.stringify(safe, null, 2)}</pre>
            })()}
          </div>
        </div>
      )}

      {importModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => { setImportModalOpen(false); setImportPreview(null); setImportFamilyId(''); setImportFamilyCustom(''); setImportFamilyDetected(''); setImportFamilyConfidence('') }}></div>
          <div className="relative w-11/12 max-w-3xl bg-gray-900 border border-gray-800 rounded-lg p-4 text-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-white">Import preview: {importFileName}</h3>
              <button onClick={() => { setImportModalOpen(false); setImportPreview(null); setImportFamilyId(''); setImportFamilyCustom(''); setImportFamilyDetected(''); setImportFamilyConfidence('') }} className="text-gray-400 hover:text-white">Close</button>
            </div>

            <div className="mb-3 text-xs text-gray-300">Import target is always Global and existing templates with the same id are always overwritten.</div>

            <div className="mb-2 flex items-center gap-3">
              <label className="text-xs text-gray-300">Family ID (optional):</label>
              <select value={importFamilyId} onChange={e => setImportFamilyId(e.target.value)} className="text-xs bg-gray-800 border border-gray-700 px-2 py-1 rounded w-full">
                <option value="">None</option>
                {(familyDropdownOptions || []).map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                <option value={CUSTOM_FAMILY}>Custom...</option>
              </select>
            </div>
            {importFamilyDetected && importFamilyId && importFamilyId !== CUSTOM_FAMILY && (
              <div className="mb-2 text-xs text-emerald-300 flex items-center gap-2">
                <span>Detected from JSON: {getFamilyLabel(importFamilyDetected)}</span>
                {importFamilyConfidence && (
                  <span className={`px-1.5 py-0.5 rounded border ${importFamilyConfidence === 'high' ? 'border-emerald-500/60 text-emerald-300' : 'border-amber-500/60 text-amber-300'}`}>
                    {importFamilyConfidence === 'high' ? 'High' : 'Medium'} confidence
                  </span>
                )}
              </div>
            )}
            {importFamilyId === CUSTOM_FAMILY && (
              <div className="mb-2 flex items-center gap-3">
                <label className="text-xs text-gray-300">Custom Family ID:</label>
                <input value={importFamilyCustom} onChange={e => setImportFamilyCustom(e.target.value)} placeholder="metadata.family_id (e.g. defender-av)" className="text-xs bg-gray-800 border border-gray-700 px-2 py-1 rounded w-full" />
              </div>
            )}

            {importLoading && (
              <div className="mb-3">
                <div className="text-xs text-gray-300 mb-1">Importing…</div>
                <div className="w-full bg-gray-800 rounded h-2 overflow-hidden">
                  <div className="bg-brand-500 h-2 transition-all" style={{ width: `${importProgress}%` }} />
                </div>
              </div>
            )}

            <div className="mb-3">
              <pre className="text-xs text-gray-300 overflow-auto max-h-[50vh] bg-black/20 p-3 rounded">{importPreview ? JSON.stringify(importPreview, null, 2) : 'No preview available'}</pre>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button onClick={() => { setImportModalOpen(false); setImportPreview(null); setImportFamilyId(''); setImportFamilyCustom(''); setImportFamilyDetected(''); setImportFamilyConfidence('') }} className="btn-secondary text-xs">Cancel</button>
              <button onClick={async () => {
                if (!importPreview) return;
                  const selectedFamilyId = importFamilyId === CUSTOM_FAMILY ? String(importFamilyCustom || '').trim() : String(importFamilyId || '').trim()
                  const selectedPolicyType = policyTypeFromFamilyId(selectedFamilyId)
                  // validate optional family id before importing
                  const vfid = validateFamilyId(selectedFamilyId)
                  if (!vfid.ok) { showToast && showToast(vfid.error || 'Invalid family id', 'error'); return }
                  setImportLoading(true);
                  try {
                      // start animated progress
                      setImportProgress(5);
                      // attach family_id to metadata for single templates or arrays
                      let toImport = importPreview
                      if (Array.isArray(importPreview)) {
                        toImport = importPreview.map(t => ({
                          ...(t || {}),
                          ...(selectedPolicyType ? { policy_type: selectedPolicyType } : {}),
                          metadata: {
                            ...((t && t.metadata) || {}),
                            ...(selectedFamilyId ? { family_id: selectedFamilyId } : {}),
                            ...(selectedPolicyType ? { policy_type: selectedPolicyType, policy_type_normalized: selectedPolicyType } : {})
                          }
                        }))
                      } else if (importPreview && typeof importPreview === 'object') {
                        toImport = {
                          ...importPreview,
                          ...(selectedPolicyType ? { policy_type: selectedPolicyType } : {}),
                          metadata: {
                            ...(importPreview.metadata || {}),
                            ...(selectedFamilyId ? { family_id: selectedFamilyId } : {}),
                            ...(selectedPolicyType ? { policy_type: selectedPolicyType, policy_type_normalized: selectedPolicyType } : {})
                          }
                        }
                      }
                      const importValidation = validateImportJson(toImport)
                      if (!importValidation.ok) {
                        showToast && showToast(importValidation.errors[0] || 'Import payload failed validation', 'error')
                        return
                      }
                      const res = await referenceApi.import(toImport, { overwrite: true });
                      setImportPreflightById({})
                      setImportPreflightLoadingById({})
                      setImportResult(res);
                      preloadImportResultPreflight(res).catch(() => {})
                      setImportPreview(null);
                      setImportFamilyId('')
                      setImportFamilyCustom('')
                      setImportFamilyDetected('')
                      setImportFamilyConfidence('')
                      // mark progress complete briefly
                      setImportProgress(100);
                      showToast && showToast('Import complete', 'success');
                    // refresh template list and owners for current owner
                    const owner = selectedOwner === 'all' ? undefined : selectedOwner;
                    Promise.allSettled([referenceApi.list(owner), referenceApi.owners()]).then(results => {
                      const listRes = results[0]
                      const ownersRes = results[1]
                      if (listRes.status === 'fulfilled') setReferenceTemplates(filterReferenceTemplates(listRes.value))
                      if (ownersRes.status === 'fulfilled') {
                        const arr = filterOwners(ownersRes.value)
                        if (!arr.find(o => o.key === 'openintune')) arr.push({ key: 'openintune', display: 'OpenIntuneBaseline' })
                        if (!arr.find(o => o.key === 'custom')) arr.push({ key: 'custom', display: 'Custom' })
                        setOwners([{ key: 'all', display: 'All' }, ...arr])
                      }
                    }).catch(() => {})
                  } catch (err) {
                    showToast && showToast('Import failed', 'error');
                  } finally {
                    setImportLoading(false);
                    // reset progress after short delay so UI shows completion briefly
                    setTimeout(() => setImportProgress(0), 700);
                  }
              }} disabled={importLoading} className="btn-primary text-xs">{importLoading ? 'Importing…' : 'Import'}</button>
            </div>
          </div>
        </div>
      )}
      {importResult && (
        <div className="fixed bottom-4 right-4 z-50 w-96">
          <div className="bg-gray-900 border border-gray-800 p-3 rounded-lg text-sm">
            <div className="flex items-center justify-between mb-2">
              <div className="font-medium text-white">Import result</div>
              <div className="text-xs text-gray-400">{importResult.imported ? `${importResult.imported.length} file(s)` : ''}</div>
            </div>
            <div className="max-h-48 overflow-auto text-xs text-gray-300 mb-2">
              {(importResult.imported || []).map((f, idx) => (
                <div key={idx} className="py-1 border-b border-gray-800/70 last:border-b-0">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                    <div className={`text-sm ${f.skipped ? 'text-gray-500' : 'text-white'}`}>{f.file || (f.id ? `${f.id}.json` : '')}</div>
                    </div>
                    {!f.skipped && (
                      <div className="flex items-center gap-2">
                        <button onClick={async () => {
                          setImportCompareInProgress(f.id || (f.file ? f.file.replace(/\.json$/i, '') : ''));
                          try {
                            const id = getImportedEntryId(f)
                            // Best-effort: ensure registry is reloaded then fetch template
                            try { await referenceApi.reload(); } catch (_) {}
                            const tpl = await referenceApi.get(id);
                            setImportModalOpen(false);
                            setImportResult(null);
                            setImportPreflightById({})
                            setImportPreflightLoadingById({})
                            setCompareTpl(tpl);
                            setCompareTenant((compareTenant) || ((tenants && tenants[0]) || null));
                          } catch (err) {
                            showToast && showToast('Failed to load imported template for compare', 'error');
                          } finally {
                            setImportCompareInProgress(null);
                          }
                        }} className="btn-secondary text-xs">{importCompareInProgress === (f.file || f.id) ? 'Loading…' : 'Compare'}</button>

                      </div>
                    )}
                  </div>

                  {(() => {
                    const rowId = getImportedEntryId(f)
                    const pf = rowId ? importPreflightById[rowId] : null
                    const pfLoading = Boolean(rowId && importPreflightLoadingById[rowId])
                    const importFailed = Boolean(f && f.error)
                    const mappingErr = Array.isArray(f && f.mappingErrors) ? f.mappingErrors : []
                    if (f.skipped) return null
                    return (
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                        {importFailed ? (
                          <span className="px-1.5 py-0.5 rounded border border-red-800 text-red-300 bg-red-950/20">Import failed</span>
                        ) : pfLoading ? (
                          <span className="px-1.5 py-0.5 rounded border border-gray-700 text-gray-300">Preflight checking…</span>
                        ) : pf ? (
                          <>
                            <span className={`px-1.5 py-0.5 rounded border ${pf.ok ? 'border-green-800 text-green-300 bg-green-950/20' : 'border-amber-800 text-amber-300 bg-amber-950/20'}`}>{pf.ok ? 'Preflight pass' : 'Preflight issues'}</span>
                            <span className="px-1.5 py-0.5 rounded border border-gray-700 text-gray-300">Resolved {Number(pf?.preflight?.requiredMappingsResolved || 0)}/{Number(pf?.preflight?.requiredMappingsTotal || 0)}</span>
                            <span className="px-1.5 py-0.5 rounded border border-gray-700 text-gray-300">{Number(pf?.preflight?.requiredMappingsResolvedPct || 0)}%</span>
                            <span className="px-1.5 py-0.5 rounded border border-gray-700 text-gray-300">Snapshot {pf.hasSnapshot ? 'yes' : 'no'}</span>
                          </>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded border border-gray-700 text-gray-300">Preflight unavailable</span>
                        )}
                        {importFailed && mappingErr.length > 0 && (
                          <span className="text-red-300">{mappingErr[0]}</span>
                        )}
                      </div>
                    )
                  })()}
                </div>
              ))}
            </div>
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => { setImportResult(null); setImportPreflightById({}); setImportPreflightLoadingById({}) }} className="btn-secondary text-xs">Dismiss</button>
            </div>
          </div>
        </div>
      )}

      {compareTpl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={closeCompareModal}></div>
          <div className="relative w-11/12 max-w-4xl bg-gray-900 border border-gray-800 rounded-lg p-4 text-sm">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-semibold text-white">Compare: {compareTpl.name || compareTpl.displayName || compareTpl.id}</h3>
                <span className="text-[11px] px-2 py-0.5 rounded border border-gray-700 text-gray-300 bg-gray-800/60">
                  Policy scope: {(comparePolicyType && String(comparePolicyType).trim()) ? comparePolicyType : 'Auto / any'}
                </span>
              </div>
              <button onClick={closeCompareModal} className="text-gray-400 hover:text-white">Close</button>
            </div>

            <div className="mb-3 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex items-center gap-3">
                <div className="text-xs text-gray-300">Tenant: <span className="text-white">{(compareTenant && (compareTenant.display_name || compareTenant.tenant_id || compareTenant.id)) || 'Not selected'}</span></div>
                <label className="text-xs text-gray-300">Policy type:</label>
                <select
                  value={comparePolicyType || ''}
                  onChange={e => { setComparePolicyType(e.target.value); setCompareResults(null); setCompareRegressionResult(null) }}
                  className="bg-gray-800 border border-gray-700 text-sm text-white px-3 py-2 rounded-lg"
                >
                  <option value="">Auto / any</option>
                  {(comparePolicyTypeOptions || []).map(v => <option key={v} value={v}>{v}</option>)}
                </select>
                <button
                  onClick={runCompare}
                  disabled={isComparing || !compareTenant || (isCustomTemplate(compareTpl) && blockCompareOnPreflightFail && mappingPreflight && mappingPreflight.ok === false)}
                  className="btn-primary text-xs"
                >
                  {isComparing ? 'Comparing…' : 'Run Compare'}
                </button>
              </div>

              <div className="flex items-center gap-3">
                <label className="text-xs text-gray-300 flex items-center gap-2">
                  <input type="checkbox" checked={compareUseFreshPull} onChange={e => { setCompareUseFreshPull(e.target.checked); setCompareResults(null); setCompareRegressionResult(null) }} />
                  <span>Fresh pull from collector (otherwise use latest snapshot)</span>
                </label>
              </div>
            </div>

            {isCustomTemplate(compareTpl) && (
              <div className="mb-3 rounded-lg border border-gray-700 bg-gray-800/40 p-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="text-xs text-gray-200 font-medium">Custom mapping preflight</div>
                  <button onClick={() => runMappingPreflight({ notify: true })} disabled={mappingPreflightLoading} className="btn-secondary text-xs">
                    {mappingPreflightLoading ? 'Checking…' : 'Run preflight'}
                  </button>
                </div>
                <div className="mt-2 text-xs text-gray-400">Checks mapping contract shape, required mapping resolution, and snapshot compatibility before compare.</div>

                {mappingPreflightError && (
                  <div className="mt-2 text-xs text-red-300 bg-red-950/20 border border-red-900/40 rounded px-2 py-1">{mappingPreflightError}</div>
                )}

                {mappingPreflight && (
                  <div className="mt-2 space-y-2">
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span className={`px-1.5 py-0.5 rounded border ${mappingPreflight.ok ? 'border-green-800 text-green-300 bg-green-950/20' : 'border-amber-800 text-amber-300 bg-amber-950/20'}`}>
                        {mappingPreflight.ok ? 'Preflight pass' : 'Preflight issues'}
                      </span>
                      <span className="px-1.5 py-0.5 rounded border border-gray-700 text-gray-300">Snapshot: {mappingPreflight.hasSnapshot ? 'Available' : 'Not found'}</span>
                      <span className="px-1.5 py-0.5 rounded border border-gray-700 text-gray-300">Required mappings: {Number(mappingPreflight?.preflight?.requiredMappingsResolved || 0)}/{Number(mappingPreflight?.preflight?.requiredMappingsTotal || 0)}</span>
                      <span className="px-1.5 py-0.5 rounded border border-gray-700 text-gray-300">Resolved: {Number(mappingPreflight?.preflight?.requiredMappingsResolvedPct || 0)}%</span>
                      <span className="px-1.5 py-0.5 rounded border border-gray-700 text-gray-300">Mode: {String(mappingPreflight?.preflight?.enforcementMode || 'warn')}</span>
                    </div>

                    {(Array.isArray(mappingPreflight?.validation?.errors) && mappingPreflight.validation.errors.length > 0) && (
                      <div className="text-xs text-red-300 bg-red-950/20 border border-red-900/40 rounded px-2 py-1">
                        Validation: {mappingPreflight.validation.errors[0]}
                      </div>
                    )}

                    {(Array.isArray(mappingPreflight?.preflight?.failedChecks) && mappingPreflight.preflight.failedChecks.length > 0) && (
                      <div className="text-xs text-amber-300 bg-amber-950/20 border border-amber-900/40 rounded px-2 py-1">
                        Failed checks: {mappingPreflight.preflight.failedChecks.join(', ')}
                      </div>
                    )}

                    {(Array.isArray(mappingPreflight?.preflight?.unresolvedMappings) && mappingPreflight.preflight.unresolvedMappings.length > 0) && (
                      <div className="text-xs text-gray-300 bg-black/20 border border-gray-700 rounded px-2 py-1">
                        Unresolved mappings: {mappingPreflight.preflight.unresolvedMappings.length}
                      </div>
                    )}

                    <label className="text-xs text-gray-300 flex items-center gap-2">
                      <input type="checkbox" checked={blockCompareOnPreflightFail} onChange={e => setBlockCompareOnPreflightFail(e.target.checked)} />
                      <span>Block compare when preflight reports issues</span>
                    </label>
                  </div>
                )}
              </div>
            )}

            {compareResults && (
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                  <input
                    value={compareSearch}
                    onChange={e => setCompareSearch(e.target.value)}
                    placeholder="Search setting name/id"
                    className="bg-gray-800 border border-gray-700 text-sm text-white px-3 py-2 rounded-lg sm:w-72"
                  />
                  <select
                    value={compareStatusFilter}
                    onChange={e => setCompareStatusFilter(e.target.value)}
                    className="bg-gray-800 border border-gray-700 text-sm text-white px-3 py-2 rounded-lg"
                  >
                    <option value="all">All outcomes</option>
                    <option value="matched">Matched</option>
                    <option value="noMatch">No match</option>
                    <option value="other">Other</option>
                  </select>
                  <div className="text-xs text-gray-400">Showing {filteredCompareItems.length} of {compareItems.length} settings</div>
                </div>

                {/* Compact compare list with slide-over side drawer for details */}
                <div className="mt-3">
                  <div className="text-sm font-semibold text-white mb-2">Compare results</div>
                  {(filteredCompareItems && filteredCompareItems.length > 0) ? (
                    <div className="space-y-2">
                      {filteredCompareItems.map(it => {
                        const policies = Array.isArray(it && it.counterpartPolicies) ? it.counterpartPolicies : []
                        const defaultPolicy = (it && it.defaultPolicyId)
                          ? (policies.find(p => p && p.id === it.defaultPolicyId) || null)
                          : (policies[0] || null)
                        const primaryPolicyName = defaultPolicy ? (defaultPolicy.displayName || defaultPolicy.id) : null
                        const alternatePolicyNames = policies
                          .map(p => p && (p.displayName || p.id))
                          .filter(Boolean)
                          .filter(name => !primaryPolicyName || name !== primaryPolicyName)
                        const fallbackPolicyNames = Array.isArray(it && it.presentInPolicies) ? it.presentInPolicies.filter(Boolean) : []
                        const policyNames = policies.length > 0 ? policies.map(p => p && (p.displayName || p.id)).filter(Boolean) : fallbackPolicyNames
                        const policyCount = policyNames.length > 0
                          ? policyNames.length
                          : (typeof it?.matchAnyCount === 'number'
                              ? it.matchAnyCount
                              : (Array.isArray(it?.matchAll) ? it.matchAll.length : 0))
                        const itemSummary = it && it.settingSummary ? it.settingSummary : null
                        const primaryMismatch = getPrimaryMismatch(it)
                        const primaryMatch = getPrimaryMatchedPath(it)
                        return (
                          <div key={it.refId} className={`rounded-lg border px-3 py-2 text-sm flex items-start justify-between gap-3 ${it.status === 'matched' ? 'border-green-800' : 'border-red-800'}`}>
                            <div className="flex items-start gap-3 min-w-0">
                              <ResultBadge result={{ status: it.status, pass: it.status === 'matched' ? true : it.status === 'noMatch' ? false : null }} />
                              <div className="ml-2 min-w-0">
                                <div className="font-medium text-white break-words">{it.refDisplayName || it.refId}</div>
                                {it.note && <div className="text-xs text-gray-400">{it.note.length > 140 ? it.note.slice(0,140) + '…' : it.note}</div>}
                                {itemSummary && (
                                  <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
                                    <span className="px-1.5 py-0.5 rounded border border-gray-700 text-gray-300" title={getSummaryMetricTooltip('total')}>Total {Number(itemSummary.totalSettings || 0)}</span>
                                    <span className="px-1.5 py-0.5 rounded border border-green-800 text-green-300 bg-green-950/20" title={getSummaryMetricTooltip('matched')}>Matched {Number(itemSummary.matchedSettings || 0)}</span>
                                    <span className="px-1.5 py-0.5 rounded border border-red-800 text-red-300 bg-red-950/20" title={getSummaryMetricTooltip('nomatch')}>No match {Number(itemSummary.noMatchSettings || 0)}</span>
                                    <span className="px-1.5 py-0.5 rounded border border-gray-700 text-gray-300" title={getSummaryMetricTooltip('extra')}>Extra {Number(itemSummary.extraSettings || 0)}</span>
                                  </div>
                                )}
                                <div className="text-xs text-gray-500 mt-1">Policies evaluated: {policyCount}</div>
                                <div className="text-xs text-gray-500">Compared policy: <span className="text-gray-300">{primaryPolicyName || 'No counterpart policy identified'}</span></div>
                                {alternatePolicyNames.length > 0 && (
                                  <div className="text-xs text-gray-500">
                                    Also in: <span className="text-gray-300">{alternatePolicyNames.slice(0, 2).join(', ')}</span>
                                    {alternatePolicyNames.length > 2 ? <span className="text-gray-400"> (+{alternatePolicyNames.length - 2} more)</span> : null}
                                  </div>
                                )}
                                {primaryMismatch && (
                                  <div className="mt-1 text-xs text-red-300 bg-red-950/20 border border-red-900/40 rounded px-2 py-1">
                                    <div className="text-red-200 break-all">{primaryMismatch.path || 'value mismatch'}</div>
                                    <div>Expected: <span className="text-white break-all">{compactJson(primaryMismatch.expected)}</span></div>
                                    <div>Actual: <span className="text-white break-all">{compactJson(primaryMismatch.actual)}</span></div>
                                  </div>
                                )}
                                {!primaryMismatch && primaryMatch && primaryMatch.path && (
                                  <div className="mt-1 text-xs text-green-300 bg-green-950/20 border border-green-900/40 rounded px-2 py-1">
                                    <div className="text-green-200 break-all">{primaryMatch.path.path || 'matched path'}{primaryMatch.policyName ? ` in ${primaryMatch.policyName}` : ''}</div>
                                    <div>Expected: <span className="text-white break-all">{compactJson(primaryMatch.path.expected)}</span></div>
                                    <div>Actual: <span className="text-white break-all">{compactJson(primaryMatch.path.actual)}</span></div>
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <button onClick={() => { setDrawerItem(it); setDrawerPolicyId(it.defaultPolicyId || null); setDrawerOpen(true) }} className="text-xs btn-secondary">Details</button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <>
                      <div className="text-xs text-gray-500">No compare items available.</div>
                    </>
                  )}

                  {/* Side drawer overlay (right) */}
                  {drawerOpen && drawerItem && (
                    <div className="fixed inset-0 z-60">
                      <div className="absolute inset-0 bg-black/60" onClick={() => { setDrawerOpen(false); setDrawerItem(null) }}></div>
                      <div className="absolute right-0 top-0 h-full w-full xl:w-[60vw] 2xl:w-[52vw] xl:max-w-[1100px] bg-gray-900 border-l border-gray-800 p-4 overflow-auto shadow-2xl">
                        <div className="flex items-start justify-between gap-3 mb-3 sticky top-0 bg-gray-900 pb-2 border-b border-gray-800 z-10">
                          <h4 className="font-semibold text-white break-words max-w-[85%]">{drawerItem.refDisplayName || drawerItem.refId}{drawerItem && drawerItem._tenantId ? ` (${((tenants || []).find(t => t.id === drawerItem._tenantId) || {}).display_name || drawerItem._tenantId})` : ''}</h4>
                          <button onClick={() => { setDrawerOpen(false); setDrawerItem(null) }} className="text-gray-400 hover:text-white shrink-0">Close</button>
                        </div>
                        {drawerItem.note && <div className="text-xs text-gray-400 mb-2 whitespace-pre-wrap">{drawerItem.note}</div>}

                        {(() => {
                          const preview = getPrimaryMismatch(drawerItem) || (getPrimaryMatchedPath(drawerItem) && getPrimaryMatchedPath(drawerItem).path)
                          if (!preview) return null
                          return (
                            <div className="mb-3 p-2 rounded border border-gray-700 bg-gray-800/60 text-xs text-gray-200">
                              <div className="font-medium text-white mb-1">Expected vs Actual (quick preview)</div>
                              <div className="text-gray-400">{preview.path || 'value'}</div>
                              <div className="mt-1">Expected: <span className="text-white">{compactJson(preview.expected)}</span></div>
                              <div>Actual: <span className="text-white">{compactJson(preview.actual)}</span></div>
                            </div>
                          )
                        })()}

                        {(() => {
                          const policies = Array.isArray(drawerItem.counterpartPolicies) ? drawerItem.counterpartPolicies : []
                          const effectivePolicyId = drawerPolicyId || (policies[0] && policies[0].id) || null
                          const mappedRows = (effectivePolicyId && drawerItem.settingMappingsByPolicy && drawerItem.settingMappingsByPolicy[effectivePolicyId])
                            ? drawerItem.settingMappingsByPolicy[effectivePolicyId]
                            : (drawerItem.settingMappings || [])
                          const policySummary = (policies.find(p => p.id === effectivePolicyId) || {}).summary || drawerItem.settingSummary
                          if (!Array.isArray(mappedRows) || mappedRows.length === 0) return null
                          return (
                          <div className="mb-3">
                            <div className="font-medium text-gray-200 mb-1">Settings coverage</div>
                            {policies.length > 1 && (
                              <div className="mb-2 flex items-center gap-2 flex-wrap">
                                <label className="text-xs text-gray-400 mr-2">Counterpart policy</label>
                                <select
                                  className="input text-xs py-1 px-2 max-w-full"
                                  value={effectivePolicyId || ''}
                                  onChange={e => setDrawerPolicyId(e.target.value)}>
                                  {policies.map(p => (
                                    <option key={p.id} value={p.id}>{p.displayName || p.id}</option>
                                  ))}
                                </select>
                              </div>
                            )}
                            {policySummary && (
                              <div className="text-xs text-gray-400 mb-2 break-words">
                                <span title={getSummaryMetricTooltip('total')}>Total {policySummary.totalSettings}</span>
                                {' · '}
                                <span title={getSummaryMetricTooltip('matched')}>Matched {policySummary.matchedSettings}</span>
                                {' · '}
                                <span title={getSummaryMetricTooltip('nomatch')}>No match {policySummary.noMatchSettings}</span>
                                {policySummary.extraSettings ? <><span>{' · '}</span><span title={getSummaryMetricTooltip('extra')}>Extra {policySummary.extraSettings}</span></> : ''}
                              </div>
                            )}
                            <div className="space-y-2 max-h-[40vh] overflow-auto pr-1">
                              {mappedRows.map((m, idx) => (
                                <div key={`${m.logicalKey || m.referencePath || 'setting'}-${idx}`} className="rounded border border-gray-700 bg-gray-800/50 p-2 text-xs">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="font-medium text-white break-words min-w-0">{m.label || m.logicalKey || m.referencePath}</div>
                                    <span className={`px-1.5 py-0.5 rounded border text-[11px] shrink-0 ${m.status === 'matched' ? 'border-green-800 text-green-300 bg-green-950/30' : m.status === 'extra' ? 'border-blue-800 text-blue-300 bg-blue-950/30' : 'border-red-800 text-red-300 bg-red-950/30'}`}>
                                      {m.status}
                                    </span>
                                  </div>
                                  <div className="text-gray-400 mt-1">Expected: <span className="text-gray-200 break-all">{compactJson(m.expected)}</span></div>
                                  <div className="text-gray-400">Actual: <span className="text-gray-200 break-all">{compactJson(m.actual)}</span></div>
                                  {formatComparisonReason(m.comparisonReason) && (
                                    <div className="text-gray-500">Reason: {formatComparisonReason(m.comparisonReason)}</div>
                                  )}
                                  {m.counterpart && (
                                    <div className="text-gray-500 mt-1 break-words">Counterpart: {m.counterpart.displayName || m.counterpart.id}</div>
                                  )}
                                  <div className="text-gray-600 mt-1 break-all">Template path: {m.referencePath || 'n/a'}</div>
                                  <div className="text-gray-600 break-all">Collector path: {m.collectorPath || 'n/a'}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                          )
                        })()}

                        {drawerItem.mismatches && drawerItem.mismatches.length > 0 && (
                          <div className="mb-3">
                            <div className="font-medium text-gray-200 mb-1">Mismatches</div>
                            <ul className="list-disc ml-5 text-xs text-gray-300">
                              {drawerItem.mismatches.map((m, i) => (
                                <li key={i} className="mb-1">
                                  <div className="break-all">{m.path || JSON.stringify(m)}</div>
                                  {m.expected !== undefined && <div className="text-xs text-gray-400 break-all">expected: {JSON.stringify(m.expected)}</div>}
                                  {m.actual !== undefined && <div className="text-xs text-gray-400 break-all">actual: {JSON.stringify(m.actual)}</div>}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {drawerItem.matchedSamples && drawerItem.matchedSamples.length > 0 && (
                          <div className="mb-3">
                            <div className="font-medium text-gray-200 mb-1">Matched samples</div>
                            <div className="space-y-2">
                              {drawerItem.matchedSamples.map(s => (
                                <div key={s.id || s.key || (s.displayName||s).toString()} className="bg-gray-800 border border-gray-700 px-2 py-1 rounded text-xs">
                                  <div className="font-medium">{s.displayName || s.id || s.key}</div>
                                  {Array.isArray(s.matchedPaths) && s.matchedPaths.length > 0 && (
                                    <div className="text-xs text-gray-400 break-all">{s.matchedPaths.map(p => p.path).slice(0,3).join(', ')}</div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
 
// End of ReferenceTemplates component
