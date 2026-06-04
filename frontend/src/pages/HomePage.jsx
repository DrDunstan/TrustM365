import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle, CheckCircle, Circle, Plus, Shield, ChevronRight, RefreshCw
} from 'lucide-react'
import { useBranding } from '../App.jsx'

function ShieldMark({ size = 72 }) {
  const { logoUrl } = useBranding()
  if (logoUrl) {
    return (
      <img src={logoUrl} alt="Logo" width={size} height={size}
        className="object-contain"
        onError={e => { e.currentTarget.style.display = 'none' }}/>
    )
  }
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="hm-stroke" x1="100" y1="10" x2="100" y2="185" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#818cf8"/><stop offset="100%" stopColor="#6d28d9"/>
        </linearGradient>
        <linearGradient id="hm-fill" x1="100" y1="10" x2="100" y2="185" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#312e81" stopOpacity="0.55"/><stop offset="100%" stopColor="#1e1b4b" stopOpacity="0.25"/>
        </linearGradient>
        <linearGradient id="hm-line" x1="30" y1="0" x2="170" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#34d399"/><stop offset="44%" stopColor="#34d399"/>
          <stop offset="56%" stopColor="#f87171"/><stop offset="72%" stopColor="#f87171"/>
          <stop offset="86%" stopColor="#34d399"/><stop offset="100%" stopColor="#34d399"/>
        </linearGradient>
        <filter id="hm-glow"><feGaussianBlur in="SourceGraphic" stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        <filter id="hm-dot"><feGaussianBlur in="SourceGraphic" stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      </defs>
      <path d="M100 18 L174 47 C174 47 174 112 174 120 C174 153 139 174 100 186 C61 174 26 153 26 120 C26 112 26 47 26 47 Z"
        fill="url(#hm-fill)" stroke="url(#hm-stroke)" strokeWidth="5" strokeLinejoin="round"/>
      <line x1="38" y1="114" x2="162" y2="114" stroke="#34d399" strokeWidth="1.5" strokeDasharray="5 4" opacity="0.25"/>
      <polyline points="38,114 72,114 88,80 104,114 162,114" stroke="url(#hm-line)" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" filter="url(#hm-glow)"/>
      <circle cx="38" cy="114" r="5" fill="#34d399" opacity="0.9"/>
      <circle cx="88" cy="80" r="7" fill="#f87171" filter="url(#hm-dot)"/>
      <circle cx="162" cy="114" r="5.5" fill="#34d399"/>
    </svg>
  )
}

// ── Tenant card ───────────────────────────────────────────────────────────────
function TenantCard({ tenant, areas, onSelect, navigate }) {
  const tenantAreas = areas || []

  // Treat drifted-with-0-count same as clean (post-auto-restore edge case)
  const driftedAreas  = tenantAreas.filter(a =>
    a.latestDrift?.status === 'drifted' && (a.latestDrift?.driftCount || 0) > 0
  )
  const cleanAreas    = tenantAreas.filter(a =>
    a.latestDrift?.status === 'clean' ||
    (a.latestDrift?.status === 'drifted' && (a.latestDrift?.driftCount || 0) === 0)
  )
  const hasDrift      = driftedAreas.length > 0
  const totalDrifts   = driftedAreas.reduce((s, a) => s + (a.latestDrift?.driftCount || 0), 0)
  const noBaselineSet = tenantAreas.length === 0 || tenantAreas.every(a => !a.has_baseline)

  const status = hasDrift
    ? 'drifted'
    : cleanAreas.length > 0
    ? 'clean'
    : 'no-baseline'

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(tenant)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(tenant)
        }
      }}
      className={`group w-full text-left rounded-2xl border p-5 transition-all hover:scale-[1.01] active:scale-[0.99] max-w-sm cursor-pointer
        ${hasDrift
          ? 'bg-red-950/10 border-red-900/60 hover:bg-red-950/20 hover:border-red-700/80'
          : status === 'clean'
          ? 'bg-green-950/5 border-green-900/40 hover:bg-green-950/10 hover:border-green-800/60'
          : 'bg-gray-900/60 border-gray-800 hover:bg-gray-800/80 hover:border-gray-700'
        }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-3 h-3 rounded-full shrink-0 mt-0.5 ring-2 ring-offset-2 ring-offset-gray-950
            ${status === 'drifted' ? 'bg-red-500 ring-red-900'
            : status === 'clean'   ? 'bg-green-500 ring-green-900'
            : 'bg-gray-600 ring-gray-800'}`}/>
          <div className="min-w-0">
            <div className="font-semibold text-white text-sm truncate">{tenant.display_name}</div>
            <div className="text-xs text-gray-600 font-mono truncate mt-0.5">{tenant.tenant_id}</div>
          </div>
        </div>
        <ChevronRight size={14} className="text-gray-600 group-hover:text-gray-300 transition-colors shrink-0 mt-0.5"/>
      </div>

      {/* Drift detail — only the drifted areas, nothing else */}
      {hasDrift && (
        <div className="mt-3 pt-3 border-t border-red-900/30 space-y-1.5">
          <div className="flex items-center gap-1.5 mb-1">
            <AlertTriangle size={11} className="text-red-400"/>
            <span className="text-xs font-semibold text-red-400">
              {totalDrifts} drift{totalDrifts !== 1 ? 's' : ''} detected
            </span>
          </div>
          {driftedAreas.map(area => (
            <button
              key={area.area_key}
              onClick={e => {
                e.stopPropagation()
                onSelect(tenant)
                // Small delay to let tenant set before navigating
                setTimeout(() => navigate(`/area/${tenant.id}/${area.area_key}`), 50)
              }}
              className="w-full flex items-center justify-between gap-2 bg-red-950/30 border border-red-900/40 rounded-lg px-3 py-2 hover:bg-red-950/50 hover:border-red-800/60 transition-colors">
              <span className="text-xs text-red-200 font-medium truncate">{area.display_name}</span>
              <span className="text-xs text-red-400 font-bold shrink-0">
                {area.latestDrift.driftCount} drift{area.latestDrift.driftCount !== 1 ? 's' : ''}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Healthy state — just a clean indicator */}
      {!hasDrift && status === 'clean' && (
        <div className="mt-3 pt-3 border-t border-green-900/20 flex items-center gap-2">
          <CheckCircle size={11} className="text-green-400 shrink-0"/>
          <span className="text-xs text-green-400">
            {cleanAreas.length} area{cleanAreas.length !== 1 ? 's' : ''} clean — no drift detected
          </span>
        </div>
      )}

      {/* No baseline set */}
      {!hasDrift && status === 'no-baseline' && (
        <div className="mt-3 pt-3 border-t border-gray-800 flex items-center gap-2">
          <Circle size={11} className="text-gray-600 shrink-0"/>
          <span className="text-xs text-gray-600">No baseline set</span>
        </div>
      )}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function HomePage({ tenants, areas, selectedTenant, setSelectedTenant, showToast }) {
  const navigate = useNavigate()

  const handleSelectTenant = (tenant) => {
    setSelectedTenant(tenant)
    navigate('/')
  }

  const driftedTenants  = tenants.filter(t =>
    (areas[t.id] || []).some(a =>
      a.latestDrift?.status === 'drifted' && (a.latestDrift?.driftCount || 0) > 0
    )
  )
  const healthyTenants  = tenants.filter(t => {
    const ta = areas[t.id] || []
    const hasGenuineDrift = ta.some(a =>
      a.latestDrift?.status === 'drifted' && (a.latestDrift?.driftCount || 0) > 0
    )
    const hasClean = ta.some(a =>
      a.latestDrift?.status === 'clean' ||
      (a.latestDrift?.status === 'drifted' && (a.latestDrift?.driftCount || 0) === 0)
    )
    return ta.length > 0 && hasClean && !hasGenuineDrift
  })
  const noBaselineTenants = tenants.filter(t => !driftedTenants.includes(t) && !healthyTenants.includes(t))

  const totalDrifts = Object.values(areas || {}).flat()
    .reduce((s, a) => s + (a.latestDrift?.status === 'drifted' ? (a.latestDrift.driftCount || 0) : 0), 0)
  const totalBaselines = Object.values(areas || {}).flat().filter(a => a.has_baseline).length

  return (
    <div className="min-h-screen p-8">

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col items-center text-center mb-10 pt-4">
        <ShieldMark size={80}/>
        <h1 className="text-4xl font-bold text-white mt-5 tracking-tight">
          Trust<span className="text-indigo-400">M365</span>
        </h1>
        <p className="text-gray-400 text-base mt-2">Monitor. Baseline. Restore.</p>

        {/* Summary strip */}
        {tenants.length > 0 && (
          <div className="flex items-center gap-6 mt-6 bg-gray-900/60 border border-gray-800 rounded-2xl px-6 py-3">
            <div className="text-center">
              <div className="text-2xl font-bold text-white">{tenants.length}</div>
              <div className="text-xs text-gray-500">Tenant{tenants.length !== 1 ? 's' : ''}</div>
            </div>
            <div className="w-px h-8 bg-gray-800"/>
            <div className="text-center">
              <div className={`text-2xl font-bold ${driftedTenants.length > 0 ? 'text-red-400' : 'text-green-400'}`}>
                {driftedTenants.length > 0 ? driftedTenants.length : healthyTenants.length}
              </div>
              <div className="text-xs text-gray-500">
                {driftedTenants.length > 0 ? 'Drifted' : 'Healthy'}
              </div>
            </div>
            {totalDrifts > 0 && (
              <>
                <div className="w-px h-8 bg-gray-800"/>
                <div className="text-center">
                  <div className="text-2xl font-bold text-red-400">{totalDrifts}</div>
                  <div className="text-xs text-gray-500">Total Drifts</div>
                </div>
              </>
            )}
            <div className="w-px h-8 bg-gray-800"/>
            <div className="text-center">
              <div className="text-2xl font-bold text-gray-300">{totalBaselines}</div>
              <div className="text-xs text-gray-500">Baselines</div>
            </div>
          </div>
        )}
      </div>

      {/* ── No tenants — onboarding ──────────────────────────────────────── */}
      {tenants.length === 0 && (
        <div className="max-w-md mx-auto text-center space-y-6">
          <div className="card border-gray-800 py-10 space-y-4">
            <Shield size={48} className="text-gray-700 mx-auto"/>
            <div>
              <h2 className="text-lg font-semibold text-white">No tenants registered yet</h2>
              <p className="text-gray-500 text-sm mt-1 max-w-xs mx-auto">
                Register your first M365 tenant to start monitoring configuration drift.
              </p>
            </div>
            <button onClick={() => navigate('/add-tenant')} className="btn-primary mx-auto">
              <Plus size={14}/> Register Your First Tenant
            </button>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            {[
              { step: '1', label: 'App Registration', desc: 'Create an Entra App with Graph API permissions' },
              { step: '2', label: 'Register Tenant',  desc: 'Add your tenant ID, client ID and secret' },
              { step: '3', label: 'Set Baselines',    desc: 'Choose what to monitor and save a baseline' },
            ].map(({ step, label, desc }) => (
              <div key={step} className="card-sm border-gray-800 space-y-1">
                <div className="w-6 h-6 rounded-full bg-indigo-900/60 border border-indigo-700/60 text-indigo-300 text-xs font-bold flex items-center justify-center mx-auto">{step}</div>
                <div className="text-xs font-semibold text-gray-300">{label}</div>
                <div className="text-xs text-gray-600">{desc}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Tenant portfolio ─────────────────────────────────────────────── */}
      {tenants.length > 0 && (
        <div className="max-w-5xl mx-auto space-y-8">

          {/* Drift Detected section */}
          {driftedTenants.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <AlertTriangle size={13} className="text-red-400"/>
                <span className="text-xs font-semibold text-red-400 uppercase tracking-wider">Drift Detected</span>
                <div className="flex-1 h-px bg-red-900/30"/>
                <span className="text-xs text-red-500">{driftedTenants.length} tenant{driftedTenants.length !== 1 ? 's' : ''}</span>
              </div>
              {/* Centred flex wrap — single tenant stays centred */}
              <div className="flex flex-wrap justify-center gap-4">
                {driftedTenants.map(t => (
                  <div key={t.id} className="w-full sm:w-[calc(50%-8px)] lg:w-[calc(33.333%-11px)] min-w-[280px] max-w-sm">
                    <TenantCard tenant={t} areas={areas[t.id]} onSelect={handleSelectTenant} navigate={navigate}/>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Healthy section */}
          {healthyTenants.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <CheckCircle size={13} className="text-green-400"/>
                <span className="text-xs font-semibold text-green-400 uppercase tracking-wider">Healthy</span>
                <div className="flex-1 h-px bg-green-900/20"/>
                <span className="text-xs text-green-600">{healthyTenants.length} tenant{healthyTenants.length !== 1 ? 's' : ''}</span>
              </div>
              <div className="flex flex-wrap justify-center gap-4">
                {healthyTenants.map(t => (
                  <div key={t.id} className="w-full sm:w-[calc(50%-8px)] lg:w-[calc(33.333%-11px)] min-w-[280px] max-w-sm">
                    <TenantCard tenant={t} areas={areas[t.id]} onSelect={handleSelectTenant} navigate={navigate}/>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* No baseline set section */}
          {noBaselineTenants.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Circle size={13} className="text-gray-500"/>
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  No Baseline Set
                </span>
                <div className="flex-1 h-px bg-gray-800"/>
              </div>
              <div className="flex flex-wrap justify-center gap-4">
                {noBaselineTenants.map(t => (
                  <div key={t.id} className="w-full sm:w-[calc(50%-8px)] lg:w-[calc(33.333%-11px)] min-w-[280px] max-w-sm">
                    <TenantCard tenant={t} areas={areas[t.id]} onSelect={handleSelectTenant} navigate={navigate}/>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Add tenant */}
          <div className="flex justify-center pt-2">
            <button onClick={() => navigate('/add-tenant')} className="btn-secondary flex items-center gap-2">
              <Plus size={14}/> Add Another Tenant
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
