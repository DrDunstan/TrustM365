import { useState, useEffect, useCallback } from 'react'
import {
  X, FileText, Loader, ChevronDown, ChevronUp, RefreshCw,
  AlertTriangle, CheckCircle, Users, Layers, AppWindow,
  Monitor, ShieldCheck, RotateCcw, Calendar
} from 'lucide-react'
import { reportApi, tenantApi } from '../api/client.js'

// ── Helpers ───────────────────────────────────────────────────────────────────
function today()    { return new Date().toISOString().slice(0,10) }
function daysAgo(n) { return new Date(Date.now() - n * 86400000).toISOString().slice(0,10) }
function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
}
function pct(v, t) { return t > 0 ? Math.round((v / t) * 100) : 0 }

// ── Small stat tile ───────────────────────────────────────────────────────────
function Stat({ label, value, color = 'text-white' }) {
  return (
    <div className="bg-gray-800/60 rounded-lg px-3 py-2 text-center min-w-[70px]">
      <div className={`text-xl font-bold tabular-nums ${color}`}>{value ?? '—'}</div>
      <div className="text-xs text-gray-600 mt-0.5">{label}</div>
    </div>
  )
}

// ── Inline horizontal bar ─────────────────────────────────────────────────────
function MiniBar({ label, value, total, color }) {
  const p = pct(value, total)
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-xs">
        <span className="text-gray-500">{label}</span>
        <span className="text-gray-400 tabular-nums">{value?.toLocaleString() ?? '—'}</span>
      </div>
      <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${p}%`, backgroundColor: color }}/>
      </div>
    </div>
  )
}

// ── Section preview panels ─────────────────────────────────────────────────────
function ExecPreview({ data }) {
  if (!data) return <Skeleton/>
  const { summary, meta } = data
  const scoreColor = summary.coveragePct === 100 ? 'text-green-400'
    : summary.coveragePct >= 75 ? 'text-yellow-400' : 'text-red-400'
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Stat label="Drift Events"    value={summary.driftEvents}  color={summary.driftEvents > 0 ? 'text-red-400' : 'text-green-400'}/>
        <Stat label="Remediated"      value={summary.remediations} color="text-green-400"/>
        <Stat label="Outstanding"     value={summary.outstanding}  color={summary.outstanding > 0 ? 'text-yellow-400' : 'text-green-400'}/>
        <Stat label="Areas Monitored" value={`${summary.baselined}/${summary.totalAreas}`}/>
        {summary.coveragePct !== null && (
          <Stat label="Coverage" value={`${summary.coveragePct}%`} color={scoreColor}/>
        )}
      </div>
      <div className="text-xs text-gray-500 bg-gray-800/40 rounded-lg px-3 py-2 leading-relaxed">
        {summary.driftEvents === 0
          ? '✓ No drift events detected in this period. All monitored areas matched their baseline.'
          : `${summary.driftEvents} drift event${summary.driftEvents !== 1 ? 's' : ''} detected.${summary.remediations > 0 ? ` ${summary.remediations} remediated.` : ''} ${summary.outstanding > 0 ? `${summary.outstanding} still outstanding.` : 'All resolved.'}`
        }
        {` ${summary.baselined} of ${summary.totalAreas} areas monitored against a defined baseline.`}
      </div>
    </div>
  )
}

function DriftPreview({ data }) {
  if (!data) return <Skeleton/>
  const events = data.driftHistory?.events || []
  if (events.length === 0) return (
    <div className="flex items-center gap-2 text-green-400 text-xs bg-green-950/20 border border-green-900/30 rounded-lg px-3 py-2">
      <CheckCircle size={12}/> No drift events detected in this period.
    </div>
  )
  return (
    <div className="space-y-2">
      {events.map((ev, i) => (
        <div key={i} className="bg-gray-800/40 rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-white">{ev.areaName}</span>
            <span className="text-xs text-gray-600">{fmtDate(ev.checkedAt)}</span>
          </div>
          {ev.properties.flatMap(p => p.drifts || []).slice(0, 4).map((d, j) => (
            <div key={j} className="grid grid-cols-3 gap-2 text-xs">
              <span className="text-gray-500 truncate">{d.label || d.path}</span>
              <span className="bg-gray-900 rounded px-1.5 py-0.5 font-mono text-gray-300 truncate">{String(d.baselineValue ?? '—')}</span>
              <span className="bg-red-950/40 rounded px-1.5 py-0.5 font-mono text-red-300 truncate">{String(d.liveValue ?? '—')}</span>
            </div>
          ))}
          {ev.properties.flatMap(p => p.drifts || []).length > 4 && (
            <p className="text-xs text-gray-600">+{ev.properties.flatMap(p => p.drifts || []).length - 4} more properties…</p>
          )}
        </div>
      ))}
    </div>
  )
}

function RemediationPreview({ data }) {
  if (!data) return <Skeleton/>
  const log = data.remediationLog
  if (!log || log.items.length === 0) return (
    <div className="text-xs text-gray-600 bg-gray-800/30 rounded-lg px-3 py-2">No remediation actions in this period.</div>
  )
  return (
    <div className="space-y-2">
      <div className="flex gap-2 flex-wrap">
        <Stat label="Total"    value={log.succeeded + log.failed}/>
        <Stat label="Succeeded" value={log.succeeded} color="text-green-400"/>
        <Stat label="Failed"   value={log.failed}    color={log.failed > 0 ? 'text-red-400' : 'text-gray-500'}/>
        <Stat label="Auto"     value={log.auto}      color="text-brand-400"/>
        <Stat label="Manual"   value={log.manual}    color="text-gray-400"/>
      </div>
      <div className="space-y-1.5 max-h-36 overflow-y-auto">
        {log.items.map((r, i) => (
          <div key={i} className="flex items-center gap-2 text-xs bg-gray-800/30 rounded px-2.5 py-1.5">
            {r.success
              ? <CheckCircle size={10} className="text-green-400 shrink-0"/>
              : <AlertTriangle size={10} className="text-red-400 shrink-0"/>}
            <span className="text-gray-400 flex-1 truncate">{r.areaName} — {r.resourceName}</span>
            <span className={`shrink-0 ${r.trigger === 'Auto-restore' ? 'text-brand-400' : 'text-gray-500'}`}>{r.trigger}</span>
            <span className="text-gray-600 shrink-0">{fmtDate(r.restoredAt)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function CoveragePreview({ data }) {
  if (!data) return <Skeleton/>
  const coverage = data.baselineCoverage || []
  return (
    <div className="space-y-1.5">
      {coverage.map(area => (
        <div key={area.areaKey} className="flex items-center gap-2 text-xs">
          <div className={`w-2 h-2 rounded-full shrink-0 ${
            area.currentStatus === 'clean'   ? 'bg-green-500'
            : area.currentStatus === 'drifted' ? 'bg-red-500'
            : area.hasBaseline ? 'bg-yellow-500'
            : 'bg-gray-700'}`}/>
          <span className="flex-1 text-gray-400">{area.areaName}</span>
          {area.hasBaseline
            ? <span className={`px-1.5 py-0.5 rounded text-xs border ${
                area.currentStatus === 'clean'   ? 'bg-green-950/30 border-green-900/40 text-green-400'
                : area.currentStatus === 'drifted' ? 'bg-red-950/30 border-red-900/40 text-red-400'
                : 'bg-yellow-950/20 border-yellow-900/30 text-yellow-600'}`}>
                {area.currentStatus || 'No data'}
              </span>
            : <span className="text-gray-700 text-xs">No baseline</span>
          }
        </div>
      ))}
    </div>
  )
}

function ConfigPreview({ data }) {
  if (!data) return <Skeleton/>
  const { users, groups, apps, devices } = data.configState || {}
  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-2"><Users size={11}/> Users & Guests</div>
        {users ? (
          <div className="space-y-1.5">
            <MiniBar label="Members"  value={users.members}  total={users.total} color="#22c55e"/>
            <MiniBar label="Guests"   value={users.guests}   total={users.total} color="#f59e0b"/>
            <MiniBar label="Disabled" value={users.disabled} total={users.total} color="#6b7280"/>
          </div>
        ) : <p className="text-xs text-gray-700">Not available</p>}
      </div>
      <div>
        <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-2"><Layers size={11}/> Groups {groups ? `(${groups.total})` : ''}</div>
        {groups ? (
          <div className="space-y-1.5">
            <MiniBar label="Security"    value={groups.security||0} total={groups.total} color="#60a5fa"/>
            <MiniBar label="M365"        value={groups.m365||0}     total={groups.total} color="#818cf8"/>
            <MiniBar label="Distribution" value={groups.distribution||0} total={groups.total} color="#a78bfa"/>
          </div>
        ) : <p className="text-xs text-gray-700">Not available</p>}
      </div>
      <div>
        <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-2"><AppWindow size={11}/> App Registrations {apps ? `(${apps.total})` : ''}</div>
        {apps ? (
          <div className="space-y-1.5">
            <MiniBar label="Valid"    value={Math.max(0, apps.total - (apps.expired||0) - (apps.expiringSoon||0))} total={apps.total} color="#22c55e"/>
            <MiniBar label="Expiring" value={apps.expiringSoon||0} total={apps.total} color="#f59e0b"/>
            <MiniBar label="Expired"  value={apps.expired||0}      total={apps.total} color="#ef4444"/>
          </div>
        ) : <p className="text-xs text-gray-700">Not available</p>}
      </div>
      <div>
        <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-2"><Monitor size={11}/> Devices {devices?.total ? `(${devices.total})` : ''}</div>
        {devices?.total ? (
          <div className="space-y-1.5">
            <MiniBar label="AAD Joined"    value={devices.joined||0}     total={devices.total} color="#60a5fa"/>
            <MiniBar label="Hybrid Joined" value={devices.hybrid||0}     total={devices.total} color="#818cf8"/>
            <MiniBar label="Registered"    value={devices.registered||0} total={devices.total} color="#9ca3af"/>
          </div>
        ) : <p className="text-xs text-gray-700">Not available — refresh tenant overview first</p>}
      </div>
    </div>
  )
}

function Skeleton() {
  return (
    <div className="space-y-2 animate-pulse">
      {[1,2,3].map(i => <div key={i} className="h-4 bg-gray-800 rounded" style={{width: `${60+i*10}%`}}/>)}
    </div>
  )
}

// ── Section definitions ───────────────────────────────────────────────────────
const SECTIONS = [
  { key: 'exec',        label: 'Executive Summary',          icon: ShieldCheck,  Preview: ExecPreview,        placeholder: 'Add an overall summary for the client — e.g. general health status, any notable events this period, next steps…' },
  { key: 'drift',       label: 'Drift History',              icon: AlertTriangle, Preview: DriftPreview,      placeholder: 'Explain any drift events in plain English — what changed, what the impact was, whether it was expected…' },
  { key: 'remediation', label: 'Remediation Log',            icon: RotateCcw,    Preview: RemediationPreview, placeholder: 'Comment on the remediation actions — auto-restore performance, any manual interventions, outstanding items…' },
  { key: 'coverage',    label: 'Baseline Coverage',          icon: CheckCircle,  Preview: CoveragePreview,    placeholder: 'Note any areas not yet baselined, planned expansions, or reasons certain areas are excluded from monitoring…' },
  { key: 'config',      label: 'Current Configuration State', icon: Users,       Preview: ConfigPreview,      placeholder: 'Comment on the current user/group/app counts — any notable changes since last report, items to watch…' },
]

// ── Main modal ────────────────────────────────────────────────────────────────
export default function GenerateReportModal({ onClose, onGenerated, showToast, initialTenantId = null }) {
  const [tenants,    setTenants]    = useState([])
  const [reportType] = useState('tenant')
  const [tenantId,   setTenantId]   = useState(initialTenantId || '')
  const [dateStart,  setDateStart]  = useState(daysAgo(30))
  const [dateEnd,    setDateEnd]    = useState(today())
  const [notes,      setNotes]      = useState({})
  const [previewData, setPreviewData] = useState(null)
  const [previewing,  setPreviewing]  = useState(false)
  const [generating,  setGenerating]  = useState(false)
  const [activeSection, setActiveSection] = useState('exec')

  useEffect(() => { tenantApi.list().then(setTenants).catch(() => {}) }, [])

  // Auto-fetch preview whenever tenant+dates are ready
  const fetchPreview = useCallback(async () => {
    const tid = tenantId
    if (!tid) return
    if (!dateStart || !dateEnd) return
    setPreviewing(true)
    setPreviewData(null)
    try {
      const data = await reportApi.preview({
        reportType,
        tenantId: tid || undefined,
        dateStart: dateStart + 'T00:00:00.000Z',
        dateEnd:   dateEnd   + 'T23:59:59.999Z',
      })
      setPreviewData(data)
    } catch { showToast('Preview failed — check tenant credentials', 'error') }
    finally { setPreviewing(false) }
  }, [tenantId, dateStart, dateEnd])

  useEffect(() => {
    const t = setTimeout(fetchPreview, 400) // debounce
    return () => clearTimeout(t)
  }, [fetchPreview])

  const generate = async () => {
    if (!tenantId) return showToast('Please select a tenant', 'error')
    setGenerating(true)
    try {
      const result = await reportApi.generate({
        reportType,
        tenantId,
        dateStart: dateStart + 'T00:00:00.000Z',
        dateEnd:   dateEnd   + 'T23:59:59.999Z',
        notes,
      })
      // Fetch the full report with HTML then pass to parent to open viewer
      const full = await reportApi.get(result.id)
      onGenerated(full)
    } catch (err) {
      showToast(err.response?.data?.error || 'Generation failed', 'error')
    } finally { setGenerating(false) }
  }

  const activeSec = SECTIONS.find(s => s.key === activeSection) || SECTIONS[0]
  const PreviewComponent = activeSec.Preview

  return (
    // Full-screen overlay
    <div className="fixed inset-0 z-50 flex flex-col" style={{ backgroundColor: 'var(--page-bg)' }}>

      {/* Top bar */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-3">
          <FileText size={16} className="text-brand-400"/>
          <span className="font-semibold text-white">Generate Report</span>
          {previewing && (
            <span className="flex items-center gap-1.5 text-xs text-gray-500">
              <RefreshCw size={11} className="animate-spin"/> Loading preview…
            </span>
          )}
          {previewData && !previewing && (
            <span className="text-xs text-green-500 flex items-center gap-1">
              <CheckCircle size={11}/> Preview ready
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onClose} className="btn-secondary text-xs">Cancel</button>
          <button onClick={generate} disabled={generating || !previewData} className="btn-primary text-xs">
            {generating
              ? <><Loader size={12} className="animate-spin"/> Generating…</>
              : <><FileText size={12}/> Generate & View Report</>}
          </button>
        </div>
      </div>

      {/* Config strip */}
      <div className="flex items-center gap-4 px-5 py-2.5 border-b border-gray-800/60 bg-gray-900/30 shrink-0 flex-wrap">

        {/* Tenant select */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Tenant:</span>
          <select className="input py-1 text-xs w-44" value={tenantId}
            onChange={e => { setTenantId(e.target.value); setPreviewData(null) }}>
            <option value="">Select…</option>
            {tenants.map(t => <option key={t.id} value={t.id}>{t.display_name}</option>)}
          </select>
        </div>

        {/* Date range */}
        <div className="flex items-center gap-2">
          <Calendar size={12} className="text-gray-500"/>
          <input type="date" className="input py-1 text-xs w-32" value={dateStart} max={dateEnd}
            onChange={e => { setDateStart(e.target.value); setPreviewData(null) }}/>
          <span className="text-gray-600 text-xs">→</span>
          <input type="date" className="input py-1 text-xs w-32" value={dateEnd} min={dateStart} max={today()}
            onChange={e => { setDateEnd(e.target.value); setPreviewData(null) }}/>
        </div>

        {/* Quick presets */}
        <div className="flex gap-1.5 ml-auto">
          {[[7,'7d'],[30,'30d'],[90,'90d']].map(([days, label]) => (
            <button key={days}
              onClick={() => { setDateStart(daysAgo(days)); setDateEnd(today()); setPreviewData(null) }}
              className="text-xs px-2 py-1 rounded border border-gray-700 text-gray-500 hover:text-white hover:border-gray-600 transition-colors">
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Main split layout */}
      <div className="flex flex-1 min-h-0">

        {/* Left sidebar — section tabs */}
        <div className="w-44 border-r border-gray-800 flex flex-col shrink-0">
          {SECTIONS.map(sec => {
            const Icon = sec.icon
            const hasNote = !!(notes[sec.key]?.trim())
            return (
              <button key={sec.key} onClick={() => setActiveSection(sec.key)}
                className={`flex items-center gap-2.5 px-3 py-3 text-left border-b border-gray-800/50 transition-colors
                  ${activeSection === sec.key
                    ? 'bg-brand-700/20 border-l-2 border-l-brand-500 text-white'
                    : 'text-gray-500 hover:bg-gray-800/30 hover:text-gray-300 border-l-2 border-l-transparent'}`}>
                <Icon size={13} className="shrink-0"/>
                <span className="text-xs font-medium leading-tight flex-1">{sec.label}</span>
                {hasNote && <div className="w-1.5 h-1.5 rounded-full bg-brand-500 shrink-0"/>}
              </button>
            )
          })}
          <div className="flex-1"/>
          <div className="p-3 border-t border-gray-800">
            <p className="text-xs text-gray-700 leading-relaxed">
              Sections with a <span className="text-brand-400">●</span> have commentary added.
            </p>
          </div>
        </div>

        {/* Centre — preview panel */}
        <div className="flex-1 flex flex-col min-w-0 border-r border-gray-800">
          <div className="px-5 py-3 border-b border-gray-800/60 flex items-center gap-2 shrink-0">
            <activeSec.icon size={14} className="text-brand-400"/>
            <h2 className="text-sm font-semibold text-white">{activeSec.label}</h2>
            <span className="text-xs text-gray-600 ml-1">— preview of what this section will contain</span>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {!previewData && !previewing && (
              <div className="text-center py-12 text-gray-600 text-sm">
                {!tenantId
                  ? 'Select a tenant above to load the preview.'
                  : 'Select a date range to load the preview.'}
              </div>
            )}
            {previewing && (
              <div className="flex items-center justify-center py-12 gap-2 text-gray-500 text-sm">
                <RefreshCw size={14} className="animate-spin"/> Loading report data…
              </div>
            )}
            {previewData && !previewing && (
              <PreviewComponent data={previewData}/>
            )}
          </div>
        </div>

        {/* Right panel — MSSP commentary */}
        <div className="w-80 flex flex-col shrink-0">
          <div className="px-4 py-3 border-b border-gray-800/60 shrink-0">
            <h2 className="text-sm font-semibold text-white">MSSP Commentary</h2>
            <p className="text-xs text-gray-600 mt-0.5">{activeSec.label}</p>
          </div>
          <div className="flex-1 px-4 py-4 flex flex-col">
            <p className="text-xs text-gray-600 leading-relaxed mb-3">
              This note will appear as a highlighted callout in the <strong className="text-gray-400">{activeSec.label}</strong> section of the report, visible to the client.
            </p>
            <textarea
              className="input flex-1 resize-none text-sm leading-relaxed"
              placeholder={activeSec.placeholder}
              value={notes[activeSection] || ''}
              onChange={e => setNotes(n => ({ ...n, [activeSection]: e.target.value }))}
            />
            <div className="flex items-center justify-between mt-2">
              <span className="text-xs text-gray-700">
                {(notes[activeSection] || '').length > 0
                  ? `${(notes[activeSection] || '').length} characters`
                  : 'Optional — leave blank to omit'}
              </span>
              {(notes[activeSection] || '').length > 0 && (
                <button onClick={() => setNotes(n => ({ ...n, [activeSection]: '' }))}
                  className="text-xs text-gray-600 hover:text-gray-400 transition-colors">
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Summary of all notes */}
          <div className="border-t border-gray-800 px-4 py-3">
            <p className="text-xs text-gray-600 mb-2">Commentary added:</p>
            <div className="space-y-1">
              {SECTIONS.map(sec => (
                <div key={sec.key} className="flex items-center gap-2 text-xs">
                  <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${notes[sec.key]?.trim() ? 'bg-brand-500' : 'bg-gray-800'}`}/>
                  <span className={notes[sec.key]?.trim() ? 'text-gray-400' : 'text-gray-700'}>{sec.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
