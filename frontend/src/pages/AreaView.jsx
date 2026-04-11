import { useState, useEffect } from 'react'
import { useBranding } from '../App.jsx'
import { useParams, useNavigate } from 'react-router-dom'
import {
  RefreshCw, BookMarked, RotateCcw, ChevronDown, ChevronRight,
  AlertTriangle, CheckCircle, Plus, Minus, Eye, Lock, ArrowRight, ArrowLeft,
  ShieldCheck, ShieldAlert, Camera, SlidersHorizontal, Hash, RotateCw,
  Clock, Trash2, Search, X
} from 'lucide-react'
import { areaApi, tenantApi } from '../api/client.js'
import { usePollJob } from '../hooks/usePollJob.js'

// ── Value formatter ───────────────────────────────────────────────────────────
function formatValue(val) {
  if (val === undefined || val === null)
    return <span className="italic text-gray-600">{val === undefined ? 'not present' : 'null'}</span>
  if (typeof val === 'object')
    return <span className="font-mono text-xs break-all">{JSON.stringify(val, null, 1)}</span>
  if (typeof val === 'boolean')
    return <span className={`font-mono font-bold ${val ? 'text-green-400' : 'text-red-400'}`}>{String(val)}</span>
  return <span className="font-mono text-xs break-all">{String(val)}</span>
}

function getByPath(obj, path) {
  return path.split('.').reduce((acc, k) => (acc == null ? undefined : acc[k]), obj)
}

// ── Property comparison row ───────────────────────────────────────────────────
function PropRow({ label, baselineVal, liveVal, hasDrift, onRestore, restoring, monitorOnly }) {
  return (
    <div className={`grid grid-cols-[1fr_24px_1fr] gap-1 items-start px-3 py-2 rounded-lg text-xs
      ${hasDrift ? 'bg-red-950/20 border border-red-900/40' : 'bg-gray-900/40 border border-transparent'}`}>
      <div className="min-w-0">
        <div className="text-gray-600 text-xs mb-0.5 font-medium truncate">{label}</div>
        <div className={hasDrift ? 'text-green-300' : 'text-gray-400'}>{formatValue(baselineVal)}</div>
      </div>
      <div className="flex items-center justify-center pt-5">
        <ArrowRight size={12} className={hasDrift ? 'text-red-600' : 'text-gray-700'} />
      </div>
      <div className="min-w-0 flex items-start justify-between gap-1">
        <div className={hasDrift ? 'text-red-300' : 'text-gray-400'}>{formatValue(liveVal)}</div>
        {hasDrift && monitorOnly && (
          <span title="This field is monitored for changes but cannot be restored via the Graph API. Update it manually in the Microsoft 365 admin centre."
            className="shrink-0 flex items-center gap-1 text-xs text-amber-500/70 border border-amber-900/40 px-1.5 py-0.5 rounded cursor-help">
            <Eye size={9}/> Monitor only
          </span>
        )}
        {hasDrift && onRestore && !monitorOnly && (
          <button onClick={onRestore} disabled={restoring}
            className="shrink-0 flex items-center gap-1 text-xs bg-green-950/60 hover:bg-green-900/60 border border-green-900/60 text-green-400 px-1.5 py-0.5 rounded transition-colors">
            <RotateCcw size={9} className={restoring ? 'animate-spin' : ''} /> Fix
          </button>
        )}
      </div>
    </div>
  )
}

// ── Per-resource card ─────────────────────────────────────────────────────────
function ResourceCard({
  resourceId, resourceName, baselineResource, liveResource,
  watchedKeys, driftItem, onRestore, restoring, hasBaseline, defaultOpen,
  monitorOnlyKeys
}) {
  const [open, setOpen] = useState(defaultOpen)

  const status = driftItem?.status || (
    !hasBaseline       ? 'no-baseline'
    : !liveResource    ? 'missing'
    : !baselineResource ? 'not-in-baseline'
    : 'clean'
  )

  const driftedPaths = new Set((driftItem?.drifts || []).map(d => d.path))
  const driftCount   = driftItem?.drifts?.length || 0

  // Props to show in the comparison
  const propsToShow = watchedKeys.length > 0
    ? watchedKeys
    : (baselineResource || liveResource)
      ? Object.keys(baselineResource || liveResource)
          .filter(k => !['id','createdDateTime','lastModifiedDateTime','modifiedDateTime','renewedDateTime'].includes(k))
          .map(k => ({ path: k, label: k }))
      : []

  const statusCfg = {
    clean:            { border: 'border-green-900/30',  bg: 'bg-green-950/10',  icon: <CheckCircle size={14} className="text-green-400"/>,  label: 'Clean' },
    drifted:          { border: 'border-red-900/50',    bg: 'bg-red-950/15',    icon: <ShieldAlert size={14} className="text-red-400"/>,    label: `${driftCount} drift${driftCount!==1?'s':''}` },
    missing:          { border: 'border-orange-900/50', bg: 'bg-orange-950/15', icon: <Minus       size={14} className="text-orange-400"/>, label: 'Missing from tenant' },
    'not-in-baseline':{ border: 'border-gray-800',      bg: '',                  icon: <Eye         size={14} className="text-gray-600"/>,   label: 'Not in baseline' },
    'no-baseline':    { border: 'border-gray-800',      bg: '',                  icon: <Eye         size={14} className="text-gray-600"/>,   label: 'No baseline set' },
  }[status] || { border: 'border-gray-800', bg: '', icon: null, label: '' }

  return (
    <div className={`rounded-xl border overflow-hidden ${statusCfg.border} ${statusCfg.bg}`}>
      <button className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.02] transition-colors"
        onClick={() => setOpen(v => !v)}>
        {statusCfg.icon}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-white text-sm">{resourceName}</span>
            {driftItem?.monitorMode === 'snapshot'
              ? <span className="flex items-center gap-1 text-xs bg-violet-950/60 border border-violet-800/60 text-violet-300 px-2 py-0.5 rounded-full"><Camera size={9}/> Snapshot</span>
              : driftItem?.monitorMode === 'properties'
              ? <span className="flex items-center gap-1 text-xs bg-brand-950/60 border border-brand-800/60 text-brand-300 px-2 py-0.5 rounded-full"><SlidersHorizontal size={9}/> Properties</span>
              : null}
          </div>
          <span className={`text-xs ${status==='drifted'?'text-red-400':status==='not-in-baseline'?'text-gray-500':status==='missing'?'text-orange-400':'text-gray-600'}`}>
            {statusCfg.label}
          </span>
        </div>
        {status === 'drifted' && onRestore && (
          <button onClick={e => { e.stopPropagation(); onRestore(resourceId) }}
            disabled={restoring[`${resourceId}:null`]}
            className="shrink-0 flex items-center gap-1.5 text-xs bg-green-950/60 hover:bg-green-900/60 border border-green-900/60 text-green-300 px-2.5 py-1 rounded transition-colors">
            <RotateCcw size={10} className={restoring[`${resourceId}:null`] ? 'animate-spin' : ''} />
            {restoring[`${resourceId}:null`] ? 'Restoring…' : 'Restore'}
          </button>
        )}
        {status === 'missing' && onRestore && (
          <button onClick={e => { e.stopPropagation(); onRestore(resourceId) }}
            disabled={restoring[`${resourceId}:null`]}
            className="shrink-0 flex items-center gap-1.5 text-xs bg-orange-950/60 hover:bg-orange-900/60 border border-orange-900/60 text-orange-300 px-2.5 py-1 rounded transition-colors">
            <RotateCcw size={10}/> Restore
          </button>
        )}
        {open ? <ChevronDown size={14} className="text-gray-600 shrink-0"/> : <ChevronRight size={14} className="text-gray-600 shrink-0"/>}
      </button>

      {open && (
        <div className="border-t border-gray-800/60 px-4 py-3 space-y-1.5">
          {driftItem?.monitorMode === 'snapshot' && driftItem?.status === 'drifted' && (
            <div className="flex items-start gap-2 bg-violet-950/20 border border-violet-900/40 rounded-lg px-3 py-2 mb-2 text-xs text-violet-300">
              <Hash size={11} className="shrink-0 mt-0.5 text-violet-500"/>
              <div>
                <strong className="text-violet-200">Configuration hash changed.</strong>
                {' '}Monitored as a whole — any field change triggers drift.
                {driftItem.baseHash && <span className="block mt-0.5 text-violet-500 font-mono">baseline: {driftItem.baseHash} → live: {driftItem.liveHash}</span>}
              </div>
            </div>
          )}

          {hasBaseline && (
            <div className="grid grid-cols-[1fr_24px_1fr] gap-1 text-xs font-semibold text-gray-600 pb-1 px-3">
              <span className="flex items-center gap-1"><ShieldCheck size={10}/> Baseline (desired)</span>
              <span/>
              <span className="flex items-center gap-1"><Eye size={10}/> Live (current)</span>
            </div>
          )}

          {status === 'missing' && (
            <div className="text-xs text-orange-400 px-3 py-2 bg-orange-950/20 border border-orange-900/40 rounded-lg">
              This resource was in the baseline but no longer exists in the tenant.
            </div>
          )}
          {status === 'not-in-baseline' && (
            <div className="text-xs text-gray-500 px-3 py-2 bg-gray-900/40 border border-gray-800 rounded-lg">
              This resource exists in the tenant but is not included in the baseline — it will not trigger drift alerts.{' '}
              <span className="text-brand-400">Edit baseline</span> to include it.
            </div>
          )}
          {status === 'no-baseline' && (
            <div className="text-xs text-yellow-400/80 px-3 py-2 bg-yellow-950/10 border border-yellow-900/30 rounded-lg">
              No baseline set for this area — showing live values only. Set a baseline to enable drift detection.
            </div>
          )}

          {propsToShow.map(({ path, label }) => {
            const bVal = baselineResource ? getByPath(baselineResource, path) : undefined
            const lVal = liveResource     ? getByPath(liveResource,    path) : undefined
            const hasDrift   = driftedPaths.has(path)
            const isMonitorOnly = (monitorOnlyKeys || []).includes(path)
            return (
              <PropRow key={path} label={label} baselineVal={bVal} liveVal={lVal} hasDrift={hasDrift}
                onRestore={hasDrift && onRestore && !isMonitorOnly ? () => onRestore(resourceId, path) : null}
                restoring={restoring[`${resourceId}:${path}`]}
                monitorOnly={isMonitorOnly}/>
            )
          })}

          {propsToShow.length === 0 && (
            <p className="text-xs text-gray-600 px-3">No properties to display.</p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Resource group section ────────────────────────────────────────────────────
function ResourceGroup({ group, resourceIds, liveResources, baselineResources, watchedKeys, driftMap, onRestore, restoring, hasBaseline, monitorOnlyKeys }) {
  const [open, setOpen] = useState(true)
  const driftedInGroup = resourceIds.filter(id => driftMap[id]?.status === 'drifted').length
  const totalInGroup   = resourceIds.length

  if (totalInGroup === 0) return null

  return (
    <div className="space-y-1.5">
      <button onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 w-full group">
        <div className="w-2 h-2 rounded-full shrink-0" style={{backgroundColor: group.color}}/>
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{group.name}</span>
        {driftedInGroup > 0 && (
          <span className="text-xs bg-red-900/40 text-red-400 border border-red-900/60 px-1.5 py-0.5 rounded">{driftedInGroup} drift{driftedInGroup!==1?'s':''}</span>
        )}
        <span className="text-xs text-gray-700">{totalInGroup} resource{totalInGroup!==1?'s':''}</span>
        <div className="flex-1 h-px bg-gray-800"/>
        {open ? <ChevronDown size={11} className="text-gray-700"/> : <ChevronRight size={11} className="text-gray-700"/>}
      </button>
      {open && resourceIds.map(id => (
        <ResourceCard key={id}
          resourceId={id}
          resourceName={liveResources[id]?.displayName || baselineResources[id]?.displayName || id}
          baselineResource={baselineResources[id]}
          liveResource={liveResources[id]}
          watchedKeys={watchedKeys}
          driftItem={driftMap[id]}
          onRestore={onRestore}
          restoring={restoring}
          hasBaseline={hasBaseline}
          monitorOnlyKeys={monitorOnlyKeys}
          defaultOpen={driftMap[id]?.status === 'drifted'}/>
      ))}
    </div>
  )
}

function EmptyState({ icon: Icon, title, body, action }) {
  return (
    <div className="card text-center py-12 space-y-3">
      <Icon size={40} className="text-gray-700 mx-auto"/>
      <p className="text-gray-400 font-medium">{title}</p>
      {body && <p className="text-gray-600 text-sm max-w-sm mx-auto">{body}</p>}
      {action}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function AreaView({ showToast, onSync }) {
  const { tenantId, areaKey } = useParams()
  const navigate = useNavigate()

  const [tenant,      setTenant]      = useState(null)
  const [area,        setArea]        = useState(null)
  const [perm,        setPerm]        = useState(null)
  const [liveData,    setLiveData]    = useState(null)
  const [baseline,    setBaseline]    = useState(null)
  const [drift,       setDrift]       = useState(null)
  const [restoreLog,  setRestoreLog]  = useState([])
  const [pulling,     setPulling]     = useState(false)
  const [restoring,   setRestoring]   = useState({})
  const [restoringAll,setRestoringAll]= useState(false)
  const [tab,         setTab]         = useState('compare')
  const [autoRestore, setAutoRestore] = useState(false)
  const [loading,     setLoading]     = useState(true)
  const [resourceSearch,       setResourceSearch]       = useState('')
  const [resourceStatusFilter, setResourceStatusFilter] = useState('all') // all | drifted | clean
  const { poll } = usePollJob()

  // ── Load metadata ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!tenantId || !areaKey) return
    setLoading(true)
    setLiveData(null); setDrift(null); setBaseline(null); setTab('compare')

    Promise.all([tenantApi.list(), areaApi.list(tenantId)])
      .then(([tenants, areas]) => {
        const t = tenants.find(t => t.id === tenantId)
        const a = areas.find(a => a.area_key === areaKey)
        setTenant(t || null)
        setArea(a || null)
        if (a) setAutoRestore(a.auto_restore === 1)
        refreshPerm(t)
      })
      .catch(() => showToast('Failed to load area', 'error'))
      .finally(() => setLoading(false))
  }, [tenantId, areaKey])

  const refreshPerm = (t) => {
    const src = t || tenant
    if (src?.permissions_json) {
      try {
        const { areas: pa } = JSON.parse(src.permissions_json)
        setPerm(pa?.find(p => p.areaKey === areaKey) || null)
        return
      } catch {}
    }
    setPerm(null)
  }

  const loadAreaData = async () => {
    if (!tenantId || !areaKey) return
    try {
      const [live, log] = await Promise.all([
        areaApi.getLive(tenantId, areaKey).catch(() => null),
        areaApi.getRestoreLog(tenantId, areaKey).catch(() => []),
      ])
      setLiveData(live)
      setRestoreLog(log)
      const bl = await areaApi.getBaseline(tenantId, areaKey).catch(() => null)
      setBaseline(bl)
      if (bl) {
        const d = await areaApi.getDrift(tenantId, areaKey).catch(() => null)
        setDrift(d)
      }
    } catch {}
  }

  useEffect(() => { if (area) loadAreaData() }, [area])

  // ── Pull live data ─────────────────────────────────────────────────────────
  const pull = async () => {
    setPulling(true)
    try {
      const { jobId } = await areaApi.pull(tenantId, areaKey)
      poll(
        jobId,
        // onComplete
        (job) => {
          setPulling(false)
          loadAreaData()
          onSync?.()
          if (job?.updatedPermissions) {
            const pa = job.updatedPermissions.areas || []
            setPerm(pa.find(p => p.areaKey === areaKey) || null)
          } else {
            tenantApi.getPermissions(tenantId).then(data => {
              const pa = data.areas || []
              setPerm(pa.find(p => p.areaKey === areaKey) || null)
            }).catch(() => {})
          }
          showToast('Synced from Graph API', 'success')
        },
        // onError
        err => { setPulling(false); showToast(err, 'error') },
        // onUnavailable — area not licenced, stop spinner and show informational message
        () => {
          setPulling(false)
          showToast('This area is not available on this tenant\'s licence tier', 'info')
        }
      )
    } catch (err) {
      setPulling(false)
      showToast(err.response?.data?.message || 'Pull failed', 'error')
    }
  }

  // ── Restore single resource (or single property) ───────────────────────────
  const restore = async (resourceId, propertyPath = null) => {
    const key = `${resourceId}:${propertyPath}`
    const restoreType = propertyPath ? 'manual_property' : 'manual_full'
    setRestoring(r => ({ ...r, [key]: true }))
    try {
      const result = await areaApi.restore(tenantId, areaKey, resourceId, propertyPath, restoreType)
      showToast(result.message, 'success')
      // Re-pull to update drift state after restore
      const { jobId } = await areaApi.pull(tenantId, areaKey)
      poll(jobId, () => loadAreaData(), () => {}, () => loadAreaData())
    } catch (err) {
      showToast(err.response?.data?.message || 'Restore failed', 'error')
    } finally {
      setRestoring(r => ({ ...r, [key]: false }))
    }
  }

  // ── Bulk restore all drifted resources ─────────────────────────────────────
  const restoreAll = async () => {
    const driftedIds = (drift?.summary || [])
      .filter(s => s.status === 'drifted' || s.status === 'missing')
      .map(s => s.resourceId)
    if (driftedIds.length === 0) return

    setRestoringAll(true)
    let successCount = 0
    let failCount    = 0
    for (const resourceId of driftedIds) {
      try {
        await areaApi.restore(tenantId, areaKey, resourceId, null, 'bulk')
        successCount++
      } catch {
        failCount++
      }
    }
    setRestoringAll(false)
    showToast(
      failCount === 0
        ? `${successCount} resource${successCount!==1?'s':''} restored to baseline`
        : `${successCount} restored, ${failCount} failed`,
      failCount === 0 ? 'success' : 'error'
    )
    const { jobId } = await areaApi.pull(tenantId, areaKey).catch(() => ({ jobId: null }))
    if (jobId) poll(jobId, () => loadAreaData(), () => {}, () => loadAreaData())
  }

  const toggleAutoRestore = async () => {
    const next = !autoRestore
    await areaApi.setAutoRestore(tenantId, areaKey, next)
    setAutoRestore(next)
    showToast(`Auto-restore ${next ? 'enabled' : 'disabled'}`, 'success')
  }

  // ── Guards ─────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="flex items-center justify-center h-full text-gray-600 text-sm">Loading…</div>
  )
  if (!tenant || !area) return (
    <div className="p-8 text-center">
      <p className="text-gray-500">Area not found. <button onClick={() => navigate('/')} className="text-brand-400 hover:underline">Go home</button></p>
    </div>
  )

  const isLocked   = perm ? !perm.canRead  : false
  const canRestore = !perm || perm.canWrite

  if (isLocked) return (
    <div className="p-6 max-w-2xl mx-auto space-y-5">
      <div>
        <button onClick={() => navigate('/')}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-brand-400 transition-colors mb-1 group">
          <ArrowLeft size={11} className="group-hover:-translate-x-0.5 transition-transform"/>
          <span>{tenant.display_name}</span>
          <ChevronRight size={10} className="text-gray-700"/>
          <span className="text-gray-600">{area.display_name}</span>
        </button>
        <h1 className="text-xl font-bold text-white">{area.display_name}</h1>
      </div>
      <div className="card border-gray-800/60 bg-gray-900/40 space-y-4 text-center py-10">
        <Lock size={40} className="text-gray-700 mx-auto"/>
        <p className="text-gray-400 font-medium">This area is locked</p>
        <p className="text-gray-600 text-sm">Add the following permission to your App Registration and grant admin consent:</p>
        <div className="flex flex-wrap justify-center gap-2">
          {perm?.missingRead?.map(p => (
            <code key={p} className="text-sm bg-gray-800 border border-gray-700 text-gray-300 px-3 py-1.5 rounded font-mono">{p}</code>
          ))}
        </div>
        <button onClick={() => navigate('/')} className="btn-secondary mx-auto">← Back to Dashboard</button>
      </div>
    </div>
  )

  // ── Build resource sets ────────────────────────────────────────────────────
  const liveResources     = liveData?.resources     || {}
  const baselineResources = baseline?.resources     || {}
  const watchedKeys       = baseline?.watched_keys  || []
  const resourceGroups    = baseline?.resource_groups || []
  const monitorOnlyKeys   = area?.monitorOnlyKeys   || []
  const driftMap          = {}
  for (const item of (drift?.summary || [])) driftMap[item.resourceId] = item

  const hasBaseline  = !!baseline
  const hasAnyData   = liveData || baseline

  // When a baseline exists, the configuration tab shows ONLY baseline resources.
  // Resources not in baseline go in the collapsed "Not in Baseline" section.
  // Deduplicate IDs to prevent double-rendering.
  const allBaselineIds  = hasBaseline ? [...new Set(Object.keys(baselineResources))] : []
  const allLiveIds      = [...new Set(Object.keys(liveResources))]

  // monitoredIds = resources that have an active monitoring mode (snapshot or properties)
  // For pre-baseline view, show all live resources
  const baselineIdsSet  = new Set(allBaselineIds)
  const monitoredIds    = hasBaseline
    ? allBaselineIds.filter(id => {
        const mode = baseline?.resource_modes?.[id] || 'properties'
        return mode !== 'none'
      })
    : allLiveIds

  // noMonitoringIds = baseline resources explicitly set to "none" mode
  const noMonitoringIds = hasBaseline
    ? allBaselineIds.filter(id => (baseline?.resource_modes?.[id] || 'properties') === 'none')
    : []

  // liveOnlyIds = live resources not in baseline at all
  const liveOnlyIds     = hasBaseline
    ? allLiveIds.filter(id => !baselineIdsSet.has(id))
    : []

  const driftedCount  = monitoredIds.filter(id => driftMap[id]?.status === 'drifted').length
  const cleanCount    = monitoredIds.filter(id => driftMap[id]?.status === 'clean').length
  const missingCount  = monitoredIds.filter(id => !liveResources[id]).length
  const newCount      = liveOnlyIds.length

  const totalDrifted  = driftedCount + missingCount
  const hasAnythingDrifted = totalDrifted > 0

  // Sort monitored: drifted/missing first, then clean
  const sortedMonitoredIds = [
    ...monitoredIds.filter(id => ['drifted','missing'].includes(driftMap[id]?.status || (liveResources[id] ? '' : 'missing'))),
    ...monitoredIds.filter(id => !['drifted','missing'].includes(driftMap[id]?.status || (liveResources[id] ? '' : 'missing'))),
  ]

  // Apply search + status filter to ALL resource lists
  const matchesSearch = (id) => {
    if (!resourceSearch) return true
    const q = resourceSearch.toLowerCase()
    const res = liveResources[id] || baselineResources[id] || {}
    return (
      (res.displayName || '').toLowerCase().includes(q) ||
      id.toLowerCase().includes(q)
    )
  }
  const matchesStatus = (id) => {
    if (resourceStatusFilter === 'all') return true
    const st = driftMap[id]?.status || (liveResources[id] ? 'no-baseline' : 'missing')
    if (resourceStatusFilter === 'drifted') return st === 'drifted' || st === 'missing'
    if (resourceStatusFilter === 'clean')   return st === 'clean'
    return true
  }

  const filteredSortedMonitoredIds = sortedMonitoredIds.filter(id => matchesSearch(id) && matchesStatus(id))
  const filteredLiveOnlyIds        = liveOnlyIds.filter(id => matchesSearch(id))

  // Build grouped and ungrouped resource lists (from filtered set)
  const groupedResourceIds    = resourceGroups.flatMap(g => g.resourceIds)
  const ungroupedMonitoredIds = filteredSortedMonitoredIds.filter(id => !groupedResourceIds.includes(id))

  const hasActiveResourceFilter = !!(resourceSearch || resourceStatusFilter !== 'all')

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          {/* Breadcrumb / back button */}
          <button onClick={() => navigate('/')}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-brand-400 transition-colors mb-1 group">
            <ArrowLeft size={11} className="group-hover:-translate-x-0.5 transition-transform"/>
            <span>{tenant.display_name}</span>
            <ChevronRight size={10} className="text-gray-700"/>
            <span className="text-gray-600">{area.display_name}</span>
          </button>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-bold text-white">{area.display_name}</h1>
            {/* Custom collector — read-only indicator */}
            {area.isCustom && (
              <span className="flex items-center gap-1.5 text-xs font-semibold text-amber-400 bg-amber-950/30 border border-amber-900/50 px-2.5 py-1 rounded-full">
                <Eye size={11}/> Custom · Read-Only
              </span>
            )}
            {/* Baseline status indicator */}
            {hasBaseline ? (
              <span className="flex items-center gap-1.5 text-xs font-semibold text-green-400 bg-green-950/30 border border-green-900/50 px-2.5 py-1 rounded-full">
                <ShieldCheck size={11}/> Baseline Active
              </span>
            ) : hasAnyData ? (
              <span className="flex items-center gap-1.5 text-xs font-semibold text-yellow-400 bg-yellow-950/30 border border-yellow-900/50 px-2.5 py-1 rounded-full">
                <AlertTriangle size={11}/> No Baseline
              </span>
            ) : null}
          </div>
          <p className="text-gray-500 text-sm mt-1">{area.description}</p>
          {/* Per-area last-synced timestamp */}
          <p className="text-xs text-gray-700 mt-1 flex items-center gap-1.5">
            <Clock size={10}/>
            {area.last_pulled_at
              ? (() => {
                  const { timezone } = useBranding();
                  const fmtTs = (iso, tz) => {
                    if (!iso) return '—';
                    try {
                      return new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'short', timeZone: tz }).format(new Date(iso));
                    } catch {
                      return iso;
                    }
                  };
                  return <>Last synced: <span className="text-gray-500">{fmtTs(area.last_pulled_at, timezone)}</span></>;
                })()
              : <span className="text-gray-700">Never synced — pull live data to start</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Bulk restore — only when there are drifted items and write access */}
          {hasAnythingDrifted && canRestore && (
            <button onClick={restoreAll} disabled={restoringAll}
              className="btn-danger text-xs flex items-center gap-1.5">
              <RotateCw size={12} className={restoringAll ? 'animate-spin' : ''}/>
              {restoringAll ? 'Restoring…' : `Restore All (${totalDrifted})`}
            </button>
          )}
          <button onClick={pull} disabled={pulling} className="btn-secondary">
            <RefreshCw size={13} className={pulling ? 'animate-spin' : ''}/>
            {pulling ? 'Pulling…' : 'Pull Live Data'}
          </button>
          <button onClick={() => navigate(`/baseline-editor/${tenantId}/${areaKey}`)} className="btn-primary">
            <BookMarked size={13}/>
            {hasBaseline ? 'Edit Baseline' : 'Set Baseline'}
          </button>
        </div>
      </div>

      {/* Read-only / permission banner — live, updated on every pull */}
      {!canRestore && perm && (
        <div className="flex items-center gap-2 bg-yellow-950/20 border border-yellow-900/40 rounded-lg px-4 py-2.5 text-xs text-yellow-300">
          <Eye size={13} className="shrink-0"/>
          <span>
            Read-only — drift detection active, restore disabled. Add{' '}
            {(perm.missingWrite || []).map((p, i, arr) => (
              <span key={p}><code className="font-mono bg-yellow-950/40 px-1 rounded">{p}</code>{i < arr.length-1 ? ', ' : ''}</span>
            ))}{' '}to your App Registration and re-pull to enable restore.
          </span>
        </div>
      )}

      {/* Auto-restore toggle */}
      {hasBaseline && canRestore && (
        <div className="flex items-center justify-between card-sm">
          <div>
            <div className="text-sm font-medium text-white">Auto-Restore</div>
            <div className="text-xs text-gray-500">Automatically restore drifted resources to baseline on next sync</div>
          </div>
          <button onClick={toggleAutoRestore}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${autoRestore ? 'bg-brand-500' : 'bg-gray-700'}`}>
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${autoRestore ? 'translate-x-6' : 'translate-x-1'}`}/>
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-0 border-b border-gray-800">
        {[
          ['compare', 'Configuration', driftedCount > 0 || missingCount > 0 ? totalDrifted : null],
          ['log',     'Restore Log',   null],
          ['history', 'Baseline History', null],
        ].map(([key, label, badge]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm transition-colors border-b-2 -mb-px
              ${tab===key ? 'border-brand-500 text-white' : 'border-transparent text-gray-500 hover:text-gray-300'}`}>
            {label}
            {badge != null && (
              <span className="ml-1.5 bg-red-900 text-red-300 text-xs px-1.5 py-0.5 rounded-full">{badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Configuration tab ─────────────────────────────────────────────── */}
      {tab === 'compare' && (
        <div className="space-y-4">

          {/* No data */}
          {!hasAnyData && (
            <EmptyState icon={RefreshCw} title="No data yet"
              body="Pull the live configuration to see what exists in this area, then set a baseline to start drift monitoring."
              action={
                <button onClick={pull} disabled={pulling} className="btn-secondary mx-auto">
                  <RefreshCw size={12} className={pulling ? 'animate-spin' : ''}/>
                  {pulling ? 'Pulling…' : 'Pull Live Data'}
                </button>
              }
            />
          )}

          {/* No baseline yet — prompt to set one */}
          {hasAnyData && !hasBaseline && (
            <div className="flex items-start gap-3 bg-yellow-950/20 border border-yellow-900/40 rounded-xl px-4 py-3 text-sm">
              <AlertTriangle size={15} className="text-yellow-400 shrink-0 mt-0.5"/>
              <div>
                <span className="text-yellow-300 font-medium">No baseline set.</span>
                <span className="text-yellow-400/70 ml-2">
                  Showing all live resources below. Click <strong className="text-white">Set Baseline</strong> to choose which resources to monitor and enable drift detection.
                </span>
              </div>
            </div>
          )}

          {/* Drift summary strip */}
          {hasBaseline && drift && (
            <>
              {/* All-clean banner replaces the grid when fully clean */}
              {driftedCount === 0 && missingCount === 0 && cleanCount > 0 ? (
                <div className="flex items-center gap-3 bg-green-950/20 border border-green-900/40 rounded-xl px-4 py-3">
                  <CheckCircle size={16} className="text-green-400 shrink-0"/>
                  <div>
                    <span className="text-sm font-medium text-green-300">All clean</span>
                    <span className="text-xs text-green-500/70 ml-2">{cleanCount} resource{cleanCount !== 1 ? 's' : ''} match baseline</span>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {[
                    {
                      label:   'Drifted',
                      value:   driftedCount,
                      color:   driftedCount>0 ? 'text-red-400' : 'text-gray-500',
                      border:  driftedCount>0 ? 'border-red-900/60' : 'border-gray-800',
                      desc:    'Drifted from desired baseline',
                      tooltip: 'Resources whose current configuration no longer matches the saved baseline.',
                    },
                    {
                      label:   'Clean',
                      value:   cleanCount,
                      color:   'text-green-400',
                      border:  'border-gray-800',
                      desc:    'Matches desired baseline',
                      tooltip: 'Resources whose current configuration exactly matches the saved baseline.',
                    },
                    {
                      label:   'Missing',
                      value:   missingCount,
                      color:   missingCount>0 ? 'text-orange-400' : 'text-gray-500',
                      border:  missingCount>0 ? 'border-orange-900/60' : 'border-gray-800',
                      desc:    'No longer exists in tenant',
                      tooltip: 'Resources that were in the baseline but can no longer be found in the tenant.',
                    },
                  ].map(({ label, value, color, border, desc, tooltip }) => (
                    <div key={label} title={tooltip}
                      className={`card-sm text-center border cursor-default group relative ${border}`}>
                      <div className={`text-xl font-bold ${color}`}>{value}</div>
                      <div className="text-xs text-gray-400 mt-0.5 font-medium">{label}</div>
                      <div className="text-xs text-gray-600 mt-1 leading-tight">{desc}</div>
                      {/* Hover tooltip */}
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 bg-gray-800 border border-gray-700 text-gray-300 text-xs rounded-lg px-3 py-2 shadow-xl
                        opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10 leading-relaxed">
                        {tooltip}
                        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-700"/>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Resource display */}
          {hasAnyData && (
            <div className="space-y-4">

              {/* ── Search + status filter bar ───────────────────────────── */}
              {monitoredIds.length > 4 && (
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-600 pointer-events-none"/>
                    <input
                      className="input w-full pl-7 py-1.5 text-xs"
                      placeholder={`Search ${area?.display_name || 'resources'}…`}
                      value={resourceSearch}
                      onChange={e => setResourceSearch(e.target.value)}
                    />
                    {resourceSearch && (
                      <button onClick={() => setResourceSearch('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400 transition-colors">
                        <X size={11}/>
                      </button>
                    )}
                  </div>
                  <div className="flex border border-gray-800 rounded-lg overflow-hidden shrink-0">
                    {[['all','All'], ['drifted','Drifted'], ['clean','Clean']].map(([val, label]) => (
                      <button key={val} onClick={() => setResourceStatusFilter(val)}
                        className={`px-2.5 py-1.5 text-xs transition-colors
                          ${resourceStatusFilter === val
                            ? 'bg-brand-700/50 text-brand-300'
                            : 'text-gray-500 hover:text-gray-300'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                  {hasActiveResourceFilter && (
                    <button onClick={() => { setResourceSearch(''); setResourceStatusFilter('all') }}
                      className="text-xs text-gray-600 hover:text-red-400 transition-colors flex items-center gap-1">
                      <X size={10}/> Clear
                    </button>
                  )}
                  {hasActiveResourceFilter && (
                    <span className="text-xs text-gray-600 shrink-0">
                      {filteredSortedMonitoredIds.length} of {monitoredIds.length}
                    </span>
                  )}
                </div>
              )}
              {/* Column header */}
              {hasBaseline && (
                <div className="grid grid-cols-[1fr_24px_1fr] gap-1 text-xs font-semibold text-gray-600 px-4 py-1">
                  <span className="flex items-center gap-1.5"><ShieldCheck size={11} className="text-brand-600"/> Baseline (desired state)</span>
                  <span/>
                  <span className="flex items-center gap-1.5"><Eye size={11} className="text-gray-500"/> Live (current state)</span>
                </div>
              )}

              {/* ── Named groups first ───────────────────────────────────── */}
              {resourceGroups.map(group => {
                const groupSortedIds = [
                  ...group.resourceIds.filter(id => monitoredIds.includes(id) && ['drifted','missing'].includes(driftMap[id]?.status || (liveResources[id]?'':'missing'))),
                  ...group.resourceIds.filter(id => monitoredIds.includes(id) && !['drifted','missing'].includes(driftMap[id]?.status || (liveResources[id]?'':'missing'))),
                ]
                return (
                  <ResourceGroup key={group.id}
                    group={group}
                    resourceIds={groupSortedIds}
                    liveResources={liveResources}
                    baselineResources={baselineResources}
                    watchedKeys={watchedKeys}
                    driftMap={driftMap}
                    onRestore={canRestore ? restore : null}
                    restoring={restoring}
                    hasBaseline={hasBaseline}
                    monitorOnlyKeys={monitorOnlyKeys}/>
                )
              })}

              {/* ── Ungrouped monitored resources ────────────────────────── */}
              {ungroupedMonitoredIds.length > 0 && (
                <div className="space-y-2">
                  {resourceGroups.length > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Other</span>
                      <div className="flex-1 h-px bg-gray-800"/>
                    </div>
                  )}
                  {ungroupedMonitoredIds.map(id => (
                    <ResourceCard key={id}
                      resourceId={id}
                      resourceName={liveResources[id]?.displayName || baselineResources[id]?.displayName || id}
                      baselineResource={baselineResources[id]}
                      liveResource={liveResources[id]}
                      watchedKeys={watchedKeys}
                      driftItem={driftMap[id]}
                      onRestore={canRestore ? restore : null}
                      restoring={restoring}
                      hasBaseline={hasBaseline}
                      monitorOnlyKeys={monitorOnlyKeys}
                      defaultOpen={['drifted','missing'].includes(driftMap[id]?.status || (liveResources[id]?'':'missing'))}/>
                  ))}
                </div>
              )}

              {/* ── Resources not in baseline (live-only) — collapsed section */}
              {hasBaseline && filteredLiveOnlyIds.length > 0 && (
                <NotInBaselineSection
                  ids={filteredLiveOnlyIds}
                  liveResources={liveResources}
                  watchedKeys={watchedKeys}
                  driftMap={driftMap}
                  onNavigateBaseline={() => navigate(`/baseline-editor/${tenantId}/${areaKey}`)}/>
              )}

              {/* ── Resources in baseline but set to "No Monitoring" — collapsed */}
              {hasBaseline && noMonitoringIds.length > 0 && (
                <NoMonitoringSection
                  ids={noMonitoringIds}
                  liveResources={liveResources}
                  baselineResources={baselineResources}
                  onNavigateBaseline={() => navigate(`/baseline-editor/${tenantId}/${areaKey}`)}/>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Restore Log tab ──────────────────────────────────────────────── */}
      {tab === 'log' && (
        <div className="space-y-2">
          {restoreLog.length === 0 ? (
            <EmptyState icon={RotateCcw} title="No restores yet" body="Restore actions will appear here with a full audit trail."/>
          ) : (
            restoreLog.map(entry => {
              const typeLabel = {
                manual_property: 'Property',
                manual_full:     'Full restore',
                bulk:            'Bulk restore',
                auto:            'Auto-restore',
              }[entry.restore_type] || (entry.property_path ? 'Property' : 'Full restore')

              const typeCls = {
                manual_property: 'text-brand-300 border-brand-900/60 bg-brand-950/20',
                manual_full:     'text-violet-300 border-violet-900/60 bg-violet-950/20',
                bulk:            'text-orange-300 border-orange-900/60 bg-orange-950/20',
                auto:            'text-teal-300 border-teal-900/60 bg-teal-950/20',
              }[entry.restore_type] || 'text-gray-400 border-gray-700 bg-gray-800/50'

              let restoredProps = []
              try { restoredProps = JSON.parse(entry.restored_properties || '[]') } catch {}

              return (
                <div key={entry.id} className={`border rounded-xl overflow-hidden ${entry.success ? 'border-gray-800' : 'border-red-900/50'}`}>
                  <div className="flex items-center gap-3 px-4 py-3 bg-gray-900/30">
                    {/* Status badge */}
                    <span className={`text-xs px-2 py-0.5 rounded border shrink-0 font-medium
                      ${entry.success ? 'text-green-400 border-green-900 bg-green-950/30' : 'text-red-400 border-red-900 bg-red-950/30'}`}>
                      {entry.success ? 'OK' : 'FAIL'}
                    </span>

                    {/* Type badge */}
                    <span className={`text-xs px-2 py-0.5 rounded border shrink-0 ${typeCls}`}>
                      {typeLabel}
                    </span>

                    {/* Resource name + property */}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white font-medium truncate">
                        {entry.resource_name || entry.resource_id}
                      </div>
                      {entry.property_path && (
                        <div className="text-xs text-gray-500 mt-0.5 font-mono truncate">
                          → {entry.property_path}
                        </div>
                      )}
                      {!entry.property_path && restoredProps.length > 0 && (
                        <div className="text-xs text-gray-600 mt-0.5 truncate">
                          {restoredProps.length} propert{restoredProps.length !== 1 ? 'ies' : 'y'} restored
                        </div>
                      )}
                    </div>

                    <span className="text-gray-600 text-xs shrink-0">{new Date(entry.restored_at).toLocaleString()}</span>
                  </div>

                  {/* Error detail */}
                  {!entry.success && entry.error_message && (
                    <div className="px-4 py-2 border-t border-red-900/30 bg-red-950/10">
                      <p className="text-xs text-red-400 font-mono">{entry.error_message}</p>
                    </div>
                  )}

                  {/* Restored properties detail — show for full/bulk/auto restores */}
                  {entry.success && restoredProps.length > 0 && !entry.property_path && (
                    <div className="px-4 py-2 border-t border-gray-800 bg-gray-900/20">
                      <div className="flex flex-wrap gap-1.5">
                        {restoredProps.slice(0, 8).map((p, i) => (
                          <span key={i} className="text-xs bg-gray-800 border border-gray-700 text-gray-400 px-2 py-0.5 rounded font-mono">
                            {typeof p === 'object' ? p.path : p}
                          </span>
                        ))}
                        {restoredProps.length > 8 && (
                          <span className="text-xs text-gray-600">+{restoredProps.length - 8} more</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}

      {/* ── Baseline History tab ─────────────────────────────────────────── */}
      {tab === 'history' && (
        <BaselineHistoryTab tenantId={tenantId} areaKey={areaKey} showToast={showToast}
          onRestored={() => { setBaseline(null); loadAreaData() }}/>
      )}
    </div>
  )
}

// ── Collapsible "No Monitoring" section ──────────────────────────────────────
function NoMonitoringSection({ ids, liveResources, baselineResources, onNavigateBaseline }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 w-full group mb-2">
        <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">No Monitoring</span>
        <span className="text-xs text-gray-700">{ids.length} resource{ids.length!==1?'s':''} — in baseline, monitoring disabled</span>
        <div className="flex-1 h-px bg-gray-800/50"/>
        {open ? <ChevronDown size={11} className="text-gray-700"/> : <ChevronRight size={11} className="text-gray-700"/>}
      </button>
      {open && (
        <div className="space-y-1.5">
          <p className="text-xs text-gray-600 mb-2">
            These resources are included in the baseline but have monitoring mode set to None — they will not trigger drift alerts.{' '}
            <button onClick={onNavigateBaseline} className="text-brand-400 hover:underline">Edit baseline</button> to enable monitoring.
          </p>
          {ids.map(id => {
            const res = liveResources[id] || baselineResources[id]
            return (
              <div key={id} className="flex items-center gap-3 border border-gray-800/40 rounded-xl px-4 py-2.5 opacity-50">
                <Eye size={14} className="text-gray-700 shrink-0"/>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-gray-500 truncate">{res?.displayName || id}</div>
                  <div className="text-xs text-gray-700 font-mono mt-0.5 truncate">{id}</div>
                </div>
                <span className="text-xs text-gray-700 shrink-0">Not monitored</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Baseline History tab ──────────────────────────────────────────────────────
function BaselineHistoryTab({ tenantId, areaKey, showToast, onRestored }) {
  const [history, setHistory]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [restoring, setRestoring] = useState(null)
  const [expanded, setExpanded] = useState(null)

  useEffect(() => {
    areaApi.getHistory(tenantId, areaKey)
      .then(setHistory)
      .catch(() => showToast('Failed to load history', 'error'))
      .finally(() => setLoading(false))
  }, [tenantId, areaKey])

  const restore = async (historyId, label) => {
    if (!confirm(`Restore baseline "${label}"? This will overwrite the current baseline (which will be archived automatically).`)) return
    setRestoring(historyId)
    try {
      await areaApi.restoreBaseline(tenantId, areaKey, historyId)
      showToast('Baseline restored from archive', 'success')
      onRestored()
    } catch { showToast('Restore failed', 'error') }
    finally { setRestoring(null) }
  }

  if (loading) return <div className="text-sm text-gray-500 py-4">Loading history…</div>

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 bg-gray-900/60 border border-gray-800 rounded-lg px-4 py-3 text-xs text-gray-400">
        <Clock size={13} className="shrink-0 mt-0.5"/>
        Every time a baseline is saved, the previous version is automatically archived here. Restore any version — the current baseline is archived before the restore.
      </div>

      {history.length === 0 ? (
        <div className="card text-center py-8">
          <Clock size={32} className="text-gray-700 mx-auto mb-2"/>
          <p className="text-gray-500 text-sm">No archived versions yet.</p>
          <p className="text-gray-600 text-xs mt-1">History is created each time you save a baseline.</p>
        </div>
      ) : (
        history.map(h => {
          const isDeleted    = h.label?.startsWith('[Deleted]')
          const isSuperseded = h.label?.startsWith('[Superseded]')
          const isRestored   = h.label?.startsWith('[Restored]')
          return (
            <div key={h.id} className="border border-gray-800 rounded-xl overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3 bg-gray-900/30">
                <Clock size={13} className="text-gray-600 shrink-0"/>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-white truncate">{h.label || 'Baseline'}</span>
                    {isDeleted    && <span className="text-xs bg-red-950/40 border border-red-900/50 text-red-400 px-1.5 py-0.5 rounded">Deleted</span>}
                    {isSuperseded && <span className="text-xs bg-gray-800 border border-gray-700 text-gray-500 px-1.5 py-0.5 rounded">Superseded</span>}
                    {isRestored   && <span className="text-xs bg-blue-950/40 border border-blue-900/50 text-blue-400 px-1.5 py-0.5 rounded">Restored</span>}
                  </div>
                  <div className="text-xs text-gray-600 mt-0.5">
                    Archived {new Date(h.archived_at).toLocaleString()} · {Object.keys(h.resources || {}).length} resources
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setExpanded(expanded === h.id ? null : h.id)}
                    className="btn-secondary text-xs">
                    {expanded === h.id ? <ChevronDown size={11}/> : <ChevronRight size={11}/>} View
                  </button>
                  <button onClick={() => restore(h.id, h.label)} disabled={restoring === h.id}
                    className="btn-secondary text-xs flex items-center gap-1.5 text-blue-400 hover:text-blue-300 border-blue-900/50">
                    <RotateCcw size={11} className={restoring === h.id ? 'animate-spin' : ''}/>
                    {restoring === h.id ? 'Restoring…' : 'Restore'}
                  </button>
                </div>
              </div>
              {expanded === h.id && (
                <div className="border-t border-gray-800 px-4 py-3">
                  <p className="text-xs text-gray-500 mb-2">Archived resources ({Object.keys(h.resources || {}).length})</p>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {Object.entries(h.resources || {}).map(([id, res]) => (
                      <div key={id} className="flex items-center gap-2 text-xs py-1 border-b border-gray-800/50 last:border-0">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          (h.resourceModes?.[id] || 'none') === 'snapshot'    ? 'bg-violet-500'
                          : (h.resourceModes?.[id] || 'none') === 'properties' ? 'bg-brand-500'
                          : 'bg-gray-600'}`}/>
                        <span className="text-gray-300 truncate">{res.displayName || id}</span>
                        <span className="text-gray-600 shrink-0 font-mono ml-auto">{h.resourceModes?.[id] || 'none'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}

// ── Collapsible "Not in Baseline" section ────────────────────────────────────
function NotInBaselineSection({ ids, liveResources, watchedKeys, driftMap, onNavigateBaseline }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 w-full group mb-2">
        <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Not in Baseline</span>
        <span className="text-xs text-gray-700">{ids.length} resource{ids.length!==1?'s':''} — excluded from monitoring</span>
        <div className="flex-1 h-px bg-gray-800/50"/>
        {open ? <ChevronDown size={11} className="text-gray-700"/> : <ChevronRight size={11} className="text-gray-700"/>}
      </button>
      {open && (
        <div className="space-y-1.5">
          <p className="text-xs text-gray-600 mb-2">
            These resources exist in the tenant but were not included in the baseline. They are not monitored for drift.{' '}
            <button onClick={onNavigateBaseline} className="text-brand-400 hover:underline">Edit baseline</button> to include them.
          </p>
          {ids.map(id => (
            <div key={id} className="flex items-center gap-3 border border-gray-800/40 rounded-xl px-4 py-2.5 opacity-50">
              <Eye size={14} className="text-gray-700 shrink-0"/>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-gray-500 truncate">{liveResources[id]?.displayName || id}</div>
                <div className="text-xs text-gray-700 font-mono mt-0.5 truncate">{id}</div>
              </div>
              <span className="text-xs text-gray-700 shrink-0">Not monitored</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
