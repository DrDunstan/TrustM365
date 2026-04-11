import { useState, useEffect, useCallback } from 'react'
import {
  ShieldCheck, CheckCircle, XCircle, AlertCircle, ChevronDown, ChevronRight,
  RefreshCw, Info, ExternalLink, Users, Tag, Shield, Eye
} from 'lucide-react'
import { tenantApi } from '../api/client.js'

// ── Maester-derived Entra ID Security Checks ──────────────────────────────────
// Based on Maester's Entra ID - Security Configuration Analyzer tests
// Reference: https://maester.dev/docs/tests/

const SECURITY_CHECK_GROUPS = [
  {
    id: 'mfa',
    label: 'Multi-Factor Authentication',
    icon: ShieldCheck,
    checks: [
      {
        id: 'mfa.ca_mfa_all_users',
        name: 'MFA required for all users',
        description: 'A Conditional Access policy should require MFA for all users. This is the most critical security control for protecting M365 accounts.',
        reference: 'CISA SCuBA MS.AAD.3.1',
        severity: 'critical',
        area: 'entra_ca',
        testFn: (resources) => {
          const caPolicies = Object.values(resources || {})
          const mfaPolicy = caPolicies.find(p =>
            p.state === 'enabled' &&
            p.grantControls?.builtInControls?.includes('mfa') &&
            (
              p.conditions?.users?.includeUsers?.includes('All') ||
              (p.conditions?.users?.includeUsers?.length > 0 && !p.conditions?.users?.excludeUsers?.length)
            )
          )
          return {
            pass: !!mfaPolicy,
            detail: mfaPolicy
              ? `Policy "${mfaPolicy.displayName}" requires MFA for all users`
              : 'No Conditional Access policy requiring MFA for all users was found',
          }
        }
      },
      {
        id: 'mfa.ca_mfa_admins',
        name: 'MFA required for privileged roles',
        description: 'All privileged administrator accounts should be required to use MFA. This protects the most sensitive accounts from compromise.',
        reference: 'CISA SCuBA MS.AAD.3.2',
        severity: 'critical',
        area: 'entra_ca',
        testFn: (resources) => {
          const caPolicies = Object.values(resources || {})
          const adminMfaPolicy = caPolicies.find(p =>
            p.state === 'enabled' &&
            p.grantControls?.builtInControls?.includes('mfa') &&
            (p.conditions?.users?.includeRoles?.length > 0 || p.conditions?.users?.includeUsers?.includes('All'))
          )
          return {
            pass: !!adminMfaPolicy,
            detail: adminMfaPolicy
              ? `Policy "${adminMfaPolicy.displayName}" covers privileged roles`
              : 'No CA policy found that specifically targets privileged role holders with MFA',
          }
        }
      },
      {
        id: 'mfa.ca_block_legacy_auth',
        name: 'Legacy authentication protocols blocked',
        description: 'Legacy authentication (Basic Auth, SMTP, POP3, IMAP) does not support MFA and is a common attack vector. A CA policy should block all legacy authentication.',
        reference: 'CISA SCuBA MS.AAD.1.1',
        severity: 'high',
        area: 'entra_ca',
        testFn: (resources) => {
          const caPolicies = Object.values(resources || {})
          const legacyBlock = caPolicies.find(p =>
            p.state === 'enabled' &&
            p.grantControls?.builtInControls?.includes('block') &&
            p.conditions?.clientAppTypes?.some(t => ['exchangeActiveSync', 'other'].includes(t))
          )
          return {
            pass: !!legacyBlock,
            detail: legacyBlock
              ? `Policy "${legacyBlock.displayName}" blocks legacy authentication`
              : 'No CA policy found that blocks legacy authentication protocols',
          }
        }
      },
    ]
  },
  {
    id: 'auth_methods',
    label: 'Authentication Methods',
    icon: Shield,
    checks: [
      {
        id: 'auth.sms_disabled',
        name: 'SMS as authentication method is disabled',
        description: 'SMS-based authentication (OTP via text) is vulnerable to SIM-swapping attacks and should be disabled in favour of app-based MFA or FIDO2 keys.',
        reference: 'Maester: Entra.Config.AuthMethod.01',
        severity: 'high',
        area: 'entra_auth_policies',
        testFn: (resources) => {
          const authPolicy = resources?.auth_methods_policy
          if (!authPolicy) return { pass: null, detail: 'Authentication methods policy not available — ensure Policy.Read.All is granted and synced' }
          const smsConfig = (authPolicy.authenticationMethodConfigurations || []).find(m => m.id === 'Sms')
          return {
            pass: !smsConfig || smsConfig.state === 'disabled',
            detail: (!smsConfig || smsConfig.state === 'disabled')
              ? 'SMS authentication method is disabled'
              : 'SMS authentication method is enabled — consider disabling in favour of app-based MFA',
          }
        }
      },
      {
        id: 'auth.voice_disabled',
        name: 'Voice call as authentication method is disabled',
        description: 'Voice call authentication is susceptible to social engineering and SIM-swapping. It should be disabled in favour of stronger authentication methods.',
        reference: 'Maester: Entra.Config.AuthMethod.02',
        severity: 'medium',
        area: 'entra_auth_policies',
        testFn: (resources) => {
          const authPolicy = resources?.auth_methods_policy
          if (!authPolicy) return { pass: null, detail: 'Authentication methods policy not available' }
          const voiceConfig = (authPolicy.authenticationMethodConfigurations || []).find(m => m.id === 'Voice')
          return {
            pass: !voiceConfig || voiceConfig.state === 'disabled',
            detail: (!voiceConfig || voiceConfig.state === 'disabled')
              ? 'Voice call authentication method is disabled'
              : 'Voice call authentication method is enabled — consider disabling',
          }
        }
      },
      {
        id: 'auth.passwordless_enabled',
        name: 'Phishing-resistant authentication method enabled',
        description: 'At least one phishing-resistant method (FIDO2 security key, Windows Hello, or Microsoft Authenticator passwordless) should be enabled.',
        reference: 'Maester: Entra.Config.AuthMethod.03',
        severity: 'low',
        area: 'entra_auth_policies',
        testFn: (resources) => {
          const authPolicy = resources?.auth_methods_policy
          if (!authPolicy) return { pass: null, detail: 'Authentication methods policy not available' }
          const passwordlessMethods = ['Fido2', 'WindowsHello', 'MicrosoftAuthenticator']
          const enabled = (authPolicy.authenticationMethodConfigurations || []).filter(
            m => passwordlessMethods.includes(m.id) && m.state === 'enabled'
          )
          return {
            pass: enabled.length > 0,
            detail: enabled.length > 0
              ? `Passwordless methods enabled: ${enabled.map(m => m.id).join(', ')}`
              : 'No phishing-resistant authentication methods are enabled — consider enabling FIDO2 or Microsoft Authenticator',
          }
        }
      },
    ]
  },
  {
    id: 'guest_access',
    label: 'Guest & External Access',
    icon: Users,
    checks: [
      {
        id: 'guest.invite_policy',
        name: 'Guest invitations restricted to admins',
        description: 'The ability to invite guest users should be restricted to administrators or specific designated roles, not all members of the tenant.',
        reference: 'Maester: Entra.Config.Guest.01',
        severity: 'high',
        area: 'entra_auth_policies',
        testFn: (resources) => {
          const authPolicy = resources?.authorization_policy
          if (!authPolicy) return { pass: null, detail: 'Authorization policy not available' }
          const restrictedValues = ['adminsAndGuestInviters', 'none']
          const pass = restrictedValues.includes(authPolicy.allowInvitesFrom)
          return {
            pass,
            detail: pass
              ? `Guest invites restricted to: ${authPolicy.allowInvitesFrom}`
              : `Guest invites allowed from: ${authPolicy.allowInvitesFrom} — consider restricting to admins only`,
          }
        }
      },
      {
        id: 'guest.mfa_ca',
        name: 'MFA required for guest users via CA policy',
        description: 'Guest and external users should be required to complete MFA. A Conditional Access policy should target guest accounts explicitly.',
        reference: 'Maester: Entra.Config.Guest.02',
        severity: 'high',
        area: 'entra_ca',
        testFn: (resources) => {
          const caPolicies = Object.values(resources || {})
          const guestMfa = caPolicies.find(p =>
            p.state === 'enabled' &&
            p.grantControls?.builtInControls?.includes('mfa') &&
            (
              p.conditions?.users?.includeGuestsOrExternalUsers ||
              p.conditions?.users?.includeUsers?.includes('GuestsOrExternalUsers') ||
              p.conditions?.users?.includeUsers?.includes('All')
            )
          )
          return {
            pass: !!guestMfa,
            detail: guestMfa
              ? `Policy "${guestMfa.displayName}" requires MFA for guests`
              : 'No CA policy found that requires MFA for guest users',
          }
        }
      },
    ]
  },
  {
    id: 'admin_protection',
    label: 'Admin Account Protection',
    icon: ShieldCheck,
    checks: [
      {
        id: 'admin.ca_compliant_device',
        name: 'Admins required to use compliant or joined devices',
        description: 'Privileged administrator accounts should be required to sign in from compliant or Hybrid Azure AD Joined devices to reduce the risk of admin credential compromise.',
        reference: 'CISA SCuBA MS.AAD.3.3',
        severity: 'high',
        area: 'entra_ca',
        testFn: (resources) => {
          const caPolicies = Object.values(resources || {})
          const compliantDevicePolicy = caPolicies.find(p =>
            p.state === 'enabled' &&
            (
              p.grantControls?.builtInControls?.includes('compliantDevice') ||
              p.grantControls?.builtInControls?.includes('domainJoinedDevice')
            ) &&
            p.conditions?.users?.includeRoles?.length > 0
          )
          return {
            pass: !!compliantDevicePolicy,
            detail: compliantDevicePolicy
              ? `Policy "${compliantDevicePolicy.displayName}" requires compliant device for admins`
              : 'No CA policy found requiring admins to use a compliant or joined device',
          }
        }
      },
      {
        id: 'admin.global_admin_count',
        name: 'Permanent Global Administrator count is within range',
        description: 'Global Administrator is the most privileged role. Permanent (non-PIM) Global Administrators should be kept to a minimum — ideally 2-5 accounts.',
        reference: 'Maester: Entra.Config.Roles.01',
        severity: 'high',
        area: 'entra_roles',
        testFn: (resources) => {
          const roleAssignments = Object.values(resources || {})
          const globalAdmins = roleAssignments.filter(r =>
            r.roleName === 'Global Administrator' && r.directoryScopeId === '/'
          )
          const count = globalAdmins.length
          return {
            pass: count > 0 && count <= 5,
            detail: count === 0
              ? 'No Global Administrator assignments found (at least one is required)'
              : count <= 5
              ? `${count} permanent Global Administrator${count !== 1 ? 's' : ''} — within recommended range`
              : `${count} permanent Global Administrators found — consider reducing to 2-5 using PIM (Privileged Identity Management)`,
          }
        }
      },
    ]
  },
  {
    id: 'ca_hygiene',
    label: 'Conditional Access Hygiene',
    icon: Eye,
    checks: [
      {
        id: 'ca.no_report_only',
        name: 'No CA policies left in report-only mode',
        description: 'Conditional Access policies in report-only mode do not enforce controls — they only log. All intended policies should be in the enabled state.',
        reference: 'Maester: Entra.Config.CA.01',
        severity: 'medium',
        area: 'entra_ca',
        testFn: (resources) => {
          const caPolicies = Object.values(resources || {})
          const reportOnly = caPolicies.filter(p => p.state === 'enabledForReportingButNotEnforced')
          return {
            pass: reportOnly.length === 0,
            detail: reportOnly.length === 0
              ? 'No CA policies are in report-only mode'
              : `${reportOnly.length} CA polic${reportOnly.length !== 1 ? 'ies are' : 'y is'} in report-only mode: ${reportOnly.map(p => p.displayName).join(', ')}`,
          }
        }
      },
      {
        id: 'ca.no_disabled_policies',
        name: 'No CA policies permanently disabled',
        description: 'Disabled CA policies may represent intended controls that were turned off. Review and either enable or remove disabled policies.',
        reference: 'Maester: Entra.Config.CA.02',
        severity: 'low',
        area: 'entra_ca',
        testFn: (resources) => {
          const caPolicies = Object.values(resources || {})
          const disabled = caPolicies.filter(p => p.state === 'disabled')
          return {
            pass: disabled.length === 0,
            detail: disabled.length === 0
              ? 'No permanently disabled CA policies found'
              : `${disabled.length} CA polic${disabled.length !== 1 ? 'ies are' : 'y is'} disabled: ${disabled.slice(0,3).map(p => p.displayName).join(', ')}${disabled.length > 3 ? ` +${disabled.length - 3} more` : ''}`,
          }
        }
      },
    ]
  },
]

const SEVERITY_CONFIG = {
  critical: { cls: 'bg-red-950/40 border-red-800/60 text-red-300', label: 'Critical' },
  high:     { cls: 'bg-orange-950/30 border-orange-800/50 text-orange-300', label: 'High' },
  medium:   { cls: 'bg-yellow-950/30 border-yellow-800/50 text-yellow-300', label: 'Medium' },
  low:      { cls: 'bg-blue-950/30 border-blue-800/40 text-blue-300', label: 'Low' },
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

function CheckRow({ check, results }) {
  const [open, setOpen] = useState(false)
  const sev = SEVERITY_CONFIG[check.severity] || SEVERITY_CONFIG.low
  const tenantResults = Object.entries(results || {})

  const passCount = tenantResults.filter(([, r]) => r?.pass === true).length
  const failCount = tenantResults.filter(([, r]) => r?.pass === false).length

  return (
    <div className={`border rounded-xl overflow-hidden ${failCount > 0 ? 'border-red-900/50' : 'border-gray-800'}`}>
      <button className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.02] transition-colors"
        onClick={() => setOpen(v => !v)}>
        {failCount > 0
          ? <XCircle size={15} className="text-red-400 shrink-0"/>
          : passCount > 0
          ? <CheckCircle size={15} className="text-green-400 shrink-0"/>
          : <AlertCircle size={15} className="text-gray-600 shrink-0"/>}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-white text-sm">{check.name}</span>
            <span className={`text-xs px-1.5 py-0.5 rounded border ${sev.cls}`}>{sev.label}</span>
            {check.reference && <span className="text-xs text-gray-600">{check.reference}</span>}
          </div>
          {tenantResults.length > 0 && (
            <div className="flex items-center gap-2 mt-0.5">
              {failCount > 0 && <span className="text-xs text-red-400">{failCount} tenant{failCount !== 1 ? 's' : ''} failing</span>}
              {passCount > 0 && <span className="text-xs text-green-400">{passCount} passing</span>}
              {tenantResults.filter(([,r]) => r?.pass === null).length > 0 && (
                <span className="text-xs text-yellow-400">{tenantResults.filter(([,r]) => r?.pass === null).length} unavailable</span>
              )}
            </div>
          )}
        </div>
        {open ? <ChevronDown size={13} className="text-gray-600 shrink-0"/> : <ChevronRight size={13} className="text-gray-600 shrink-0"/>}
      </button>

      {open && (
        <div className="border-t border-gray-800 px-4 py-3 space-y-3">
          <p className="text-xs text-gray-400">{check.description}</p>

          {tenantResults.length === 0 ? (
            <p className="text-xs text-gray-600 italic">No tenants selected — tick tenants above to run this check.</p>
          ) : (
            <div className="space-y-2">
              {tenantResults.map(([tenantId, result]) => (
                <div key={tenantId} className={`rounded-lg border px-3 py-2 flex items-start gap-3 text-xs
                  ${result?.pass === false ? 'border-red-900/40 bg-red-950/10'
                  : result?.pass === true ? 'border-green-900/30 bg-green-950/10'
                  : 'border-gray-800'}`}>
                  <ResultBadge result={result}/>
                  <div className="flex-1">
                    <div className="text-gray-300 font-medium">{result?.tenantName || tenantId}</div>
                    {result?.detail && <div className="text-gray-500 mt-0.5">{result.detail}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function Templates({ showToast }) {
  const [tenants, setTenants] = useState([])
  const [selectedTenants, setSelectedTenants] = useState([])
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState({})
  const [expandedGroups, setExpandedGroups] = useState({})
  const [lastRun, setLastRun] = useState(null)

  useEffect(() => {
    tenantApi.list()
      .then(data => {
        setTenants(data)
        setSelectedTenants(data.map(t => t.id))
      })
      .catch(() => showToast('Failed to load tenants', 'error'))
  }, [])

  useEffect(() => {
    const init = {}
    SECURITY_CHECK_GROUPS.forEach(g => { init[g.id] = true })
    setExpandedGroups(init)
  }, [])

  const fetchLiveData = useCallback(async (tenantIds) => {
    const areaKeys = [...new Set(
      SECURITY_CHECK_GROUPS.flatMap(g => g.checks.map(c => c.area))
    )]
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
  }, [])

  const runChecks = async () => {
    if (selectedTenants.length === 0) { showToast('Select at least one tenant', 'error'); return }
    setRunning(true)
    try {
      const tenantMap = Object.fromEntries(tenants.map(t => [t.id, t.display_name]))
      const live = await fetchLiveData(selectedTenants)

      const newResults = {}
      for (const group of SECURITY_CHECK_GROUPS) {
        for (const check of group.checks) {
          newResults[check.id] = {}
          for (const tenantId of selectedTenants) {
            const areaResources = live[tenantId]?.[check.area]
            try {
              const result = check.testFn(areaResources)
              newResults[check.id][tenantId] = { ...result, tenantName: tenantMap[tenantId] || tenantId }
            } catch (err) {
              newResults[check.id][tenantId] = { pass: null, detail: `Error: ${err.message}`, tenantName: tenantMap[tenantId] || tenantId }
            }
          }
        }
      }
      setResults(newResults)
      setLastRun(new Date())
      showToast('Security checks complete', 'success')
    } catch {
      showToast('Check failed — ensure tenants have been synced first', 'error')
    } finally {
      setRunning(false)
    }
  }

  const toggleTenant = (id) => {
    setSelectedTenants(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const allCheckIds = SECURITY_CHECK_GROUPS.flatMap(g => g.checks.map(c => c.id))
  const totalPass = allCheckIds.reduce((n, id) => n + Object.values(results[id] || {}).filter(r => r?.pass === true).length, 0)
  const totalFail = allCheckIds.reduce((n, id) => n + Object.values(results[id] || {}).filter(r => r?.pass === false).length, 0)

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <ShieldCheck size={20} className="text-brand-500"/> Baseline Templates — Security Checks
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            Entra ID security configuration checks based on{' '}
            <a href="https://maester.dev" target="_blank" rel="noopener noreferrer"
              className="text-brand-400 hover:underline inline-flex items-center gap-0.5">
              Maester <ExternalLink size={10}/>
            </a>{' '}
            and CISA SCuBA guidelines. Runs across selected tenants independently of tenant baselines.
          </p>
        </div>
        <button onClick={runChecks} disabled={running || selectedTenants.length === 0} className="btn-primary">
          <RefreshCw size={13} className={running ? 'animate-spin' : ''}/>
          {running ? 'Running…' : 'Run Security Checks'}
        </button>
      </div>

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
          <h2 className="text-sm font-semibold text-white">Tenants to Check</h2>
          <div className="flex items-center gap-3">
            <button onClick={() => setSelectedTenants(tenants.map(t => t.id))}
              className="text-xs text-brand-400 hover:text-brand-300">All</button>
            <button onClick={() => setSelectedTenants([])}
              className="text-xs text-gray-500 hover:text-gray-300">None</button>
            <span className="text-xs text-gray-600">{selectedTenants.length} of {tenants.length} selected</span>
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
                  <input type="checkbox" checked={selected} onChange={() => toggleTenant(tenant.id)} className="accent-indigo-500"/>
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

      {/* Results summary */}
      {lastRun && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <div className="card-sm text-center">
              <div className="text-2xl font-bold text-green-400">{totalPass}</div>
              <div className="text-xs text-gray-500">Passing</div>
            </div>
            <div className="card-sm text-center">
              <div className={`text-2xl font-bold ${totalFail > 0 ? 'text-red-400' : 'text-gray-500'}`}>{totalFail}</div>
              <div className="text-xs text-gray-500">Failing</div>
            </div>
            <div className="card-sm text-center">
              <div className="text-2xl font-bold text-gray-300">{allCheckIds.length * selectedTenants.length}</div>
              <div className="text-xs text-gray-500">Total Checks</div>
            </div>
          </div>
          <p className="text-xs text-gray-600">Last run: {lastRun.toLocaleString()}</p>
        </>
      )}

      {/* Check groups */}
      {SECURITY_CHECK_GROUPS.map(group => {
        const Icon = group.icon
        const isOpen = expandedGroups[group.id] !== false
        const groupFail = group.checks.reduce((n, c) => n + Object.values(results[c.id] || {}).filter(r => r?.pass === false).length, 0)
        const groupPass = group.checks.reduce((n, c) => n + Object.values(results[c.id] || {}).filter(r => r?.pass === true).length, 0)

        return (
          <div key={group.id} className="space-y-2">
            <button className="flex items-center gap-2 w-full"
              onClick={() => setExpandedGroups(prev => ({ ...prev, [group.id]: !isOpen }))}>
              <Icon size={14} className="text-brand-500 shrink-0"/>
              <span className="text-sm font-semibold text-white">{group.label}</span>
              {groupFail > 0 && <span className="text-xs bg-red-900/40 text-red-400 border border-red-900/60 px-1.5 py-0.5 rounded">{groupFail} failing</span>}
              {groupPass > 0 && groupFail === 0 && <span className="text-xs bg-green-900/40 text-green-400 border border-green-900/60 px-1.5 py-0.5 rounded">All passing</span>}
              <div className="flex-1 h-px bg-gray-800"/>
              {isOpen ? <ChevronDown size={12} className="text-gray-600"/> : <ChevronRight size={12} className="text-gray-600"/>}
            </button>
            {isOpen && (
              <div className="space-y-2 ml-2">
                {group.checks.map(check => (
                  <CheckRow key={check.id} check={check} results={results[check.id]}/>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
