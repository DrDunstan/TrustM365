import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Save, Download, ChevronDown, ChevronRight, Eye, Code, BookMarked,
  Info, AlertTriangle, Camera, SlidersHorizontal, Hash, Plus, X, Search,
  CheckSquare, Square, Ban, Trash2, RotateCcw, Clock, ArrowLeft
} from 'lucide-react'
import { areaApi, tenantApi, msspApi } from '../api/client.js'

// ── Helpers ───────────────────────────────────────────────────────────────────
function getByPath(obj, path) {
  return path.split('.').reduce((acc, k) => acc == null ? undefined : acc[k], obj)
}
function formatPreview(val) {
  if (val === undefined || val === null)
    return <span className="italic text-gray-600">{val === undefined ? 'not set' : 'null'}</span>
  if (typeof val === 'boolean')
    return <span className={`font-bold font-mono ${val ? 'text-green-400' : 'text-red-400'}`}>{String(val)}</span>
  if (typeof val === 'object')
    return <span className="text-gray-400 text-xs font-mono">{JSON.stringify(val).slice(0,60)}{JSON.stringify(val).length>60?'…':''}</span>
  return <span className="text-gray-300 font-mono text-xs">{String(val)}</span>
}

const GROUP_COLOURS = ['#6366f1','#8b5cf6','#ec4899','#f59e0b','#10b981','#3b82f6','#ef4444','#14b8a6']

// ── Monitor mode toggle — Snapshot / Properties / Remove ─────────────────────
// "No Monitoring" is not shown here — selecting it removes the resource from
// the baseline entirely (moves it to Not in Baseline).
// The parent passes onModeChange which calls excludeResource when 'none' is chosen.
function ModeToggle({ mode, onChange }) {
  return (
    <div className="flex gap-1.5">
      <button onClick={() => onChange('snapshot')}
        className={`flex-1 flex items-center gap-1.5 px-2.5 py-2 rounded-lg border text-xs transition-colors
          ${mode==='snapshot'
            ? 'bg-violet-950/40 border-violet-700/60 text-violet-200'
            : 'bg-gray-950 border-gray-800 text-gray-600 hover:border-gray-700 hover:text-gray-400'}`}>
        <Camera size={10}/> <div><div className="font-semibold">Snapshot</div><div className="opacity-70 text-xs">Any change</div></div>
      </button>
      <button onClick={() => onChange('properties')}
        className={`flex-1 flex items-center gap-1.5 px-2.5 py-2 rounded-lg border text-xs transition-colors
          ${mode==='properties'
            ? 'bg-brand-950/40 border-brand-700/60 text-brand-200'
            : 'bg-gray-950 border-gray-800 text-gray-600 hover:border-gray-700 hover:text-gray-400'}`}>
        <SlidersHorizontal size={10}/> <div><div className="font-semibold">Properties</div><div className="opacity-70 text-xs">Specific fields</div></div>
      </button>
      <button onClick={() => onChange('none')}
        className="flex-1 flex items-center gap-1.5 px-2.5 py-2 rounded-lg border text-xs transition-colors bg-gray-950 border-gray-800 text-gray-600 hover:border-red-900/60 hover:text-red-400 hover:bg-red-950/20">
        <Ban size={10}/> <div><div className="font-semibold">Remove</div><div className="opacity-70 text-xs">Not in baseline</div></div>
      </button>
    </div>
  )
}

// ── Resource row in the "In Baseline" section ─────────────────────────────────
// No tickbox — inclusion is implicit. Selecting "No Monitoring" moves the
// resource out of the baseline entirely (into the Not in Baseline section).
function BaselineResourceRow({ resource, resourceId, mode, onModeChange, watchableKeys, watchedKeysForResource, expanded, onToggle, onFieldChange }) {
  return (
    <div className="border border-gray-800 rounded-xl overflow-hidden">
      <button className="w-full flex items-center gap-2 px-3 py-2.5 bg-gray-900/40 text-left hover:bg-gray-900/60 transition-colors" onClick={onToggle}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-white text-sm truncate">{resource.displayName || resourceId}</span>
            {mode === 'snapshot' && (
              <span className="flex items-center gap-1 text-xs bg-violet-950/60 border border-violet-800/60 text-violet-300 px-1.5 py-0.5 rounded-full">
                <Camera size={8}/> Snapshot
              </span>
            )}
            {mode === 'properties' && (
              <span className="flex items-center gap-1 text-xs bg-brand-950/60 border border-brand-800/60 text-brand-300 px-1.5 py-0.5 rounded-full">
                <SlidersHorizontal size={8}/> Properties ({watchedKeysForResource.length > 0 ? watchedKeysForResource.length : 'all'})
              </span>
            )}
          </div>
          <div className="text-xs text-gray-700 font-mono mt-0.5 truncate">{resourceId}</div>
        </div>
        {expanded ? <ChevronDown size={13} className="text-gray-600 shrink-0"/> : <ChevronRight size={13} className="text-gray-600 shrink-0"/>}
      </button>

      {expanded && (
        <div className="border-t border-gray-800 px-3 py-3 space-y-3">
          <ModeToggle mode={mode} onChange={onModeChange}/>
          {mode === 'snapshot' && (
            <div className="flex items-start gap-2 bg-violet-950/20 border border-violet-900/40 rounded-lg px-3 py-2 text-xs text-violet-300">
              <Hash size={11} className="shrink-0 mt-0.5 text-violet-500"/>
              Entire configuration hashed at save time. Any field change triggers drift. Volatile timestamps excluded automatically.
            </div>
          )}

          {mode === 'properties' && watchableKeys.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-gray-500">Select which properties to monitor for this resource. Unselected properties are ignored.</p>
              {watchableKeys.map(k => {
                const val = getByPath(resource, k.path)
                const isWatched = watchedKeysForResource.includes(k.path)
                return (
                  <div key={k.path} className={`rounded-lg border px-3 py-2 space-y-1
                    ${isWatched ? 'border-brand-800/50 bg-brand-950/20' : 'border-gray-800 bg-gray-900/30'}`}>
                    <div className="flex items-center gap-2">
                      <button onClick={() => onFieldChange(k.path, null, 'toggle')}
                        className="shrink-0 text-gray-500 hover:text-brand-400 transition-colors">
                        {isWatched ? <CheckSquare size={13} className="text-brand-400"/> : <Square size={13}/>}
                      </button>
                      <span className="text-xs font-semibold text-gray-300">{k.label}</span>
                      {isWatched && <span className="ml-auto text-xs text-brand-400 border border-brand-800/60 bg-brand-950/40 px-1.5 rounded">Monitored</span>}
                    </div>
                    <div className="flex items-center gap-2 text-xs pl-5">
                      <span className="text-gray-600 shrink-0">Current:</span>
                      {formatPreview(val)}
                    </div>
                  </div>
                )
              })}
              {watchableKeys.length === 0 && (
                <p className="text-xs text-gray-600">No selectable properties defined for this resource type.</p>
              )}
            </div>
          )}

          {mode === 'properties' && watchableKeys.length === 0 && (
            <p className="text-xs text-gray-600">No selectable properties — all non-meta fields will be compared.</p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Group card ────────────────────────────────────────────────────────────────
function GroupCard({ group, resourceIds, includedResources, onDelete, onToggle }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border border-gray-800 rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-900/40">
        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{backgroundColor:group.color}}/>
        <button onClick={()=>setOpen(v=>!v)} className="flex-1 flex items-center gap-2 text-left">
          <span className="text-sm font-medium text-white">{group.name}</span>
          <span className="text-xs text-gray-600">{group.resourceIds.length} resource{group.resourceIds.length!==1?'s':''}</span>
          {open ? <ChevronDown size={12} className="text-gray-600 ml-auto"/> : <ChevronRight size={12} className="text-gray-600 ml-auto"/>}
        </button>
        <button onClick={onDelete} className="p-1 text-gray-700 hover:text-red-400 transition-colors"><X size={11}/></button>
      </div>
      {open && (
        <div className="border-t border-gray-800 p-2 space-y-1">
          {resourceIds.map(id => {
            const res = includedResources[id]
            const inGroup = group.resourceIds.includes(id)
            return (
              <button key={id} onClick={()=>onToggle(id)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left transition-colors
                  ${inGroup ? 'bg-brand-950/40 border border-brand-800/60 text-white' : 'text-gray-500 hover:bg-gray-800 hover:text-gray-300'}`}>
                {inGroup ? <CheckSquare size={11} className="text-brand-400 shrink-0"/> : <Square size={11} className="shrink-0"/>}
                <span className="truncate">{res?.displayName || id}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function GroupManager({ resourceIds, includedResources, resourceGroups, onGroupsChange }) {
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(GROUP_COLOURS[0])
  const createGroup = () => {
    if (!newName.trim()) return
    onGroupsChange([...resourceGroups, { id: crypto.randomUUID(), name: newName.trim(), color: newColor, resourceIds: [] }])
    setNewName(''); setAdding(false)
  }
  const deleteGroup = (id) => onGroupsChange(resourceGroups.filter(g => g.id !== id))
  const toggleResource = (groupId, resourceId) => {
    onGroupsChange(resourceGroups.map(g => {
      if (g.id !== groupId) return g
      const has = g.resourceIds.includes(resourceId)
      return { ...g, resourceIds: has ? g.resourceIds.filter(r=>r!==resourceId) : [...g.resourceIds, resourceId] }
    }))
  }

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white">Resource Groups</h3>
          <p className="text-xs text-gray-500 mt-0.5">Organise monitored resources into named groups for the area view.</p>
        </div>
        <button onClick={()=>setAdding(v=>!v)} className="btn-secondary text-xs"><Plus size={11}/> Add Group</button>
      </div>
      {adding && (
        <div className="flex items-center gap-2 bg-gray-900 border border-gray-700 rounded-lg p-3">
          <input className="input flex-1 text-sm" placeholder="Group name…" value={newName} onChange={e=>setNewName(e.target.value)}
            onKeyDown={e=>{if(e.key==='Enter')createGroup();if(e.key==='Escape')setAdding(false)}}
            autoFocus/>
          <div className="flex gap-1">
            {GROUP_COLOURS.map(c => (
              <button key={c} onClick={()=>setNewColor(c)}
                className={`w-5 h-5 rounded-full transition-transform ${newColor===c?'scale-125 ring-2 ring-white/40':''}`}
                style={{backgroundColor:c}}/>
            ))}
          </div>
          <button onClick={createGroup} className="btn-primary text-xs">Add</button>
          <button onClick={()=>setAdding(false)} className="p-1 text-gray-500 hover:text-gray-300"><X size={14}/></button>
        </div>
      )}
      {resourceGroups.length === 0 && !adding && (
        <p className="text-xs text-gray-600">No groups yet.</p>
      )}
      {resourceGroups.map(group => (
        <GroupCard key={group.id} group={group} resourceIds={resourceIds} includedResources={includedResources}
          onDelete={()=>deleteGroup(group.id)}
          onToggle={(id)=>toggleResource(group.id, id)}/>
      ))}
    </div>
  )
}

// ── History tab ───────────────────────────────────────────────────────────────
function HistoryTab({ tenantId, areaKey, showToast, onRestored }) {
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
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
        Every time you save a baseline, the previous version is automatically archived here. You can restore any archived version — the current baseline will be archived first.
      </div>

      {history.length === 0 ? (
        <div className="card text-center py-8">
          <Clock size={32} className="text-gray-700 mx-auto mb-2"/>
          <p className="text-gray-500 text-sm">No archived versions yet.</p>
          <p className="text-gray-600 text-xs mt-1">History is created each time you save a baseline.</p>
        </div>
      ) : (
        history.map(h => {
          const isDeleted = h.label?.startsWith('[Deleted]')
          const isSuperseded = h.label?.startsWith('[Superseded]')
          const isRestored = h.label?.startsWith('[Restored]')
          return (
            <div key={h.id} className="border border-gray-800 rounded-xl overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3 bg-gray-900/30">
                <Clock size={13} className="text-gray-600 shrink-0"/>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-white truncate">{h.label || 'Baseline'}</span>
                    {isDeleted && <span className="text-xs bg-red-950/40 border border-red-900/50 text-red-400 px-1.5 py-0.5 rounded">Deleted</span>}
                    {isSuperseded && <span className="text-xs bg-gray-800 border border-gray-700 text-gray-500 px-1.5 py-0.5 rounded">Superseded</span>}
                    {isRestored && <span className="text-xs bg-blue-950/40 border border-blue-900/50 text-blue-400 px-1.5 py-0.5 rounded">Restored</span>}
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
                  <button onClick={() => restore(h.id, h.label)}
                    disabled={restoring === h.id}
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
                          (h.resourceModes?.[id] || 'none') === 'snapshot' ? 'bg-violet-500'
                          : (h.resourceModes?.[id] || 'none') === 'properties' ? 'bg-brand-500'
                          : 'bg-gray-600'
                        }`}/>
                        <span className="text-gray-300 truncate">{res.displayName || id}</span>
                        <span className="text-gray-600 shrink-0 font-mono">{h.resourceModes?.[id] || 'none'}</span>
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

// ── Main ──────────────────────────────────────────────────────────────────────
export default function BaselineEditor({ showToast }) {
  const { tenantId, areaKey } = useParams()
  const navigate = useNavigate()

  const [tenant,         setTenant]         = useState(null)
  const [area,           setArea]           = useState(null)
  const [allResources,   setAllResources]   = useState({})
  const [includedIds,    setIncludedIds]    = useState(new Set())
  const [baselineSearch, setBaselineSearch] = useState('')
  // Per-resource watched keys: { [resourceId]: string[] }
  const [resourceWatchedKeys, setResourceWatchedKeys] = useState({})
  const [resourceModes,  setResourceModes]  = useState({})
  const [resourceGroups, setResourceGroups] = useState([])
  const [label,          setLabel]          = useState('Baseline')
  const [mode,           setMode]           = useState('visual') // visual | json
  const [activeTab,      setActiveTab]      = useState('editor') // editor | history
  const [jsonText,       setJsonText]       = useState('{}')
  const [jsonError,      setJsonError]      = useState(null)
  const [saving,         setSaving]         = useState(false)
  const [deleting,       setDeleting]       = useState(false)
  const [expanded,       setExpanded]       = useState({})
  const [source,         setSource]         = useState('')
  const [excludedOpen,   setExcludedOpen]   = useState(true)
  const [hasExisting,    setHasExisting]    = useState(false)

  useEffect(() => {
    if (!tenantId || !areaKey) return
    Promise.all([tenantApi.list(), areaApi.list(tenantId)]).then(([tenants, areas]) => {
      setTenant(tenants.find(t=>t.id===tenantId)||null)
      setArea(areas.find(a=>a.area_key===areaKey)||null)
    })
  }, [tenantId, areaKey])

  const loadData = async () => {
    try {
      const baseline = await areaApi.getBaseline(tenantId, areaKey)
      setHasExisting(true)
      setAllResources(baseline.resources)
      const excluded = baseline.excluded_resources || []
      setIncludedIds(new Set(Object.keys(baseline.resources).filter(id => !excluded.includes(id))))
      // Per-resource watched keys: stored as array of {path} or flat strings in watched_keys
      // We store per-resource keys separately in resourceWatchedKeys
      const savedModes = baseline.resource_modes || {}
      setResourceModes(savedModes)
      // Migrate legacy global watched_keys → apply to all properties-mode resources
      const legacyKeys = (baseline.watched_keys || []).map(k => typeof k === 'string' ? k : k.path)
      const perResourceKeys = {}
      for (const [id, res] of Object.entries(baseline.resources)) {
        if (savedModes[id] === 'properties') {
          perResourceKeys[id] = legacyKeys.length > 0 ? legacyKeys : []
        }
      }
      setResourceWatchedKeys(perResourceKeys)
      setResourceGroups(baseline.resource_groups || [])
      setLabel(baseline.label || 'Baseline')
      setJsonText(JSON.stringify(baseline.resources, null, 2))
      setSource('existing')
    } catch {
      try {
        const live = await areaApi.getLive(tenantId, areaKey)
        setHasExisting(false)
        setAllResources(live.resources)
        // NEW baseline: start with everything in "Not in Baseline"
        setIncludedIds(new Set())
        setResourceModes({})
        setJsonText(JSON.stringify(live.resources, null, 2))
        setSource('live')
        // Apply MSSP default label template if one is configured
        try {
          const mssp = await msspApi.getSettings()
          if (mssp.baseline_label_template) {
            const dateStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
            setLabel(mssp.baseline_label_template.replace('{date}', dateStr))
          }
        } catch { /* non-critical */ }
      } catch { setSource('') }
    }
  }

  useEffect(() => { if (area && tenant) loadData() }, [area, tenant])

  const loadFromLive = async () => {
    try {
      const live = await areaApi.getLive(tenantId, areaKey)
      setAllResources(live.resources)
      // Keep existing modes for known resources; default new ones to 'properties'
      setResourceModes(prev =>
        Object.fromEntries(
          Object.keys(live.resources).map(id => [id, prev[id] && prev[id] !== 'none' ? prev[id] : 'properties'])
        )
      )
      // Include all live resources in baseline by default
      setIncludedIds(new Set(Object.keys(live.resources)))
      setJsonText(JSON.stringify(live.resources, null, 2))
      setSource('live')
      showToast('Loaded current live configuration', 'success')
    } catch { showToast('Pull live data first from the area view', 'error') }
  }

  const handleJsonChange = (text) => {
    setJsonText(text)
    try {
      const parsed = JSON.parse(text)
      setAllResources(parsed)
      setIncludedIds(new Set(Object.keys(parsed)))
      setJsonError(null)
    } catch (e) { setJsonError(e.message) }
  }

  const setResourceMode = (id, m) => setResourceModes(prev => ({ ...prev, [id]: m }))

  const toggleWatchedKeyForResource = (resourceId, path) => {
    setResourceWatchedKeys(prev => {
      const current = prev[resourceId] || []
      return {
        ...prev,
        [resourceId]: current.includes(path)
          ? current.filter(k => k !== path)
          : [...current, path]
      }
    })
  }

  const includeResource  = (id) => setIncludedIds(prev => new Set([...prev, id]))
  const excludeResource  = (id) => setIncludedIds(prev => { const n = new Set(prev); n.delete(id); return n })

  const save = async () => {
    if (jsonError) return showToast('Fix JSON errors before saving', 'error')
    const activelyMonitored = Object.entries(resourceModes).filter(
      ([id, m]) => includedIds.has(id) && (m === 'snapshot' || m === 'properties')
    )
    if (activelyMonitored.length === 0) return showToast('Enable monitoring (Snapshot or Properties) on at least one resource', 'error')
    setSaving(true)
    try {
      const resources = Object.fromEntries(Object.entries(allResources).filter(([id]) => includedIds.has(id)))
      const excludedResources = Object.keys(allResources).filter(id => !includedIds.has(id))
      // Build per-resource watched key objects for properties-mode resources
      // Store as flat array of unique paths across all resources (for backward compat)
      const allWatchedPaths = [...new Set(
        Object.entries(resourceWatchedKeys).flatMap(([, keys]) => keys)
      )]
      const watchableKeyDefs = area?.watchableKeys || []
      const watchedKeyObjects = allWatchedPaths.map(
        path => watchableKeyDefs.find(k => k.path === path) || { path, label: path }
      )
      await areaApi.saveBaseline(tenantId, areaKey, {
        resources,
        watchedKeys: watchedKeyObjects,
        label,
        resourceModes,
        resourceGroups,
        excludedResources,
      })
      showToast('Baseline saved', 'success')
      navigate(`/area/${tenantId}/${areaKey}`)
    } catch (err) {
      showToast(err.response?.data?.message || 'Save failed', 'error')
    } finally { setSaving(false) }
  }

  const deleteBaseline = async () => {
    if (!confirm('Delete this baseline? It will be archived and monitoring will stop until a new baseline is set.')) return
    setDeleting(true)
    try {
      await areaApi.deleteBaseline(tenantId, areaKey)
      showToast('Baseline deleted and archived', 'success')
      navigate(`/area/${tenantId}/${areaKey}`)
    } catch { showToast('Delete failed', 'error') }
    finally { setDeleting(false) }
  }

  if (!tenant || !area) return <div className="flex items-center justify-center h-full text-gray-600 text-sm">Loading…</div>

  const watchableKeys    = area.watchableKeys || []
  const allResourceList  = Object.entries(allResources)
  const includedList     = allResourceList.filter(([id]) => includedIds.has(id))
  const excludedList     = allResourceList.filter(([id]) => !includedIds.has(id))

  // Apply search filter to both lists
  const bsq = baselineSearch.toLowerCase()
  const filteredIncludedList = bsq
    ? includedList.filter(([id, res]) =>
        (res.displayName || '').toLowerCase().includes(bsq) || id.toLowerCase().includes(bsq))
    : includedList
  const filteredExcludedList = bsq
    ? excludedList.filter(([id, res]) =>
        (res.displayName || '').toLowerCase().includes(bsq) || id.toLowerCase().includes(bsq))
    : excludedList

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          {/* Breadcrumb back button */}
          <button onClick={() => navigate(`/area/${tenantId}/${areaKey}`)}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-brand-400 transition-colors mb-1 group">
            <ArrowLeft size={11} className="group-hover:-translate-x-0.5 transition-transform"/>
            <span>{tenant.display_name}</span>
            <ChevronRight size={10} className="text-gray-700"/>
            <span className="text-gray-600">{area.display_name}</span>
            <ChevronRight size={10} className="text-gray-700"/>
            <span className="text-gray-500">Baseline Editor</span>
          </button>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <BookMarked size={20} className="text-brand-500"/> Baseline Editor
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            Select resources to include. Choose monitoring mode per resource — defaulting to No Monitoring.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasExisting && (
            <button onClick={deleteBaseline} disabled={deleting}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg text-red-400 border border-red-900/50 bg-red-950/20 hover:bg-red-950/40 transition-colors">
              <Trash2 size={12}/> {deleting ? 'Deleting…' : 'Delete Baseline'}
            </button>
          )}
          <button onClick={loadFromLive} className="btn-secondary text-xs"><Download size={12}/> Reload from Live</button>
          <button onClick={save} disabled={saving || !!jsonError} className="btn-primary">
            <Save size={13}/> {saving ? 'Saving…' : 'Save Baseline'}
          </button>
        </div>
      </div>

      {/* Source notice */}
      {source === 'live' && (
        <div className="flex items-start gap-2 bg-blue-950/30 border border-blue-900/40 rounded-xl px-4 py-3 text-sm text-blue-300">
          <Info size={15} className="shrink-0 mt-0.5"/>
          <span><strong className="text-white">Live configuration loaded.</strong> All resources start in "Not in Baseline". Use <strong className="text-white">Select All</strong> to include everything, or click <strong className="text-white">+ Include</strong> on individual resources to monitor specific ones.</span>
        </div>
      )}
      {source === 'existing' && (
        <div className="flex items-start gap-2 bg-green-950/20 border border-green-900/40 rounded-xl px-4 py-3 text-sm text-green-300">
          <BookMarked size={15} className="shrink-0 mt-0.5"/>
          <span><strong className="text-white">Editing existing baseline.</strong> Previous version will be archived on save.</span>
        </div>
      )}
      {source === '' && (
        <div className="card text-center py-10">
          <AlertTriangle size={36} className="text-yellow-600 mx-auto mb-3"/>
          <p className="text-gray-400 mb-2">No live data available.</p>
          <p className="text-gray-600 text-sm mb-4">Pull live data from the area view first.</p>
          <button onClick={() => navigate(`/area/${tenantId}/${areaKey}`)} className="btn-secondary mx-auto">← Go to Area View</button>
        </div>
      )}

      {source !== '' && (
        <>
          {/* Tabs */}
          <div className="flex gap-0 border-b border-gray-800">
            {[['editor','Editor'],['history','Version History']].map(([key,lbl]) => (
              <button key={key} onClick={() => setActiveTab(key)}
                className={`px-4 py-2 text-sm transition-colors border-b-2 -mb-px
                  ${activeTab===key ? 'border-brand-500 text-white' : 'border-transparent text-gray-500 hover:text-gray-300'}`}>
                {lbl}
              </button>
            ))}
          </div>

          {activeTab === 'history' && (
            <HistoryTab tenantId={tenantId} areaKey={areaKey} showToast={showToast}
              onRestored={() => navigate(`/area/${tenantId}/${areaKey}`)}/>
          )}

          {activeTab === 'editor' && (
            <>
              {/* Baseline label */}
              <div className="flex items-center gap-3">
                <label className="text-sm text-gray-400 shrink-0">Baseline Label</label>
                <input className="input max-w-xs" value={label} onChange={e => setLabel(e.target.value)}
                  placeholder="e.g. Gold Standard – March 2026"/>
              </div>

              {/* Summary strip */}
              {allResourceList.length > 0 && (
                <div className="flex items-center gap-4 bg-gray-900/60 border border-gray-800 rounded-xl px-4 py-2.5 text-xs flex-wrap">
                  <span className="text-gray-400 font-medium">{includedList.length} of {allResourceList.length} in baseline</span>
                  <span className="text-gray-700">·</span>
                  <span className="flex items-center gap-1 text-violet-400"><Camera size={10}/> {includedList.filter(([id]) => resourceModes[id]==='snapshot').length} snapshot</span>
                  <span className="text-gray-700">·</span>
                  <span className="flex items-center gap-1 text-brand-400"><SlidersHorizontal size={10}/> {includedList.filter(([id]) => (resourceModes[id]||'properties')==='properties').length} properties</span>
                  {excludedList.length > 0 && (
                    <><span className="text-gray-700">·</span>
                    <span className="text-gray-600">{excludedList.length} not in baseline</span></>
                  )}
                </div>
              )}

              {/* Editor mode toggle */}
              <div className="flex items-center gap-1 bg-gray-900 border border-gray-800 rounded-lg p-1 w-fit">
                {[['visual', <Eye size={13}/>, 'Visual Editor'], ['json', <Code size={13}/>, 'Raw JSON']].map(([m, icon, lbl]) => (
                  <button key={m} onClick={() => setMode(m)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${mode===m ? 'bg-brand-700 text-white' : 'text-gray-400 hover:text-white'}`}>
                    {icon} {lbl}
                  </button>
                ))}
              </div>

              {mode === 'visual' && (
                <div className="space-y-4">

                  {/* ── Search bar ────────────────────────────────────────────── */}
                  {allResourceList.length > 4 && (
                    <div className="relative">
                      <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-600 pointer-events-none"/>
                      <input
                        className="input w-full pl-7 py-1.5 text-xs"
                        placeholder={`Search ${area.display_name} resources…`}
                        value={baselineSearch}
                        onChange={e => setBaselineSearch(e.target.value)}
                      />
                      {baselineSearch && (
                        <button onClick={() => setBaselineSearch('')}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400 transition-colors">
                          <X size={11}/>
                        </button>
                      )}
                    </div>
                  )}

                  {/* ── IN BASELINE ───────────────────────────────────────────── */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">In Baseline</span>
                      <span className="text-xs text-gray-700">
                        {baselineSearch ? `${filteredIncludedList.length} of ${includedList.length}` : `${includedList.length}`} resource{includedList.length!==1?'s':''}
                      </span>
                      <div className="flex-1 h-px bg-gray-800"/>
                      {/* Bulk selection controls */}
                      <button
                        onClick={() => {
                          setIncludedIds(new Set(allResourceList.map(([id]) => id)))
                          setResourceModes(prev => {
                            const next = { ...prev }
                            for (const [id] of allResourceList) { if (!next[id] || next[id] === 'none') next[id] = 'properties' }
                            return next
                          })
                        }}
                        className="text-xs text-gray-500 hover:text-brand-400 transition-colors px-1.5 py-0.5 rounded border border-gray-800 hover:border-brand-800/60">
                        Select All
                      </button>
                      <button
                        onClick={() => setIncludedIds(new Set())}
                        className="text-xs text-gray-500 hover:text-red-400 transition-colors px-1.5 py-0.5 rounded border border-gray-800 hover:border-red-900/60">
                        Deselect All
                      </button>
                    </div>

                    {includedList.length === 0 && (
                      <div className="card text-center py-6 text-gray-600 text-sm">
                        No resources in baseline. Use <strong className="text-gray-400">Select All</strong> or click <strong className="text-gray-400">+ Include</strong> on individual resources below.
                      </div>
                    )}
                    {includedList.length > 0 && filteredIncludedList.length === 0 && baselineSearch && (
                      <div className="card text-center py-4 text-gray-600 text-sm">
                        No baseline resources match <span className="text-gray-400">"{baselineSearch}"</span>
                      </div>
                    )}

                    {filteredIncludedList.map(([id, res]) => (
                      <BaselineResourceRow
                        key={id}
                        resourceId={id}
                        resource={res}
                        mode={resourceModes[id] || 'properties'}
                        onModeChange={m => {
                          if (m === 'none') {
                            // Choosing "Remove" moves to Not in Baseline
                            excludeResource(id)
                            setExpanded(e => ({ ...e, [id]: false }))
                          } else {
                            setResourceMode(id, m)
                          }
                        }}
                        watchableKeys={watchableKeys}
                        watchedKeysForResource={resourceWatchedKeys[id] || []}
                        expanded={!!expanded[id]}
                        onToggle={() => setExpanded(e => ({...e, [id]: !e[id]}))}
                        onFieldChange={(path, _, action) => {
                          if (action === 'toggle') toggleWatchedKeyForResource(id, path)
                        }}
                      />
                    ))}
                  </div>

                  {/* ── Resource Groups ───────────────────────────────────────── */}
                  {includedList.length > 0 && (
                    <GroupManager
                      resourceIds={includedList.map(([id]) => id)}
                      includedResources={allResources}
                      resourceGroups={resourceGroups}
                      onGroupsChange={setResourceGroups}
                    />
                  )}

                  {/* ── NOT IN BASELINE (excluded from baseline entirely) ─────── */}
                  {excludedList.length > 0 && (
                    <div>
                      <button onClick={() => setExcludedOpen(v => !v)}
                        className="flex items-center gap-2 w-full group mb-2">
                        <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Not in Baseline</span>
                        <span className="text-xs text-gray-700">
                          {baselineSearch ? `${filteredExcludedList.length} of ${excludedList.length}` : `${excludedList.length}`} resource{excludedList.length!==1?'s':''}
                        </span>
                        <div className="flex-1 h-px bg-gray-800/60"/>
                        {excludedOpen ? <ChevronDown size={12} className="text-gray-700"/> : <ChevronRight size={12} className="text-gray-700"/>}
                      </button>

                      {excludedOpen && (
                        <div className="space-y-1.5">
                          {filteredExcludedList.map(([id, res]) => (
                            <div key={id} className="flex items-center gap-2 border border-gray-800/50 rounded-xl px-3 py-2.5 bg-gray-900/20">
                              <button
                                onClick={() => {
                                  includeResource(id)
                                  setResourceMode(id, 'properties')
                                }}
                                title="Add to baseline"
                                className="shrink-0 flex items-center gap-1.5 text-xs text-gray-500 hover:text-brand-400 border border-gray-800 hover:border-brand-700/60 px-2 py-1 rounded transition-colors">
                                <Plus size={10}/> Include
                              </button>
                              <div className="flex-1 min-w-0">
                                <div className="text-sm text-gray-500 truncate">{res.displayName || id}</div>
                                <div className="text-xs text-gray-700 font-mono mt-0.5 truncate">{id}</div>
                              </div>
                            </div>
                          ))}
                          {filteredExcludedList.length === 0 && baselineSearch && (
                            <div className="text-xs text-gray-700 text-center py-2">
                              No excluded resources match "{baselineSearch}"
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {mode === 'json' && (
                <div>
                  <textarea
                    className={`w-full h-[500px] bg-gray-950 border rounded-xl p-4 text-xs font-mono text-gray-200 focus:outline-none focus:border-brand-500 resize-none ${jsonError ? 'border-red-700' : 'border-gray-700'}`}
                    value={jsonText} onChange={e => handleJsonChange(e.target.value)} spellCheck={false}/>
                  {jsonError && <p className="text-red-400 text-xs mt-2">JSON error: {jsonError}</p>}
                  <p className="text-gray-600 text-xs mt-2">Resources keyed by ID. Mode and per-resource configuration set in Visual Editor.</p>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
