import { useState, useEffect, useCallback } from 'react'
import {
  RefreshCw, ShieldCheck, Users, Monitor, AlertTriangle, Info,
  TrendingUp, AppWindow, Layers
} from 'lucide-react'
import { tenantApi } from '../api/client.js'

// ── Small donut chart ─────────────────────────────────────────────────────────
function DonutChart({ value, total, color, size = 72, strokeWidth = 10 }) {
  if (!total || total === 0) return (
    <div className="flex items-center justify-center" style={{ width: size, height: size }}>
      <span className="text-xs text-gray-600">N/A</span>
    </div>
  )
  const radius = (size - strokeWidth) / 2
  const circ   = 2 * Math.PI * radius
  const pct    = Math.min(value / total, 1)
  const dash   = pct * circ
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      <circle cx={size/2} cy={size/2} r={radius}
        fill="none" stroke="var(--donut-track)" strokeWidth={strokeWidth}/>
      <circle cx={size/2} cy={size/2} r={radius}
        fill="none" stroke={color} strokeWidth={strokeWidth}
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${size/2} ${size/2})`}/>
      <text x={size/2} y={size/2} dominantBaseline="middle" textAnchor="middle"
        fill="var(--body-text)" fontSize={size < 70 ? 11 : 14} fontWeight="600" fontFamily="sans-serif">
        {Math.round(pct * 100)}%
      </text>
    </svg>
  )
}

// ── Horizontal bar ────────────────────────────────────────────────────────────
function Bar({ label, value, total, color, subLabel }) {
  const pct = total > 0 ? Math.min((value / total) * 100, 100) : 0
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-400">{label}</span>
        <span className="text-gray-300 font-medium tabular-nums">
          {value?.toLocaleString() ?? '—'}{' '}
          {subLabel && <span className="text-gray-600 font-normal">{subLabel}</span>}
        </span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--donut-track)' }}>
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: color }}/>
      </div>
    </div>
  )
}

// ── Card wrapper ──────────────────────────────────────────────────────────────
function InsightCard({ icon: Icon, title, children, loading, unavailable, color = 'text-brand-400' }) {
  return (
    <div className="card space-y-4">
      <div className="flex items-center gap-2">
        <Icon size={15} className={color}/>
        <span className="text-sm font-semibold text-white">{title}</span>
        {loading && <RefreshCw size={11} className="text-gray-600 animate-spin ml-auto"/>}
      </div>
      {unavailable ? (
        <div className="flex items-start gap-2 text-xs text-gray-600">
          <Info size={11} className="shrink-0 mt-0.5"/>
          <span>Requires additional Graph permissions or Entra P1/P2. See <span className="text-brand-400">Prerequisites</span> for details.</span>
        </div>
      ) : children}
    </div>
  )
}

// ── Breakdown row ─────────────────────────────────────────────────────────────
function BreakdownRow({ label, value, color }) {
  if (!value) return null
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-gray-500">{label}</span>
      <span className={`font-medium tabular-nums ${color || 'text-gray-400'}`}>{value.toLocaleString()}</span>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function TenantInsights({ tenant, showToast }) {
  const [insights,  setInsights]  = useState(null)
  const [overview,  setOverview]  = useState(null)
  const [loading,   setLoading]   = useState(false)
  const [fetched,   setFetched]   = useState(false)

  const load = useCallback(async (force = false) => {
    if (!tenant?.id) return
    setLoading(true)
    try {
      // Load overview (groups + apps) and insights (mfa, auth, users, devices) in parallel
      const [ovResult, inResult] = await Promise.all([
        force
          ? tenantApi.refreshOverview(tenant.id)
          : tenantApi.getOverview(tenant.id).catch(() => null),
        force
          ? tenantApi.refreshInsights(tenant.id)
          : tenantApi.getInsights(tenant.id).catch(() => null),
      ])

      // Overview — refresh if not yet cached
      if (!ovResult || ovResult.loading) {
        const fresh = await tenantApi.refreshOverview(tenant.id)
        setOverview(fresh)
      } else {
        setOverview(ovResult)
      }

      // Insights — refresh if not yet cached
      if (!inResult || inResult.loading) {
        const fresh = await tenantApi.refreshInsights(tenant.id)
        setInsights(fresh)
      } else {
        setInsights(inResult)
      }

      setFetched(true)
    } catch {
      showToast?.('Metrics unavailable — check App Registration permissions', 'error')
    } finally {
      setLoading(false)
    }
  }, [tenant?.id])

  useEffect(() => { load() }, [load])

  // Overview data
  const groups = overview?.groups
  const apps   = overview?.apps

  // Insights data
  const mfa     = insights?.mfaRegistration
  const auth    = insights?.authMethods
  const guest   = insights?.guestRatio
  const devComp = insights?.deviceCompliance
  const devOwn  = insights?.deviceOwnership

  const totalValid = apps
    ? Math.max(0, apps.total - (apps.expired ?? 0) - (apps.expiringSoon ?? 0))
    : 0

  const AUTH_LABELS = {
    microsoftAuthenticatorPush:          'Authenticator App',
    microsoftAuthenticatorPasswordless:  'Passwordless',
    fido2:                               'FIDO2 Security Key',
    windowsHelloForBusiness:             'Windows Hello',
    softwareOneTimePasscode:             'Software TOTP',
    hardwareOneTimePasscode:             'Hardware TOTP',
    sms:                                 'SMS',
    voice:                               'Voice Call',
    email:                               'Email OTP',
    password:                            'Password only',
    temporaryAccessPass:                 'Temp Access Pass',
  }

  const sortedAuthMethods = auth
    ? Object.entries(auth).sort((a, b) => b[1] - a[1]).slice(0, 6)
    : []
  const maxAuthCount = sortedAuthMethods[0]?.[1] || 1

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp size={16} className="text-brand-400"/>
          <h2 className="text-sm font-semibold text-white">Tenant Insights</h2>
          <span className="text-xs text-gray-600">— live Graph metrics</span>
        </div>
        <button onClick={() => load(true)} disabled={loading}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 border border-gray-800 hover:border-gray-700 px-2.5 py-1.5 rounded-lg transition-colors">
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''}/> Refresh
        </button>
      </div>

      {/* Credential expiry alert */}
      {apps && (apps.expired > 0 || apps.expiringSoon > 0) && (
        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs border
          ${apps.expired > 0
            ? 'bg-red-950/30 border-red-900/50 text-red-300'
            : 'bg-yellow-950/30 border-yellow-900/50 text-yellow-300'}`}>
          <AlertTriangle size={12} className="shrink-0"/>
          {apps.expired > 0
            ? `${apps.expired} app credential${apps.expired !== 1 ? 's have' : ' has'} expired — update now to prevent auth failures`
            : `${apps.expiringSoon} app credential${apps.expiringSoon !== 1 ? 's expire' : ' expires'} within 30 days`}
        </div>
      )}

      {!fetched && loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[1,2,3,4,5,6].map(i => (
            <div key={i} className="card animate-pulse space-y-3">
              <div className="h-4 bg-gray-800 rounded w-1/2"/>
              <div className="h-16 bg-gray-800/50 rounded"/>
            </div>
          ))}
        </div>
      )}

      {fetched && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

          {/* ── Groups ──────────────────────────────────────────────────────── */}
          <InsightCard icon={Layers} title="Groups" loading={loading}
            color="text-blue-400"
            unavailable={!groups && !overview}>
            {groups && (
              <div className="space-y-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-3xl font-bold text-white tabular-nums">{groups.total}</span>
                  <span className="text-xs text-gray-500">total groups</span>
                </div>
                <div className="space-y-1.5 pt-1 border-t border-gray-800">
                  <BreakdownRow label="Security"               value={groups.security}            color="text-blue-400"/>
                  <BreakdownRow label="Microsoft 365"          value={groups.m365}                color="text-indigo-400"/>
                  <BreakdownRow label="Mail-enabled security"  value={groups.mailEnabledSecurity} color="text-cyan-400"/>
                  <BreakdownRow label="Distribution"           value={groups.distribution}        color="text-violet-400"/>
                  <BreakdownRow label="Dynamic (cross-type)"   value={groups.dynamic}             color="text-purple-400"/>
                </div>
              </div>
            )}
          </InsightCard>

          {/* ── App Registrations ───────────────────────────────────────────── */}
          <InsightCard icon={AppWindow} title="App Registrations" loading={loading}
            color={apps?.expired > 0 ? 'text-red-400' : 'text-brand-400'}
            unavailable={!apps && !overview}>
            {apps && (
              <div className="space-y-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-3xl font-bold text-white tabular-nums">{apps.total}</span>
                  <span className="text-xs text-gray-500">registered apps</span>
                </div>
                <div className="space-y-2 pt-1 border-t border-gray-800">
                  <Bar label="Credentials valid"       value={totalValid}            total={apps.total} color="#34d399"/>
                  <Bar label="Expiring within 30 days" value={apps.expiringSoon ?? 0} total={apps.total}
                    color={apps.expiringSoon > 0 ? '#f59e0b' : '#4b5563'}/>
                  <Bar label="Expired"                 value={apps.expired ?? 0}     total={apps.total}
                    color={apps.expired > 0 ? '#f87171' : '#4b5563'}/>
                </div>
              </div>
            )}
          </InsightCard>

          {/* ── MFA Registration ────────────────────────────────────────────── */}
          <InsightCard icon={ShieldCheck} title="MFA Registration" loading={loading}
            color="text-green-400"
            unavailable={!mfa && insights?.errors?.some(e => e.section === 'mfaRegistration')}>
            {mfa && (
              <div className="flex items-start gap-4">
                <DonutChart value={mfa.mfaRegistered} total={mfa.total} color="#34d399" size={80}/>
                <div className="flex-1 space-y-2.5 min-w-0">
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-400">Registered for MFA</span>
                      <span className="text-green-400 font-medium">{mfa.mfaRegistered?.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-400">Not registered</span>
                      <span className={mfa.mfaNotRegistered > 0 ? 'text-red-400 font-medium' : 'text-gray-500'}>
                        {mfa.mfaNotRegistered?.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-400">Passwordless capable</span>
                      <span className="text-indigo-400 font-medium">{mfa.passwordless?.toLocaleString()}</span>
                    </div>
                  </div>
                  {mfa.mfaNotRegistered > 0 && (
                    <div className="flex items-center gap-1.5 bg-red-950/30 border border-red-900/40 rounded-lg px-2 py-1.5">
                      <AlertTriangle size={10} className="text-red-400 shrink-0"/>
                      <span className="text-xs text-red-300">{mfa.mfaNotRegistered} users without MFA</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </InsightCard>

          {/* ── Authentication Methods ───────────────────────────────────────── */}
          <InsightCard icon={ShieldCheck} title="Authentication Methods" loading={loading}
            color="text-indigo-400"
            unavailable={!auth && insights?.errors?.some(e => e.section === 'mfaRegistration')}>
            {sortedAuthMethods.length > 0 && (
              <div className="space-y-2">
                {sortedAuthMethods.map(([method, count]) => (
                  <Bar key={method}
                    label={AUTH_LABELS[method] || method}
                    value={count}
                    total={maxAuthCount}
                    color={
                      method.includes('fido') || method.includes('windowsHello') || method.includes('Passwordless')
                        ? '#818cf8'
                        : method === 'sms' || method === 'voice'
                        ? '#f87171'
                        : '#34d399'
                    }
                    subLabel="users"
                  />
                ))}
                {(auth?.sms > 0 || auth?.voice > 0) && (
                  <div className="flex items-center gap-1.5 bg-yellow-950/20 border border-yellow-900/40 rounded-lg px-2 py-1.5 mt-2">
                    <AlertTriangle size={10} className="text-yellow-400 shrink-0"/>
                    <span className="text-xs text-yellow-300">SMS/Voice in use — phishable methods present</span>
                  </div>
                )}
              </div>
            )}
          </InsightCard>

          {/* ── Users & Guests ───────────────────────────────────────────────── */}
          <InsightCard icon={Users} title="Users & Guests" loading={loading}
            color="text-blue-400" unavailable={!guest}>
            {guest && (
              <div className="space-y-2.5">
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: 'Members',  value: guest.members,  color: 'text-green-400' },
                    { label: 'Guests',   value: guest.guests,   color: 'text-yellow-400' },
                    { label: 'Disabled', value: guest.disabled, color: 'text-gray-500' },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="rounded-lg px-3 py-2.5 text-center border border-gray-800" style={{ backgroundColor: 'var(--donut-track)' }}>
                      <div className={`text-xl font-bold tabular-nums ${color}`}>{value?.toLocaleString() ?? '—'}</div>
                      <div className="text-xs text-gray-600 mt-0.5">{label}</div>
                    </div>
                  ))}
                </div>
                <div className="space-y-1.5">
                  <Bar label="Members"  value={guest.members}  total={guest.total} color="#34d399"/>
                  <Bar label="Guests"   value={guest.guests}   total={guest.total} color="#f59e0b"/>
                  <Bar label="Disabled" value={guest.disabled} total={guest.total} color="#6b7280"/>
                </div>
                {guest.guestPercent > 20 && (
                  <div className="flex items-center gap-1.5 bg-yellow-950/20 border border-yellow-900/40 rounded-lg px-2 py-1.5">
                    <AlertTriangle size={10} className="text-yellow-400 shrink-0"/>
                    <span className="text-xs text-yellow-300">{guest.guestPercent}% guest ratio — review external access</span>
                  </div>
                )}
              </div>
            )}
          </InsightCard>

          {/* ── Devices ──────────────────────────────────────────────────────── */}
          <InsightCard icon={Monitor} title="Devices" loading={loading}
            color="text-violet-400"
            unavailable={!devComp && insights?.errors?.some(e => e.section === 'deviceCompliance')}>
            {devComp && (
              <div className="space-y-3">
                <div className="flex items-start gap-4">
                  <div className="space-y-1 shrink-0 text-center">
                    <DonutChart value={devComp.compliant} total={devComp.total} color="#34d399" size={68}/>
                    <p className="text-xs text-gray-600">Compliant</p>
                  </div>
                  <div className="flex-1 space-y-2">
                    <Bar label="Compliant"     value={devComp.compliant}    total={devComp.total} color="#34d399"/>
                    <Bar label="Non-compliant" value={devComp.nonCompliant} total={devComp.total} color="#f87171"/>
                    <Bar label="Managed"       value={devComp.managed}      total={devComp.total} color="#818cf8"/>
                    <Bar label="Unmanaged"     value={devComp.unmanaged}    total={devComp.total} color="#6b7280"/>
                  </div>
                </div>
                {devOwn?.byOS && Object.keys(devOwn.byOS).length > 0 && (
                  <div className="space-y-1.5 pt-2 border-t border-gray-800">
                    <p className="text-xs text-gray-600 font-medium uppercase tracking-wider">OS Breakdown</p>
                    {Object.entries(devOwn.byOS)
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 5)
                      .map(([os, count]) => (
                        <Bar key={os} label={os} value={count} total={devComp.total}
                          color={
                            os === 'Windows' ? '#3b82f6'
                            : os === 'iOS' ? '#a78bfa'
                            : os === 'Android' ? '#34d399'
                            : os === 'macOS' ? '#f59e0b'
                            : '#6b7280'
                          }/>
                      ))}
                  </div>
                )}
                {devComp.nonCompliant > 0 && (
                  <div className="flex items-center gap-1.5 bg-red-950/30 border border-red-900/40 rounded-lg px-2 py-1.5">
                    <AlertTriangle size={10} className="text-red-400 shrink-0"/>
                    <span className="text-xs text-red-300">
                      {devComp.nonCompliant} non-compliant device{devComp.nonCompliant !== 1 ? 's' : ''}
                    </span>
                  </div>
                )}
              </div>
            )}
          </InsightCard>

        </div>
      )}
    </div>
  )
}
