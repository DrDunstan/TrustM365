import { useState, useEffect, useCallback } from 'react'
import {
  AlertTriangle, CheckCircle, Circle, RefreshCw, ChevronRight,
  Lock, Eye, ChevronDown, Settings, ToggleLeft, ToggleRight,
  GripVertical, Clock, Shield, ShieldAlert, X, RotateCw, ArrowLeft, FileText, KeyRound, Layers
} from 'lucide-react'
import { areaApi, tenantApi } from '../api/client.js'
import { usePollJob } from '../hooks/usePollJob.js'
import TenantInsights from '../components/TenantInsights.jsx'
import GenerateReportModal from '../components/GenerateReportModal.jsx'
import BaselineExportModal from '../components/BaselineExportModal.jsx'

// ── localStorage helpers ──────────────────────────────────────────────────────
function lsGet(key, fallback) {
  try { const v = localStorage.getItem(key); return v !== null ? JSON.parse(v) : fallback } catch { return fallback }
}
function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)) } catch {}
}

// ── Area grouping definition ──────────────────────────────────────────────────
// Security Defaults removed — not relevant for enterprise
const AREA_GROUPS = [
  {
    key: 'entra',
    label: 'Microsoft Entra ID',
    areaKeys: ['entra_roles', 'entra_users', 'entra_groups', 'entra_apps', 'entra_auth_policies', 'entra_ca'],
  },
  {
    key: 'intune',
    label: 'Microsoft Intune',
    areaKeys: [
      // Policy management (v1.0)
      'intune_compliance',
      'intune_config_profiles',
      'intune_update_rings',
      'intune_mtd_connectors',
      'intune_app_protection',
      // Endpoint Security (beta — Settings Catalog)
      'intune_ep_antivirus',
      'intune_ep_firewall',
      'intune_ep_disk_encryption',
      'intune_ep_asr',
    ],
  },
]

const STATUS_CONFIG = {
  clean:       { label: 'Clean',       Icon: CheckCircle  },
  drifted:     { label: 'Drifted',     Icon: AlertTriangle },
  unavailable: { label: 'Unavailable', Icon: Circle       },
  error:       { label: 'No Baseline', Icon: Circle       },
}

// ── Single area row ───────────────────────────────────────────────────────────
function AreaCard({ area, perm, syncing, onSync, onManage }) {
  const drift      = area.latestDrift
  const isLocked   = perm ? !perm.canRead  : false
  const isReadOnly = perm ?  perm.canRead && !perm.canWrite : false
  const isUnavail  = drift?.status === 'unavailable'
  const isSyncing  = syncing
  const hasBaseline = area.has_baseline

  // Treat "drifted with 0 count" the same as clean — this can occur immediately
  // after auto-restore inserts a fresh result before the UI re-polls
  const effectiveStatus = (drift?.status === 'drifted' && drift?.driftCount === 0)
    ? 'clean'
    : drift?.status

  const cfg  = isLocked ? { Icon: Lock }
             : STATUS_CONFIG[effectiveStatus] || STATUS_CONFIG.error
  const Icon = cfg.Icon

  const borderCls = isLocked                          ? 'border-gray-800/40 opacity-60'
                  : effectiveStatus === 'drifted'     ? 'border-red-900/60'
                  : effectiveStatus === 'clean'       ? 'border-green-900/40'
                  : !hasBaseline && !isUnavail        ? 'border-yellow-900/30'
                  : isUnavail                         ? 'border-gray-800/40 opacity-50'
                  : 'border-gray-800'

  // Status icon colour
  const iconCls = isLocked                          ? 'text-gray-700 border-gray-800 bg-gray-900'
                : effectiveStatus === 'drifted'     ? 'text-red-400  border-red-900/60  bg-red-950/30'
                : effectiveStatus === 'clean'       ? 'text-green-400 border-green-900/60 bg-green-950/20'
                : 'text-gray-600 border-gray-800 bg-gray-900'

  return (
    <div className={`card border transition-opacity ${borderCls}`}>
      <div className="flex items-center gap-4">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center border shrink-0 ${iconCls}`}>
          <Icon size={17}/>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`font-semibold text-sm ${isLocked || isUnavail ? 'text-gray-500' : 'text-white'}`}>
              {area.display_name}
            </span>

            {/* Status badges */}
            {isLocked && (
              <span className="text-xs bg-gray-900 text-gray-600 border border-gray-700 px-1.5 py-0.5 rounded">
                Locked
              </span>
            )}
            {isReadOnly && !isLocked && (
              <span className="text-xs bg-yellow-950/30 text-yellow-600 border border-yellow-900/50 px-1.5 py-0.5 rounded flex items-center gap-1">
                <Eye size={10}/> Read only
              </span>
            )}
            {isUnavail && !isLocked && (
              <span className="text-xs bg-gray-800 text-gray-500 border border-gray-700 px-1.5 py-0.5 rounded">
                Licence required
              </span>
            )}
            {!hasBaseline && !isUnavail && !isLocked && (
              <span className="text-xs bg-yellow-900/20 text-yellow-500 border border-yellow-800/60 px-1.5 py-0.5 rounded">
                No baseline
              </span>
            )}
            {/* Drift count pill — only shown when genuinely drifted with count > 0 */}
            {effectiveStatus === 'drifted' && (drift?.driftCount ?? 0) > 0 && (
              <span className="text-xs bg-red-900/40 text-red-400 border border-red-900 px-1.5 py-0.5 rounded font-semibold">
                {drift.driftCount} drift{drift.driftCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          <p className={`text-xs mt-0.5 truncate ${isLocked || isUnavail ? 'text-gray-700' : 'text-gray-500'}`}>
            {area.description}
          </p>

          {/* Missing read permissions */}
          {isLocked && perm?.missingRead?.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {perm.missingRead.map(p => (
                <code key={p} className="text-xs bg-gray-800 border border-gray-700 text-gray-500 px-1.5 py-0.5 rounded font-mono">{p}</code>
              ))}
            </div>
          )}

          {drift && !isUnavail && !isLocked && (
            <p className="text-xs text-gray-700 mt-0.5">
              Last checked {new Date(drift.checkedAt).toLocaleString()}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {isLocked ? (
            <span className="text-xs text-gray-700 flex items-center gap-1"><Lock size={10}/> Add permission</span>
          ) : !isUnavail && (
            <>
              <button onClick={onSync} disabled={isSyncing} className="btn-secondary text-xs">
                <RefreshCw size={12} className={isSyncing ? 'animate-spin' : ''}/>
                {isSyncing ? 'Syncing…' : 'Sync'}
              </button>
              <button onClick={onManage} className="btn-primary text-xs">
                Manage <ChevronRight size={12}/>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Group section ─────────────────────────────────────────────────────────────
function AreaGroup({ group, areas, permMap, syncing, onSync, onManage, navigate, tenantId, defaultOpen = true, onCollapseToggle }) {
  const [open, setOpen] = useState(defaultOpen)

  const handleToggle = () => {
    setOpen(v => !v)
    onCollapseToggle?.()
  }
  const groupAreas = areas.filter(a => group.areaKeys.includes(a.area_key))
  if (groupAreas.length === 0) return null

  // Use effectiveStatus — treat drifted+0 same as clean (post-auto-restore race)
  const effectiveDriftedCount = groupAreas.filter(a => {
    const s = a.latestDrift?.status
    const c = a.latestDrift?.driftCount ?? 0
    return s === 'drifted' && c > 0
  }).length
  const totalDrift = groupAreas.reduce((sum, a) => {
    const s = a.latestDrift?.status
    const c = a.latestDrift?.driftCount ?? 0
    return s === 'drifted' && c > 0 ? sum + c : sum
  }, 0)

  return (
    <div className="space-y-2">
      <button
        onClick={handleToggle}
        className="flex items-center gap-2 w-full group">
        <GripVertical size={12} className="text-gray-700 group-hover:text-gray-500 transition-colors cursor-grab shrink-0" title="Drag to reorder"/>
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{group.label}</span>
        {effectiveDriftedCount > 0 && (
          <span className="text-xs bg-red-900/40 text-red-400 border border-red-900/60 px-1.5 py-0.5 rounded font-semibold">
            {totalDrift} drift{totalDrift !== 1 ? 's' : ''}
          </span>
        )}
        <div className="flex-1 h-px bg-gray-800"/>
        {open
          ? <ChevronDown  size={12} className="text-gray-600 group-hover:text-gray-400 transition-colors"/>
          : <ChevronRight size={12} className="text-gray-600 group-hover:text-gray-400 transition-colors"/>}
      </button>

      {open && (
        <div className="space-y-2">
          {groupAreas.map(area => (
            <AreaCard
              key={area.area_key}
              area={area}
              perm={permMap[area.area_key]}
              syncing={syncing[area.area_key]}
              onSync={() => onSync(area)}
              onManage={() => onManage(area)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Dashboard({ selectedTenant, navigate, showToast }) {
  const [areas,        setAreas]        = useState([])
  const [syncing,      setSyncing]      = useState({})
  const [permMap,      setPermMap]      = useState({})
  const { poll } = usePollJob()

  // Item 1 — per-tenant drift interval settings
  const [tenantSettings, setTenantSettings] = useState({ driftCheckAuto: false, driftIntervalMinutes: 60 })
  const [savingSettings, setSavingSettings] = useState(false)
  const [showSettings,   setShowSettings]   = useState(false)

  // Item 2 — auto-restore panel
  const [showAutoRestore, setShowAutoRestore] = useState(false)
  const [togglingAR, setTogglingAR] = useState({})

  // Auth failure banner — credential rotation
  const [showRotateForm, setShowRotateForm] = useState(false)
  const [newSecret,      setNewSecret]      = useState('')
  const [rotatingCreds,  setRotatingCreds]  = useState(false)

  // Permission re-check
  const [recheckingPerms, setRecheckingPerms] = useState(false)

  const recheckPermissions = async () => {
    setRecheckingPerms(true)
    try {
      const data = await tenantApi.refreshPermissions(selectedTenant.id)
      const map = {}
      for (const a of (data.areas || [])) map[a.areaKey] = a
      setPermMap(map)
      // Refresh tenant list so permissions_checked_at updates in sidebar
      window.dispatchEvent(new CustomEvent('trustm365:tenants-changed'))
      showToast(data.message || 'Permissions updated', 'success')
    } catch (err) {
      showToast(err.response?.data?.error || 'Permission re-check failed', 'error')
    } finally {
      setRecheckingPerms(false)
    }
  }

  // Auto-restore activity notices — shown as dismissable banners above the area cards
  const [autoRestoreNotices, setAutoRestoreNotices] = useState([])
  const [showReportModal,        setShowReportModal]        = useState(false)
  const [showBaselineExportModal, setShowBaselineExportModal] = useState(false)

  const addAutoRestoreNotice = (areaName, result) => {
    const id = `${Date.now()}-${Math.random()}`
    setAutoRestoreNotices(prev => [...prev, { id, areaName, result, ts: new Date() }])
    // Auto-dismiss after 30 seconds — long enough to read but self-cleaning
    setTimeout(() => {
      setAutoRestoreNotices(prev => prev.filter(n => n.id !== id))
    }, 30000)
  }

  const dismissNotice = (id) => {
    setAutoRestoreNotices(prev => prev.filter(n => n.id !== id))
  }

  // Item 3 — group ordering + collapse preferences (localStorage)
  const [groupOrder,     setGroupOrder]     = useState(() => lsGet('trustm365_group_order', null))
  const [groupCollapsed, setGroupCollapsed] = useState(() => lsGet('trustm365_group_collapsed', {}))
  const [dragOver,       setDragOver]       = useState(null)
  const [dragging,       setDragging]       = useState(null)

  const loadAreas = () => {
    if (!selectedTenant) return
    areaApi.list(selectedTenant.id).then(setAreas).catch(() => {})
  }

  // Apply the ReadWrite→Read implication to a permission map entry.
  // If the stored permissions_json predates this logic, correct it here.
  const applyImpliedRead = (areas, granted) => {
    if (!granted?.length) return areas
    const grantedSet = new Set(granted)
    for (const p of Array.from(grantedSet)) {
      if (p.includes('.ReadWrite.')) grantedSet.add(p.replace('.ReadWrite.', '.Read.'))
      if (p.includes('ReadWrite'))   grantedSet.add(p.replace('ReadWrite', 'Read'))
    }
    return areas.map(a => ({
      ...a,
      canRead:      (a.readPermissions  || []).every(p => grantedSet.has(p)),
      canWrite:     (a.writePermissions || []).every(p => grantedSet.has(p)),
      missingRead:  (a.readPermissions  || []).filter(p => !grantedSet.has(p)),
      missingWrite: (a.writePermissions || []).filter(p => !grantedSet.has(p)),
    }))
  }

  const loadPermissions = (permJson) => {
    const json = permJson || selectedTenant?.permissions_json
    if (json) {
      try {
        const parsed = JSON.parse(json)
        const corrected = applyImpliedRead(parsed.areas || [], parsed.granted || [])
        const map = {}
        for (const a of corrected) map[a.areaKey] = a
        setPermMap(map)
        return
      } catch {}
    }
    tenantApi.getPermissions(selectedTenant.id)
      .then(data => {
        const map = {}
        for (const a of (data.areas || [])) map[a.areaKey] = a
        setPermMap(map)
      })
      .catch(() => {})
  }

  useEffect(() => { loadAreas(); loadPermissions() }, [selectedTenant])

  // Item 1 — sync tenant settings into local state when tenant changes
  useEffect(() => {
    if (!selectedTenant) return
    setTenantSettings({
      driftCheckAuto:      selectedTenant.drift_check_auto === 1,
      driftIntervalMinutes: selectedTenant.drift_interval_minutes || 60,
    })
  }, [selectedTenant])

  const saveTenantSettings = async () => {
    setSavingSettings(true)
    try {
      await tenantApi.updateSettings(selectedTenant.id, tenantSettings)
      showToast('Drift check settings saved', 'success')
      setShowSettings(false)
    } catch { showToast('Failed to save settings', 'error') }
    finally { setSavingSettings(false) }
  }

  // Item 2 — toggle auto-restore for a single area
  const toggleAreaAutoRestore = async (area, enable) => {
    setTogglingAR(t => ({ ...t, [area.area_key]: true }))
    try {
      await areaApi.setAutoRestore(selectedTenant.id, area.area_key, enable)
      loadAreas()
      showToast(`Auto-restore ${enable ? 'enabled' : 'disabled'} for ${area.display_name}`, 'success')
    } catch { showToast('Failed to update auto-restore', 'error') }
    finally { setTogglingAR(t => ({ ...t, [area.area_key]: false })) }
  }

  const toggleAllAutoRestore = async (enable) => {
    const baselinedAreas = areas.filter(a => a.has_baseline)
    for (const area of baselinedAreas) {
      await toggleAreaAutoRestore(area, enable)
    }
  }

  // Item 3 — group ordering drag handlers
  const ORDERED_GROUPS = (() => {
    if (!groupOrder) return AREA_GROUPS
    const ordered = [...groupOrder.map(k => AREA_GROUPS.find(g => g.key === k)).filter(Boolean)]
    AREA_GROUPS.forEach(g => { if (!ordered.find(o => o.key === g.key)) ordered.push(g) })
    return ordered
  })()

  const handleDragStart = (key) => setDragging(key)
  const handleDragOver  = (e, key) => { e.preventDefault(); setDragOver(key) }
  const handleDrop      = (targetKey) => {
    if (!dragging || dragging === targetKey) { setDragging(null); setDragOver(null); return }
    const keys = ORDERED_GROUPS.map(g => g.key)
    const from = keys.indexOf(dragging)
    const to   = keys.indexOf(targetKey)
    const next = [...keys]
    next.splice(from, 1)
    next.splice(to, 0, dragging)
    setGroupOrder(next)
    lsSet('trustm365_group_order', next)
    setDragging(null)
    setDragOver(null)
  }

  const toggleGroupCollapse = (key) => {
    setGroupCollapsed(prev => {
      const next = { ...prev, [key]: !prev[key] }
      lsSet('trustm365_group_collapsed', next)
      return next
    })
  }

  const pullAndCheck = async (area) => {
    if (!selectedTenant) return
    setSyncing(s => ({ ...s, [area.area_key]: true }))
    try {
      const { jobId } = await areaApi.pull(selectedTenant.id, area.area_key)
      poll(
        jobId,
        // onComplete
        (jobResult) => {
          setSyncing(s => ({ ...s, [area.area_key]: false }))
          loadAreas()
          if (jobResult?.updatedPermissions) loadPermissions(JSON.stringify(jobResult.updatedPermissions))
          // Show auto-restore notice if the sync triggered one
          const ar = jobResult?.driftResult?.autoRestoreResult
          if (ar && ar.attempted > 0) {
            addAutoRestoreNotice(area.display_name, ar)
          }
        },
        // onError
        (err) => {
          setSyncing(s => ({ ...s, [area.area_key]: false }))
          showToast(`${area.display_name}: ${err}`, 'error')
        },
        // onUnavailable — not an error, just no licence; stop the spinner silently
        () => {
          setSyncing(s => ({ ...s, [area.area_key]: false }))
          loadAreas()
        }
      )
    } catch (err) {
      setSyncing(s => ({ ...s, [area.area_key]: false }))
      showToast(err.response?.data?.message || `${area.display_name} sync failed`, 'error')
    }
  }

  const pullAll = async () => {
    if (!areas.length) return
    await Promise.all(areas.map(area => pullAndCheck(area)))
    showToast(`Syncing ${areas.length} area${areas.length !== 1 ? 's' : ''}…`, 'info')
  }

  if (!selectedTenant) return (
    <div className="flex flex-col items-center justify-center h-full text-center p-8">
      <svg width="72" height="72" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg" className="mb-4 drop-shadow-lg">
        <defs>
          <linearGradient id="es-stroke" x1="100" y1="10" x2="100" y2="185" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#818cf8"/>
            <stop offset="100%" stopColor="#6d28d9"/>
          </linearGradient>
          <linearGradient id="es-fill" x1="100" y1="10" x2="100" y2="185" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#312e81" stopOpacity="0.55"/>
            <stop offset="100%" stopColor="#1e1b4b" stopOpacity="0.25"/>
          </linearGradient>
          <linearGradient id="es-line" x1="30" y1="0" x2="170" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0%"   stopColor="#34d399"/>
            <stop offset="44%"  stopColor="#34d399"/>
            <stop offset="56%"  stopColor="#f87171"/>
            <stop offset="72%"  stopColor="#f87171"/>
            <stop offset="86%"  stopColor="#34d399"/>
            <stop offset="100%" stopColor="#34d399"/>
          </linearGradient>
          <filter id="es-glow">
            <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <filter id="es-dot">
            <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>
        <path d="M100 18 L174 47 C174 47 174 112 174 120 C174 153 139 174 100 186 C61 174 26 153 26 120 C26 112 26 47 26 47 Z"
          fill="url(#es-fill)" stroke="url(#es-stroke)" strokeWidth="5" strokeLinejoin="round"/>
        <line x1="38" y1="114" x2="162" y2="114" stroke="#34d399" strokeWidth="1.5" strokeDasharray="5 4" opacity="0.25"/>
        <polyline points="38,114 72,114 88,80 104,114 162,114"
          stroke="url(#es-line)" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" filter="url(#es-glow)"/>
        <circle cx="38" cy="114" r="5" fill="#34d399" opacity="0.9"/>
        <circle cx="88" cy="80" r="7" fill="#f87171" filter="url(#es-dot)"/>
        <circle cx="162" cy="114" r="5.5" fill="#34d399"/>
      </svg>
      <h1 className="text-2xl font-bold text-white mb-2">Trust<span className="text-indigo-400">M365</span></h1>
      <p className="text-gray-400 max-w-sm mb-6">
        Monitor your M365 tenant configuration against a gold-standard baseline.
        Get alerted the moment anything drifts.
      </p>
      <button onClick={() => navigate('/add-tenant')} className="btn-primary">Add Your First Tenant</button>
    </div>
  )

  // Apply the same effective-status rule everywhere: drifted+0-count = clean
  const drifted    = areas.filter(a =>
    a.latestDrift?.status === 'drifted' && (a.latestDrift?.driftCount || 0) > 0
  )
  const clean      = areas.filter(a =>
    a.latestDrift?.status === 'clean' ||
    (a.latestDrift?.status === 'drifted' && (a.latestDrift?.driftCount || 0) === 0)
  )
  const noBaseline = areas.filter(a => !a.has_baseline && a.latestDrift?.status !== 'unavailable')
  const noCheck    = areas.filter(a => a.has_baseline && !a.latestDrift)

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">

      {/* ── Auth failure banner ──────────────────────────────────────────────── */}
      {(() => {
        if (!selectedTenant.last_sync_error) return null
        let syncErr = null
        try { syncErr = JSON.parse(selectedTenant.last_sync_error) } catch { return null }
        if (!syncErr) return null

        const msgs = {
          auth: {
            title: 'Authentication failed — client secret may have expired',
            body: 'TrustM365 could not authenticate with Microsoft Graph. This usually means the App Registration client secret has expired or been deleted. Enter a new secret below to restore monitoring.',
            action: 'Update Secret',
            color: 'red',
          },
          permission: {
            title: 'Permission denied — a required Graph permission is missing',
            body: 'The App Registration is missing a required permission. Check that admin consent has been granted for all required permissions in Entra ID.',
            action: null,
            color: 'yellow',
          },
          network: {
            title: 'Network error — could not reach Microsoft Graph',
            body: 'TrustM365 could not connect to the Microsoft Graph API. This may be a transient network issue. The next scheduled sync will retry automatically.',
            action: null,
            color: 'yellow',
          },
          unknown: {
            title: 'Last sync failed',
            body: syncErr.message || 'An unexpected error occurred during the last sync. Check the server logs for details.',
            action: null,
            color: 'yellow',
          },
        }
        const info = msgs[syncErr.type] || msgs.unknown
        const colors = info.color === 'red'
          ? { border: 'border-red-900/60', bg: 'bg-red-950/20', title: 'text-red-300', body: 'text-red-400/80', icon: 'text-red-400' }
          : { border: 'border-yellow-900/60', bg: 'bg-yellow-950/20', title: 'text-yellow-300', body: 'text-yellow-400/80', icon: 'text-yellow-400' }

        return (
          <div className={`rounded-xl border ${colors.border} ${colors.bg} px-4 py-3 space-y-2`}>
            <div className="flex items-start gap-3">
              <AlertTriangle size={15} className={`${colors.icon} shrink-0 mt-0.5`}/>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${colors.title}`}>{info.title}</p>
                <p className={`text-xs mt-0.5 ${colors.body}`}>{info.body}</p>
                {selectedTenant.last_sync_error_at && (
                  <p className="text-xs text-gray-700 mt-1">
                    Last failed: {new Date(selectedTenant.last_sync_error_at).toLocaleString()}
                  </p>
                )}
              </div>
              {info.action && (
                <button onClick={() => setShowRotateForm(v => !v)}
                  className="btn-secondary text-xs shrink-0">
                  {info.action}
                </button>
              )}
            </div>

            {/* Inline credential rotation form */}
            {showRotateForm && syncErr.type === 'auth' && (
              <div className="mt-2 pt-3 border-t border-red-900/40 flex items-end gap-2">
                <div className="flex-1">
                  <label className="text-xs text-gray-500 mb-1 block">New Client Secret Value</label>
                  <input
                    type="password"
                    className="input w-full text-sm"
                    placeholder="Paste the new secret value from Entra…"
                    value={newSecret}
                    onChange={e => setNewSecret(e.target.value)}
                    autoComplete="new-password"
                  />
                </div>
                <button
                  disabled={!newSecret.trim() || rotatingCreds}
                  onClick={async () => {
                    setRotatingCreds(true)
                    try {
                      await tenantApi.rotateCredentials(selectedTenant.id, { clientSecret: newSecret.trim() })
                      setNewSecret('')
                      setShowRotateForm(false)
                      showToast('Credentials updated — monitoring restored', 'success')
                      // Force tenant list refresh to clear the error banner
                      window.dispatchEvent(new CustomEvent('trustm365:tenants-changed'))
                    } catch (err) {
                      showToast(err.response?.data?.error || 'Credential update failed', 'error')
                    } finally { setRotatingCreds(false) }
                  }}
                  className="btn-primary text-xs shrink-0">
                  {rotatingCreds ? 'Validating…' : 'Save & Validate'}
                </button>
                <button onClick={() => { setShowRotateForm(false); setNewSecret('') }}
                  className="btn-secondary text-xs shrink-0">
                  Cancel
                </button>
              </div>
            )}
          </div>
        )
      })()}

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">{selectedTenant.display_name}</h1>
          <p className="text-gray-500 text-xs mt-0.5">{selectedTenant.tenant_id}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Item 2 — auto-restore toggle */}
          <button onClick={() => setShowAutoRestore(v => !v)}
            title="Auto-Restore settings"
            className={`btn-secondary ${showAutoRestore ? 'border-brand-700/60 text-brand-300' : ''}`}>
            <Shield size={13}/> Auto-Restore
          </button>
          {/* Item 1 — settings cog (drift + app registration) */}
          <button onClick={() => setShowSettings(v => !v)}
            title="Tenant settings"
            className={`btn-secondary ${showSettings ? 'border-brand-700/60 text-brand-300' : ''}`}>
            <Settings size={13}/>
          </button>
          <button onClick={() => setShowReportModal(true)} className="btn-secondary">
            <FileText size={13}/> Report
          </button>
          <button onClick={() => setShowBaselineExportModal(true)} className="btn-secondary">
            <Layers size={13}/> Baseline Export
          </button>
          <button onClick={pullAll} className="btn-secondary">
            <RefreshCw size={14}/> Sync All
          </button>
        </div>
      </div>

      {/* ── Settings panel: Drift + App Registration ────────────────────── */}
      {showSettings && (
        <div className="card border-brand-700/30 divide-y divide-gray-800">

          {/* ── Section: Drift Settings ─────────────────────────────────── */}
          <div className="space-y-4 pb-5">
            <div className="flex items-center gap-2 pt-1">
              <Clock size={13} className="text-brand-400 shrink-0"/>
              <h3 className="text-xs font-semibold text-brand-300 uppercase tracking-wider">Drift Settings</h3>
              <span className="text-xs text-gray-700 ml-auto">Per-tenant</span>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-white font-medium">Automatic drift checks</div>
                <div className="text-xs text-gray-500 mt-0.5">Schedule regular syncs, independent of the global interval</div>
              </div>
              <button onClick={() => setTenantSettings(s => ({ ...s, driftCheckAuto: !s.driftCheckAuto }))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${tenantSettings.driftCheckAuto ? 'bg-brand-500' : 'bg-gray-700'}`}>
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${tenantSettings.driftCheckAuto ? 'translate-x-6' : 'translate-x-1'}`}/>
              </button>
            </div>

            {tenantSettings.driftCheckAuto && (
              <div className="space-y-2 pl-1">
                <label className="text-xs text-gray-400 font-medium">Check interval (minutes)</label>
                <div className="flex items-center gap-3">
                  <input type="number" min={5} max={1440} className="input w-28"
                    value={tenantSettings.driftIntervalMinutes}
                    onChange={e => setTenantSettings(s => ({
                      ...s, driftIntervalMinutes: Math.max(5, Math.min(1440, parseInt(e.target.value) || 60))
                    }))}
                  />
                  <span className="text-xs text-gray-600">5 min – 1440 min (24 hrs)</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {[15, 30, 60, 120, 360].map(m => (
                    <button key={m}
                      onClick={() => setTenantSettings(s => ({ ...s, driftIntervalMinutes: m }))}
                      className={`text-xs px-2.5 py-1 rounded border transition-colors
                        ${tenantSettings.driftIntervalMinutes === m
                          ? 'border-brand-600 bg-brand-950/40 text-brand-300'
                          : 'border-gray-700 text-gray-500 hover:border-gray-600 hover:text-gray-300'}`}>
                      {m < 60 ? `${m}m` : `${m/60}h`}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {!tenantSettings.driftCheckAuto && (
              <p className="text-xs text-gray-600 pl-1">
                Auto-check disabled. Use <strong className="text-gray-400">Sync All</strong> or the
                global <code className="bg-gray-800 px-1 rounded text-gray-400">DRIFT_CHECK_INTERVAL_MINUTES</code> env var.
              </p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setShowSettings(false)} className="btn-secondary text-xs">Cancel</button>
              <button onClick={saveTenantSettings} disabled={savingSettings} className="btn-primary text-xs">
                {savingSettings ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>

          {/* ── Section: App Registration ───────────────────────────────── */}
          <div className="space-y-4 pt-5">
            <div className="flex items-center gap-2">
              <ShieldAlert size={13} className="text-brand-400 shrink-0"/>
              <h3 className="text-xs font-semibold text-brand-300 uppercase tracking-wider">App Registration</h3>
            </div>

            {/* Client Secret rotation */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-white font-medium flex items-center gap-1.5">
                    <KeyRound size={12} className="text-gray-500"/> Client Secret
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">Rotate the App Registration secret — validates before saving</div>
                </div>
                <button onClick={() => setShowRotateForm(v => !v)}
                  className={`btn-secondary text-xs shrink-0 ${showRotateForm ? 'border-brand-700/60 text-brand-300' : ''}`}>
                  {showRotateForm ? 'Cancel' : 'Update Secret'}
                </button>
              </div>
              {showRotateForm && (
                <div className="flex items-end gap-2 pt-1">
                  <div className="flex-1">
                    <label className="text-xs text-gray-500 mb-1 block">New Client Secret Value</label>
                    <input type="password" className="input w-full text-sm"
                      placeholder="Paste the new secret value from Entra…"
                      value={newSecret} onChange={e => setNewSecret(e.target.value)}
                      autoComplete="new-password"/>
                  </div>
                  <button disabled={!newSecret.trim() || rotatingCreds}
                    onClick={async () => {
                      setRotatingCreds(true)
                      try {
                        await tenantApi.rotateCredentials(selectedTenant.id, { clientSecret: newSecret.trim() })
                        setNewSecret(''); setShowRotateForm(false); setShowSettings(false)
                        showToast('Credentials updated — monitoring restored', 'success')
                        window.dispatchEvent(new CustomEvent('trustm365:tenants-changed'))
                      } catch (err) {
                        showToast(err.response?.data?.error || 'Credential update failed', 'error')
                      } finally { setRotatingCreds(false) }
                    }}
                    className="btn-primary text-xs shrink-0">
                    {rotatingCreds ? 'Validating…' : 'Save & Validate'}
                  </button>
                </div>
              )}
            </div>

            {/* Permission sync */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-white font-medium flex items-center gap-1.5">
                  <RefreshCw size={12} className="text-gray-500"/> Permission Sync
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  Re-check granted permissions from Entra ID — unlocks newly consented areas
                </div>
              </div>
              <button onClick={async () => {
                  setRecheckingPerms(true)
                  try {
                    const data = await tenantApi.refreshPermissions(selectedTenant.id)
                    const map = {}
                    for (const a of (data.areas || [])) map[a.areaKey] = a
                    setPermMap(map)
                    setShowSettings(false)
                    window.dispatchEvent(new CustomEvent('trustm365:tenants-changed'))
                    showToast(data.message || 'Permissions updated', 'success')
                  } catch (err) {
                    showToast(err.response?.data?.error || 'Permission sync failed', 'error')
                  } finally { setRecheckingPerms(false) }
                }}
                disabled={recheckingPerms}
                className="btn-secondary text-xs shrink-0">
                <RefreshCw size={11} className={recheckingPerms ? 'animate-spin' : ''}/>
                {recheckingPerms ? 'Syncing…' : 'Sync Permissions'}
              </button>
            </div>
          </div>

        </div>
      )}

      {/* ── Item 2: Auto-restore overview panel ──────────────────────────── */}
      {showAutoRestore && (
        <div className="card border-brand-700/30 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Shield size={14} className="text-brand-400"/>
              <h2 className="text-sm font-semibold text-white">Auto-Restore</h2>
              <span className="text-xs text-gray-600">— per area</span>
            </div>
            <div className="flex items-center gap-2">
              {areas.filter(a => a.has_baseline).length > 0 && (
                <>
                  <button onClick={() => toggleAllAutoRestore(true)}
                    className="text-xs text-brand-400 border border-brand-800/60 hover:bg-brand-950/30 px-2.5 py-1 rounded transition-colors">
                    Enable All
                  </button>
                  <button onClick={() => toggleAllAutoRestore(false)}
                    className="text-xs text-gray-500 border border-gray-700 hover:border-gray-600 px-2.5 py-1 rounded transition-colors">
                    Disable All
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="flex items-start gap-2 bg-amber-950/20 border border-amber-900/40 rounded-lg px-3 py-2 text-xs text-amber-300">
            <AlertTriangle size={11} className="shrink-0 mt-0.5"/>
            When enabled, drift detected on any sync is automatically reverted — including intentional changes. Update the baseline before enabling.
          </div>

          {areas.filter(a => a.has_baseline).length === 0 ? (
            <p className="text-xs text-gray-600">No baselines set yet. Set a baseline on an area first.</p>
          ) : (
            <div className="space-y-1.5">
              {areas.filter(a => a.has_baseline).map(area => {
                const isOn = area.auto_restore === 1
                const busy = togglingAR[area.area_key]
                return (
                  <div key={area.area_key}
                    className={`flex items-center justify-between px-3 py-2.5 rounded-lg border transition-colors
                      ${isOn ? 'border-brand-700/40 bg-brand-950/10' : 'border-gray-800'}`}>
                    <div className="min-w-0">
                      <span className="text-sm text-white font-medium">{area.display_name}</span>
                      {area.latestDrift && (() => {
                        const s  = area.latestDrift.status
                        const dc = area.latestDrift.driftCount || 0
                        const eff = (s === 'drifted' && dc === 0) ? 'clean' : s
                        return (
                          <span className={`ml-2 text-xs ${
                            eff === 'drifted' ? 'text-red-400'
                            : eff === 'clean' ? 'text-green-400'
                            : 'text-gray-600'}`}>
                            {eff}
                          </span>
                        )
                      })()}
                    </div>
                    <button
                      onClick={() => toggleAreaAutoRestore(area, !isOn)}
                      disabled={busy}
                      className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border shrink-0 transition-colors
                        ${isOn
                          ? 'border-brand-700/60 text-brand-300 bg-brand-950/30 hover:bg-gray-800 hover:text-gray-300 hover:border-gray-700'
                          : 'border-gray-700 text-gray-500 hover:border-brand-700/60 hover:text-brand-300'}`}>
                      {busy ? <RefreshCw size={11} className="animate-spin"/>
                        : isOn ? <ToggleRight size={13}/>
                        : <ToggleLeft size={13}/>}
                      {busy ? '…' : isOn ? 'Enabled' : 'Disabled'}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Auto-restore activity notices ─────────────────────────────────── */}
      {autoRestoreNotices.length > 0 && (
        <div className="space-y-2">
          {autoRestoreNotices.map(({ id, areaName, result, ts }) => {
            const allOk    = result.failed === 0
            const allFailed = result.succeeded === 0
            return (
              <div key={id}
                className={`rounded-xl border px-4 py-3 flex items-start gap-3
                  ${allOk
                    ? 'bg-green-950/20 border-green-900/50'
                    : allFailed
                    ? 'bg-red-950/20 border-red-900/50'
                    : 'bg-yellow-950/20 border-yellow-900/50'}`}>
                <ShieldAlert size={16} className={`shrink-0 mt-0.5
                  ${allOk ? 'text-green-400' : allFailed ? 'text-red-400' : 'text-yellow-400'}`}/>
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-sm font-semibold
                      ${allOk ? 'text-green-300' : allFailed ? 'text-red-300' : 'text-yellow-300'}`}>
                      Auto-Restore — {areaName}
                    </span>
                    <span className="text-xs text-gray-600">
                      {ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400">
                    Drift was detected and auto-restore was triggered.{' '}
                    {allOk
                      ? `${result.succeeded} resource${result.succeeded !== 1 ? 's' : ''} successfully restored to baseline.`
                      : allFailed
                      ? `${result.failed} resource${result.failed !== 1 ? 's' : ''} could not be restored — check the Restore Log for details.`
                      : `${result.succeeded} restored · ${result.failed} failed — check the Restore Log for details.`
                    }
                  </p>
                  {result.resources.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                      {result.resources.map((r, i) => (
                        <span key={i}
                          className={`text-xs px-2 py-0.5 rounded border flex items-center gap-1
                            ${r.status === 'restored'
                              ? 'bg-green-950/30 border-green-900/40 text-green-400'
                              : 'bg-red-950/30 border-red-900/40 text-red-400'}`}>
                          {r.status === 'restored'
                            ? <CheckCircle size={9}/>
                            : <AlertTriangle size={9}/>}
                          {r.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <button onClick={() => dismissNotice(id)}
                  className="shrink-0 text-gray-600 hover:text-gray-300 transition-colors p-0.5">
                  <X size={14}/>
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Tenant insights — Groups, Apps, MFA, Auth Methods, Users, Devices */}
      <TenantInsights tenant={selectedTenant} showToast={showToast}/>

      {/* Summary strip */}
      <div>
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Baseline Status</h2>
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Drifted',     value: drifted.length,    color: drifted.length > 0 ? 'text-red-400' : 'text-gray-400',  border: drifted.length > 0 ? 'border-red-900/60 bg-red-950/10' : '' },
            { label: 'Clean',       value: clean.length,      color: 'text-green-400',  border: '' },
            { label: 'No Baseline', value: noBaseline.length, color: 'text-yellow-400', border: '' },
            { label: 'Unchecked',   value: noCheck.length,    color: 'text-gray-400',   border: '' },
          ].map(({ label, value, color, border }) => (
            <div key={label} className={`card-sm text-center border ${border || 'border-gray-800'}`}>
              <div className={`text-2xl font-bold ${color}`}>{value}</div>
              <div className="text-xs text-gray-500 mt-0.5">{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Item 3: Grouped area cards — draggable order, collapse persisted ─ */}
      <div className="space-y-1">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Resource Areas</h2>
          {groupOrder && (
            <button onClick={() => { setGroupOrder(null); lsSet('trustm365_group_order', null) }}
              className="text-xs text-gray-600 hover:text-gray-400 transition-colors">
              Reset order
            </button>
          )}
        </div>
        <p className="text-xs text-gray-700 mb-3">Drag groups to reorder · Click header to collapse</p>
      </div>

      <div className="space-y-5">
        {ORDERED_GROUPS.map(group => (
          <div key={group.key}
            draggable
            onDragStart={() => handleDragStart(group.key)}
            onDragOver={e => handleDragOver(e, group.key)}
            onDrop={() => handleDrop(group.key)}
            onDragEnd={() => { setDragging(null); setDragOver(null) }}
            className={`transition-opacity ${
              dragging === group.key ? 'opacity-40' : ''
            } ${dragOver === group.key && dragging !== group.key ? 'ring-2 ring-brand-600/40 rounded-xl' : ''}`}>
            <AreaGroup
              key={group.key}
              group={group}
              areas={areas}
              permMap={permMap}
              syncing={syncing}
              onSync={pullAndCheck}
              onManage={(area) => navigate(`/area/${selectedTenant.id}/${area.area_key}`)}
              navigate={navigate}
              tenantId={selectedTenant.id}
              defaultOpen={!(groupCollapsed[group.key] ?? false)}
              onCollapseToggle={() => toggleGroupCollapse(group.key)}
            />
          </div>
        ))}
      </div>

      {showReportModal && (
        <GenerateReportModal
          initialTenantId={selectedTenant.id}
          onClose={() => setShowReportModal(false)}
          onGenerated={(fullReport) => {
            setShowReportModal(false)
            showToast('Report generated — opening viewer', 'success')
            navigate('/reports')
          }}
          showToast={showToast}
        />
      )}

      {showBaselineExportModal && (
        <BaselineExportModal
          tenantId={selectedTenant.id}
          onClose={() => setShowBaselineExportModal(false)}
          showToast={showToast}
        />
      )}
    </div>
  )
}
