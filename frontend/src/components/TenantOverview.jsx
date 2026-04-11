import { useState, useEffect, useCallback } from 'react'
import {
  Users, Shield, AppWindow, Monitor, Laptop, Building2,
  Wifi, AlertTriangle, RefreshCw, CheckCircle, Clock
} from 'lucide-react'
import { tenantApi } from '../api/client.js'

// ── Individual stat tile ──────────────────────────────────────────────────────
function Tile({ icon, label, primary, sub, alert, dim, loading }) {
  return (
    <div className={`rounded-xl px-4 py-3 border flex flex-col gap-1.5 min-w-0 h-full
      ${dim    ? 'bg-gray-900/40 border-gray-800/40 opacity-50'
      : alert  ? 'bg-gray-900 border-red-900/70'
      :          'bg-gray-900 border-gray-800'}`}>
      <div className="flex items-center gap-1.5 text-gray-500 text-xs font-medium">
        <span className="shrink-0">{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div className={`text-2xl font-bold leading-none tabular-nums
        ${loading ? 'text-gray-700' : alert ? 'text-red-400' : dim ? 'text-gray-700' : 'text-white'}`}>
        {loading ? '…' : (primary ?? '—')}
      </div>
      {sub && (
        <div className="text-xs text-gray-600 leading-relaxed">{sub}</div>
      )}
    </div>
  )
}

// ── Expanded multi-row tile ───────────────────────────────────────────────────
function ExpandedTile({ icon, label, total, rows, alert, dim, loading }) {
  return (
    <div className={`rounded-xl px-4 py-3 border flex flex-col gap-2 min-w-0 h-full
      ${dim    ? 'bg-gray-900/40 border-gray-800/40 opacity-50'
      : alert  ? 'bg-gray-900 border-red-900/70'
      :          'bg-gray-900 border-gray-800'}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-gray-500 text-xs font-medium">
          <span className="shrink-0">{icon}</span>
          <span className="truncate">{label}</span>
        </div>
        <span className={`text-2xl font-bold leading-none tabular-nums
          ${loading ? 'text-gray-700' : alert ? 'text-red-400' : dim ? 'text-gray-700' : 'text-white'}`}>
          {loading ? '…' : (total ?? '—')}
        </span>
      </div>
      {!loading && rows && rows.filter(r => r.value > 0).length > 0 && (
        <div className="space-y-1 pt-1 border-t border-gray-800">
          {rows.filter(r => r.value > 0).map(({ label: rl, value, color }) => (
            <div key={rl} className="flex items-center justify-between text-xs">
              <span className="text-gray-600">{rl}</span>
              <span className={`font-medium tabular-nums ${color || 'text-gray-400'}`}>{value}</span>
            </div>
          ))}
        </div>
      )}
      {!loading && rows && rows.filter(r => r.value > 0).length === 0 && (
        <div className="text-xs text-gray-700 pt-1 border-t border-gray-800">No breakdown data</div>
      )}
    </div>
  )
}

// ── Devices tile ──────────────────────────────────────────────────────────────
function DevicesTile({ devices, loading }) {
  if (!devices && !loading) {
    return (
      <div className="rounded-xl px-4 py-3 border border-gray-800/40 bg-gray-900/40 opacity-50 h-full flex items-center gap-2">
        <Monitor size={13} className="text-gray-700" />
        <span className="text-xs text-gray-700">Devices — no data</span>
      </div>
    )
  }

  const total = devices
    ? (devices.registered ?? 0) + (devices.joined ?? 0) + (devices.hybrid ?? 0)
    : null

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 px-4 py-3 h-full space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-gray-500 text-xs font-medium">
          <Monitor size={11} />
          <span>Devices</span>
        </div>
        <span className={`text-2xl font-bold tabular-nums leading-none ${loading ? 'text-gray-700' : 'text-white'}`}>
          {loading ? '…' : total ?? '—'}
        </span>
      </div>

      {!loading && devices && (
        <div className="space-y-1 pt-1 border-t border-gray-800">
          {[
            { icon: <Building2 size={10}/>, label: 'AAD Joined',    value: devices.joined,     tip: 'Cloud-native corporate' },
            { icon: <Wifi      size={10}/>, label: 'Registered',    value: devices.registered, tip: 'BYOD / personal' },
            { icon: <Laptop    size={10}/>, label: 'Hybrid Joined', value: devices.hybrid,     tip: 'On-prem + cloud' },
          ].filter(item => item.value > 0).map(({ icon, label, value, tip }) => (
            <div key={label} className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1 text-gray-600">{icon} {label}</span>
              <span className="text-gray-400 font-medium tabular-nums">{value}</span>
            </div>
          ))}
        </div>
      )}

      {devices?.byOS && Object.keys(devices.byOS).length > 1 && (
        <div className="flex flex-wrap gap-1 pt-1 border-t border-gray-800">
          {Object.entries(devices.byOS)
            .sort(([,a],[,b]) => b - a)
            .map(([os, count]) => (
              <span key={os} className="text-xs text-gray-600 bg-gray-800/60 border border-gray-700/60 px-1.5 py-0.5 rounded">
                {os} {count}
              </span>
            ))}
        </div>
      )}
    </div>
  )
}

// ── Credential expiry alert banner ────────────────────────────────────────────
function CredAlert({ apps }) {
  if (!apps || (apps.expired === 0 && apps.expiringSoon === 0)) return null
  const isExpired = apps.expired > 0
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs border
      ${isExpired
        ? 'bg-red-950/30 border-red-900/50 text-red-300'
        : 'bg-yellow-950/30 border-yellow-900/50 text-yellow-300'}`}>
      <AlertTriangle size={12} className="shrink-0" />
      {isExpired
        ? `${apps.expired} app registration credential${apps.expired !== 1 ? 's have' : ' has'} expired — update now to prevent auth failures`
        : `${apps.expiringSoon} app registration credential${apps.expiringSoon !== 1 ? 's expire' : ' expires'} within 30 days`
      }
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function TenantOverview({ tenant, triggerRefresh, showToast }) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (force = false) => {
    if (!tenant?.id) return
    setLoading(true)
    try {
      let result = force ? null : await tenantApi.getOverview(tenant.id).catch(() => null)
      if (!result || result.loading || force) {
        result = await tenantApi.refreshOverview(tenant.id)
      }
      setData(result)
    } catch {
      showToast?.('Overview refresh failed', 'error')
    } finally {
      setLoading(false)
    }
  }, [tenant?.id])

  useEffect(() => { load(false) }, [load])
  useEffect(() => { if (triggerRefresh > 0) load(true) }, [triggerRefresh])

  const { groups, apps, devices } = data || {}
  const isLoading = loading && !data

  // Total credentials across all app registrations
  const totalValid   = apps ? Math.max(0, apps.total - (apps.expired ?? 0) - (apps.expiringSoon ?? 0)) : 0

  return (
    <div className="space-y-2">

      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          Tenant Overview
        </h2>
        {loading && data && (
          <span className="flex items-center gap-1 text-xs text-gray-700">
            <RefreshCw size={10} className="animate-spin" /> Refreshing
          </span>
        )}
      </div>

      {/* Credential alert */}
      {apps && <CredAlert apps={apps} />}

      {/* Two tiles: Groups · App Registrations (Devices shown in Tenant Insights below) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">

        {/* Groups — breakdown by all types, summing to total */}
        <ExpandedTile
          icon={<Users size={11} />}
          label="Groups"
          total={groups?.total}
          loading={isLoading}
          dim={!groups && !loading}
          rows={groups ? [
            { label: 'Security',              value: groups.security             ?? 0, color: 'text-blue-400' },
            { label: 'Microsoft 365',         value: groups.m365                 ?? 0, color: 'text-indigo-400' },
            { label: 'Mail-enabled security', value: groups.mailEnabledSecurity  ?? 0, color: 'text-cyan-400' },
            { label: 'Distribution',          value: groups.distribution         ?? 0, color: 'text-violet-400' },
            { label: 'Dynamic (cross-type)',  value: groups.dynamic              ?? 0, color: 'text-purple-400' },
          ] : []}
        />

        {/* App Registrations — credential health */}
        <ExpandedTile
          icon={<AppWindow size={11} />}
          label="App Registrations"
          total={apps?.total}
          loading={isLoading}
          alert={apps?.expired > 0}
          dim={!apps && !loading}
          rows={apps ? [
            { label: 'Credentials valid',       value: totalValid,                color: 'text-green-400' },
            { label: 'Expiring within 30 days', value: apps.expiringSoon ?? 0,    color: apps.expiringSoon > 0 ? 'text-yellow-400' : 'text-gray-600' },
            { label: 'Expired',                  value: apps.expired      ?? 0,    color: apps.expired      > 0 ? 'text-red-400'    : 'text-gray-600' },
          ] : []}
        />

      </div>
    </div>
  )
}
