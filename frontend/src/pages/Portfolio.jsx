import { useState, useEffect, useCallback } from 'react'
import {
  RefreshCw, Download, AlertTriangle, CheckCircle, Circle,
  Tag, FileText, ChevronRight, Layers, ArrowUpDown,
  LayoutGrid, TableProperties, Users, AppWindow, Monitor,
  ShieldCheck, Building2, Wifi, Laptop, Search, X
} from 'lucide-react'
import { tenantApi } from '../api/client.js'
import GenerateReportModal from '../components/GenerateReportModal.jsx'

// ── localStorage helpers ──────────────────────────────────────────────────────
function lsGet(key, fallback) {
  try { const v = localStorage.getItem(key); return v !== null ? JSON.parse(v) : fallback } catch { return fallback }
}
function lsSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)) } catch {} }

const SORT_OPTIONS = [
  { key: 'drift-desc', label: 'Most drifted first' },
  { key: 'alpha',      label: 'A → Z' },
  { key: 'alpha-desc', label: 'Z → A' },
  { key: 'synced',     label: 'Recently synced' },
]

// ── Area column definitions — ordered by product then sub-group ───────────────
// subGroup drives visual separators and sub-labels in Matrix view
// tooltip drives title= attributes on pills and column headers
const AREA_COLS = [
  // ── Microsoft Entra ID ────────────────────────────────────────────────────
  { key: 'entra_roles',               label: 'Roles',    group: 'entra',  subGroup: 'entra',    tooltip: 'Role Assignments' },
  { key: 'entra_users',               label: 'Users',    group: 'entra',  subGroup: 'entra',    tooltip: 'User Accounts' },
  { key: 'entra_groups',              label: 'Groups',   group: 'entra',  subGroup: 'entra',    tooltip: 'Groups' },
  { key: 'entra_apps',                label: 'Apps',     group: 'entra',  subGroup: 'entra',    tooltip: 'App Registrations' },
  { key: 'entra_auth_policies',       label: 'Auth',     group: 'entra',  subGroup: 'entra',    tooltip: 'Authentication Policies' },
  { key: 'entra_ca',                  label: 'CA',       group: 'entra',  subGroup: 'entra',    tooltip: 'Conditional Access Policies' },
  // ── Microsoft Intune — Policy Management (v1.0) ────────────────────────
  { key: 'intune_compliance',         label: 'Compl.',   group: 'intune', subGroup: 'policy',   tooltip: 'Compliance Policies' },
  { key: 'intune_config_profiles',    label: 'Config',   group: 'intune', subGroup: 'policy',   tooltip: 'Configuration Profiles' },
  { key: 'intune_update_rings',       label: 'Updates',  group: 'intune', subGroup: 'policy',   tooltip: 'Windows Update Rings' },
  { key: 'intune_mtd_connectors',     label: 'MTD',      group: 'intune', subGroup: 'policy',   tooltip: 'Mobile Threat Defense Connectors' },
  { key: 'intune_app_protection',     label: 'MAM',      group: 'intune', subGroup: 'policy',   tooltip: 'App Protection Policies' },
  // ── Microsoft Intune — Endpoint Security (beta) ─────────────────────────
  { key: 'intune_ep_antivirus',       label: 'AV',       group: 'intune', subGroup: 'ep_sec',   tooltip: 'Endpoint Security — Antivirus' },
  { key: 'intune_ep_firewall',        label: 'FW',       group: 'intune', subGroup: 'ep_sec',   tooltip: 'Endpoint Security — Firewall' },
  { key: 'intune_ep_disk_encryption', label: 'BitLkr',   group: 'intune', subGroup: 'ep_sec',   tooltip: 'Endpoint Security — Disk Encryption (BitLocker)' },
  { key: 'intune_ep_asr',             label: 'ASR',      group: 'intune', subGroup: 'ep_sec',   tooltip: 'Endpoint Security — Attack Surface Reduction' },
  // ── Microsoft Exchange Online ───────────────────────────────────────────
  { key: 'exchange_mailboxes',        label: 'Mailboxes',       group: 'exchange', subGroup: 'exchange', tooltip: 'Exchange Mailboxes' },
  { key: 'exchange_mailbox_security', label: 'Mailbox Sec.',    group: 'exchange', subGroup: 'exchange', tooltip: 'Exchange Mailbox Security Settings' },
  { key: 'exchange_connectors',       label: 'Connectors',      group: 'exchange', subGroup: 'exchange', tooltip: 'Mail Flow Connectors' },
  { key: 'exchange_transport_rules',  label: 'Transport',       group: 'exchange', subGroup: 'exchange', tooltip: 'Transport Rules' },
  // ── SharePoint & Teams (separate sub-groups) ───────────────────────────
  { key: 'sharepoint_sites',          label: 'Sites',      group: 'sharepoint', subGroup: 'sharepoint', tooltip: 'SharePoint Sites' },
  { key: 'sharepoint_tenant_settings',label: 'Tenant Sec.',group: 'sharepoint', subGroup: 'sharepoint', tooltip: 'SharePoint Tenant Security Settings' },
  { key: 'teams_policies_messaging',  label: 'Msg Pol.',   group: 'teams', subGroup: 'teams', tooltip: 'Teams Messaging Policies' },
  { key: 'teams_policies_meetings',   label: 'Meet',       group: 'teams', subGroup: 'teams', tooltip: 'Teams Meeting Policies' },
  { key: 'teams_membership',          label: 'Members',    group: 'teams', subGroup: 'teams', tooltip: 'Team Membership' },
  { key: 'teams_app_permission_policies', label: 'App Perm', group: 'teams', subGroup: 'teams', tooltip: 'Teams App Permission Policies' },
  { key: 'teams_channels_policies',   label: 'Channels',   group: 'teams', subGroup: 'teams', tooltip: 'Teams Channels Policies' },
  { key: 'teams_org_app_settings',    label: 'Org Apps',   group: 'teams', subGroup: 'teams', tooltip: 'Teams Org App Settings' },
]

// Sub-group metadata: label and left-border marker for Matrix separators
const SUB_GROUP_META = {
  entra:     { label: 'Entra ID',          firstKey: 'entra_roles' },
  policy:    { label: 'Policies',          firstKey: 'intune_compliance' },
  ep_sec:    { label: 'Endpoint Security', firstKey: 'intune_ep_antivirus' },
  exchange:  { label: 'Exchange Online',   firstKey: 'exchange_mailboxes' },
  collab:    { label: 'Collaboration', firstKey: 'sharepoint_sites' },
  sharepoint:{ label: 'SharePoint',        firstKey: 'sharepoint_sites' },
  teams:     { label: 'Teams',             firstKey: 'teams_policies_messaging' },
}

// ── Shared helpers ────────────────────────────────────────────────────────────
function statusColor(status, drifts) {
  if (status === 'drifted') return 'text-red-400'
  if (status === 'clean')   return 'text-green-400'
  return 'text-gray-500'
}

// Baseline coverage score: clean baselined areas ÷ total baselined areas.
// Only baselined areas are counted — areas with no baseline are excluded because
// we cannot determine whether they are compliant or not.
// Returns null if no baselines have been set at all.
function complianceScore(tenant) {
  const areas = tenant.areas || []
  const baselined = areas.filter(a => a.hasBaseline)
  if (baselined.length === 0) return null
  const clean = baselined.filter(a =>
    a.drift?.status === 'clean' ||
    (a.drift?.status === 'drifted' && (a.drift?.drift_count || 0) === 0)
  ).length
  return Math.round((clean / baselined.length) * 100)
}

function formatSynced(ts) {
  if (!ts) return 'Never'
  const diff = Date.now() - new Date(ts).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1)   return 'Just now'
  if (mins < 60)  return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)   return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function ScoreBadge({ score }) {
  if (score === null) return <span className="text-xs text-gray-600 font-medium">No baselines</span>
  const color = score === 100 ? 'text-green-400' : score >= 75 ? 'text-yellow-400' : 'text-red-400'
  return <span className={`text-2xl font-bold tabular-nums ${color}`}>{score}%</span>
}

// ── Telemetry mini-section ────────────────────────────────────────────────────
function TelemetryRow({ tenant }) {
  const ov = tenant.overview
  const gr = tenant.guestRatio

  if (!ov && !gr) return (
    <div className="text-xs text-gray-700 mt-2 pt-2 border-t border-gray-800">
      No telemetry yet — sync this tenant to populate
    </div>
  )

  const groups  = ov?.groups
  const apps    = ov?.apps
  const devices = ov?.devices

  const deviceTotal = devices
    ? (devices.registered ?? 0) + (devices.joined ?? 0) + (devices.hybrid ?? 0)
    : null

  return (
    <div className="mt-3 pt-3 border-t border-gray-800 grid grid-cols-2 sm:grid-cols-4 gap-2">
      {/* Users & Guests */}
      {gr ? (
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-1 text-xs text-gray-500 mb-1">
            <Users size={10}/> <span>Users</span>
          </div>
          <div className="flex gap-3 text-xs">
            <span><span className="text-green-400 font-medium">{gr.members?.toLocaleString()}</span> <span className="text-gray-700">members</span></span>
            <span><span className="text-yellow-400 font-medium">{gr.guests?.toLocaleString()}</span> <span className="text-gray-700">guests</span></span>
          </div>
          {gr.disabled > 0 && <div className="text-xs text-gray-700">{gr.disabled} disabled</div>}
        </div>
      ) : <div/>}

      {/* Groups */}
      {groups ? (
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-1 text-xs text-gray-500 mb-1">
            <Layers size={10}/> <span>Groups <span className="text-gray-700">({groups.total})</span></span>
          </div>
          <div className="text-xs space-y-0.5">
            {groups.security > 0            && <div><span className="text-blue-400 font-medium">{groups.security}</span> <span className="text-gray-700">security</span></div>}
            {groups.m365 > 0               && <div><span className="text-indigo-400 font-medium">{groups.m365}</span> <span className="text-gray-700">M365</span></div>}
            {groups.mailEnabledSecurity > 0 && <div><span className="text-cyan-400 font-medium">{groups.mailEnabledSecurity}</span> <span className="text-gray-700">mail-sec</span></div>}
            {groups.distribution > 0        && <div><span className="text-violet-400 font-medium">{groups.distribution}</span> <span className="text-gray-700">dist.</span></div>}
          </div>
        </div>
      ) : <div/>}

      {/* App Registrations */}
      {apps ? (
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-1 text-xs text-gray-500 mb-1">
            <AppWindow size={10}/> <span>Apps <span className="text-gray-700">({apps.total})</span></span>
          </div>
          <div className="text-xs space-y-0.5">
            {apps.expired > 0    && <div className="flex items-center gap-1"><AlertTriangle size={9} className="text-red-400"/><span className="text-red-400 font-medium">{apps.expired} expired</span></div>}
            {apps.expiringSoon > 0 && <div className="flex items-center gap-1"><AlertTriangle size={9} className="text-yellow-400"/><span className="text-yellow-400 font-medium">{apps.expiringSoon} expiring</span></div>}
            {apps.expired === 0 && apps.expiringSoon === 0 && <div className="text-green-400">All credentials valid</div>}
          </div>
        </div>
      ) : <div/>}

      {/* Devices */}
      {deviceTotal !== null ? (
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-1 text-xs text-gray-500 mb-1">
            <Monitor size={10}/> <span>Devices <span className="text-gray-700">({deviceTotal})</span></span>
          </div>
          <div className="text-xs space-y-0.5">
            {devices.joined > 0     && <div><span className="text-blue-400 font-medium">{devices.joined}</span> <span className="text-gray-700">joined</span></div>}
            {devices.hybrid > 0     && <div><span className="text-indigo-400 font-medium">{devices.hybrid}</span> <span className="text-gray-700">hybrid</span></div>}
            {devices.registered > 0 && <div><span className="text-gray-400 font-medium">{devices.registered}</span> <span className="text-gray-700">registered</span></div>}
          </div>
        </div>
      ) : <div/>}
    </div>
  )
}

// ── VIEW A: Scorecard ─────────────────────────────────────────────────────────
function ScorecardView({ tenants, goToTenant, showToast }) {
  return (
    <div className="space-y-3">
      {tenants.map(tenant => {
        const score  = complianceScore(tenant)
        const status = tenant.overallStatus
        const borderClass =
          status === 'drifted'      ? 'border-l-[3px] border-red-700/60'
          : status === 'clean'      ? 'border-l-[3px] border-green-700/60'
          : status === 'partial'    ? 'border-l-[3px] border-yellow-700/60'
          : 'border-l-[3px] border-gray-700/40'

        const initials = tenant.display_name
          .split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase()).join('')

        const avatarColor =
          status === 'drifted'   ? 'bg-red-950/60 text-red-400'
          : status === 'clean'   ? 'bg-green-950/60 text-green-400'
          : status === 'partial' ? 'bg-yellow-950/60 text-yellow-400'
          : 'bg-gray-800 text-gray-400'

        return (
          <div key={tenant.id}
            className={`card rounded-l-none ${borderClass}`}>

            {/* Top row */}
            <div className="flex items-start gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold shrink-0 ${avatarColor}`}>
                {initials}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-white text-sm">{tenant.display_name}</span>
                  {(tenant.tags || []).map(tag => (
                    <span key={tag} className="text-xs bg-gray-800 text-gray-400 border border-gray-700 px-1.5 py-0.5 rounded flex items-center gap-1">
                      <Tag size={9}/> {tag}
                    </span>
                  ))}
                </div>
                <p className="text-xs text-gray-600 font-mono mt-0.5">{tenant.tenant_id}</p>

                {/* Area coverage bar */}
                <div className="mt-2">
                  <div className="flex gap-0.5 h-1.5 rounded-full overflow-hidden w-full max-w-xs">
                    {tenant.areas?.map(area => {
                      const s = area.drift?.status
                      const dc = area.drift?.drift_count || 0
                      const isClean   = s === 'clean' || (s === 'drifted' && dc === 0)
                      const isDrifted = s === 'drifted' && dc > 0
                      return (
                        <div key={area.areaKey}
                          className={`flex-1 ${isClean ? 'bg-green-500/70' : isDrifted ? 'bg-red-500' : area.hasBaseline ? 'bg-yellow-500/60' : 'bg-gray-700'}`}/>
                      )
                    })}
                  </div>
                  <div className="flex gap-3 text-xs text-gray-600 mt-1">
                    {tenant.cleanAreas > 0    && <span className="text-green-600">{tenant.cleanAreas} clean</span>}
                    {tenant.driftedAreas > 0  && <span className="text-red-500">{tenant.driftedAreas} drifted</span>}
                    {tenant.noBaselineAreas > 0 && <span>{tenant.noBaselineAreas} no baseline</span>}
                  </div>
                </div>
              </div>

              {/* Right col: score + meta */}
              <div className="shrink-0 text-right space-y-1">
                <ScoreBadge score={score}/>
                <div className="text-xs text-gray-600">baseline coverage</div>
                {tenant.totalDrifts > 0 && (
                  <div className="text-xs text-red-400 font-medium">{tenant.totalDrifts} drift{tenant.totalDrifts !== 1 ? 's' : ''}</div>
                )}
              </div>

              <button onClick={() => goToTenant(tenant)} className="btn-secondary text-xs shrink-0 self-start">
                View <ChevronRight size={12}/>
              </button>
            </div>

            {/* Area pills — grouped into left/right columns for better layout */}
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Left column: Entra ID + Intune (Policies + Endpoint Security) */}
              <div className="space-y-2">
                <div>
                  <div className="text-xs text-brand-500/70 font-medium mb-1 uppercase tracking-wide">Entra ID</div>
                  <div className="flex flex-wrap gap-1">
                    {AREA_COLS.filter(c => c.group === 'entra').map(col => {
                      const area = tenant.areas?.find(a => a.areaKey === col.key)
                      const s  = area?.drift?.status
                      const dc = area?.drift?.drift_count || 0
                      const nb = area && !area.hasBaseline
                      const isClean   = s === 'clean' || (s === 'drifted' && dc === 0)
                      const isDrifted = s === 'drifted' && dc > 0
                      return (
                        <span key={col.key} title={col.tooltip}
                          className={`text-xs px-2 py-0.5 rounded border font-medium cursor-default
                            ${isClean   ? 'bg-green-950/30 border-green-900/50 text-green-400'
                            : isDrifted ? 'bg-red-950/30 border-red-900/50 text-red-400'
                            : nb        ? 'bg-yellow-950/20 border-yellow-900/30 text-yellow-600'
                            : 'bg-gray-800/40 border-gray-700/40 text-gray-600'}`}>
                          {col.label}{isDrifted && ` · ${dc}`}
                        </span>
                      )
                    })}
                  </div>
                </div>

                {[
                  { sg: 'policy',    label: 'Intune Policies' },
                  { sg: 'ep_sec',    label: 'Endpoint Security' },
                ].map(({ sg, label }) => {
                  const cols = AREA_COLS.filter(c => c.subGroup === sg)
                  return (
                    <div key={sg}>
                      <div className="text-xs text-green-600/70 font-medium mb-1 uppercase tracking-wide">{label}</div>
                      <div className="flex flex-wrap gap-1">
                        {cols.map(col => {
                          const area = tenant.areas?.find(a => a.areaKey === col.key)
                          const s  = area?.drift?.status
                          const dc = area?.drift?.drift_count || 0
                          const nb = area && !area.hasBaseline
                          const isClean   = s === 'clean' || (s === 'drifted' && dc === 0)
                          const isDrifted = s === 'drifted' && dc > 0
                          return (
                            <span key={col.key} title={col.tooltip}
                              className={`text-xs px-2 py-0.5 rounded border font-medium cursor-default
                                ${isClean   ? 'bg-green-950/30 border-green-900/50 text-green-400'
                                : isDrifted ? 'bg-red-950/30 border-red-900/50 text-red-400'
                                : nb        ? 'bg-yellow-950/20 border-yellow-900/30 text-yellow-600'
                                : 'bg-gray-800/40 border-gray-700/40 text-gray-600'}`}>
                              {col.label}{isDrifted && ` · ${dc}`}
                            </span>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Right column: Exchange + SharePoint + Teams */}
              <div className="space-y-2">
                <div>
                  <div className="text-xs text-amber-500/70 font-medium mb-1 uppercase tracking-wide">Exchange</div>
                  <div className="flex flex-wrap gap-1">
                    {AREA_COLS.filter(c => c.group === 'exchange').map(col => {
                      const area = tenant.areas?.find(a => a.areaKey === col.key)
                      const s  = area?.drift?.status
                      const dc = area?.drift?.drift_count || 0
                      const nb = area && !area.hasBaseline
                      const isClean   = s === 'clean' || (s === 'drifted' && dc === 0)
                      const isDrifted = s === 'drifted' && dc > 0
                      return (
                        <span key={col.key} title={col.tooltip}
                          className={`text-xs px-2 py-0.5 rounded border font-medium cursor-default
                            ${isClean   ? 'bg-green-950/30 border-green-900/50 text-green-400'
                            : isDrifted ? 'bg-red-950/30 border-red-900/50 text-red-400'
                            : nb        ? 'bg-yellow-950/20 border-yellow-900/30 text-yellow-600'
                            : 'bg-gray-800/40 border-gray-700/40 text-gray-600'}`}>
                          {col.label}{isDrifted && ` · ${dc}`}
                        </span>
                      )
                    })}
                  </div>
                </div>

                <div>
                  <div className="text-xs text-sky-500/70 font-medium mb-1 uppercase tracking-wide">SharePoint</div>
                  <div className="flex flex-wrap gap-1">
                    {AREA_COLS.filter(c => c.group === 'sharepoint').map(col => {
                      const area = tenant.areas?.find(a => a.areaKey === col.key)
                      const s  = area?.drift?.status
                      const dc = area?.drift?.drift_count || 0
                      const nb = area && !area.hasBaseline
                      const isClean   = s === 'clean' || (s === 'drifted' && dc === 0)
                      const isDrifted = s === 'drifted' && dc > 0
                      return (
                        <span key={col.key} title={col.tooltip}
                          className={`text-xs px-2 py-0.5 rounded border font-medium cursor-default
                            ${isClean   ? 'bg-green-950/30 border-green-900/50 text-green-400'
                            : isDrifted ? 'bg-red-950/30 border-red-900/50 text-red-400'
                            : nb        ? 'bg-yellow-950/20 border-yellow-900/30 text-yellow-600'
                            : 'bg-gray-800/40 border-gray-700/40 text-gray-600'}`}>
                          {col.label}{isDrifted && ` · ${dc}`}
                        </span>
                      )
                    })}
                  </div>
                </div>

                <div>
                  <div className="text-xs text-violet-500/70 font-medium mb-1 uppercase tracking-wide">Teams</div>
                  <div className="flex flex-wrap gap-1">
                    {AREA_COLS.filter(c => c.group === 'teams').map(col => {
                      const area = tenant.areas?.find(a => a.areaKey === col.key)
                      const s  = area?.drift?.status
                      const dc = area?.drift?.drift_count || 0
                      const nb = area && !area.hasBaseline
                      const isClean   = s === 'clean' || (s === 'drifted' && dc === 0)
                      const isDrifted = s === 'drifted' && dc > 0
                      return (
                        <span key={col.key} title={col.tooltip}
                          className={`text-xs px-2 py-0.5 rounded border font-medium cursor-default
                            ${isClean   ? 'bg-green-950/30 border-green-900/50 text-green-400'
                            : isDrifted ? 'bg-red-950/30 border-red-900/50 text-red-400'
                            : nb        ? 'bg-yellow-950/20 border-yellow-900/30 text-yellow-600'
                            : 'bg-gray-800/40 border-gray-700/40 text-gray-600'}`}>
                          {col.label}{isDrifted && ` · ${dc}`}
                        </span>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* Telemetry */}
            <TelemetryRow tenant={tenant}/>

            {/* Sync footer */}
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-800/60">
              <span className="text-xs text-gray-700">Last sync: {formatSynced(tenant.last_synced_at)}</span>
              <div className="flex gap-2">
                {tenant.totalDrifts > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {(tenant.areas || []).filter(a =>
                      a.drift?.status === 'drifted' && (a.drift?.drift_count || 0) > 0
                    ).map(area => (
                      <button key={area.areaKey}
                        onClick={() => goToTenant(tenant, area.areaKey)}
                        className="text-xs text-red-400 border border-red-900/40 hover:bg-red-950/30 px-2 py-0.5 rounded transition-colors flex items-center gap-1">
                        <AlertTriangle size={9}/> {area.displayName}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── VIEW B: Matrix ────────────────────────────────────────────────────────────
function MatrixView({ tenants, goToTenant }) {
  const entraCols   = AREA_COLS.filter(c => c.group === 'entra')
  const policyCols  = AREA_COLS.filter(c => c.subGroup === 'policy')
  const epSecCols   = AREA_COLS.filter(c => c.subGroup === 'ep_sec')
  const exchangeCols = AREA_COLS.filter(c => c.group === 'exchange')
  const sharepointCols = AREA_COLS.filter(c => c.group === 'sharepoint')
  const teamsCols = AREA_COLS.filter(c => c.group === 'teams')

  // Helper: determine if a column is the first in its sub-group (gets a left separator)
  const isSubGroupStart = (col) => col.key === SUB_GROUP_META[col.subGroup]?.firstKey

  return (
    <div className="card p-0 overflow-x-auto">
      <table className="w-full" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
        <thead>
          {/* Row 1: product group headers */}
          <tr>
            <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 border-b border-gray-800 min-w-[200px]">Tenant</th>
            <th colSpan={entraCols.length}
              className="text-center px-2 py-1.5 text-xs font-semibold text-brand-400 border-b border-gray-800 border-l border-gray-700/60">
              Microsoft Entra ID
            </th>
            <th colSpan={policyCols.length}
              className="text-center px-2 py-1.5 text-xs font-semibold text-emerald-500 border-b border-gray-800 border-l border-gray-700">
              Intune — Policies
            </th>
            <th colSpan={epSecCols.length}
              className="text-center px-2 py-1.5 text-xs font-semibold text-orange-400 border-b border-gray-800 border-l border-gray-700">
              Endpoint Security
            </th>
            <th colSpan={exchangeCols.length}
              className="text-center px-2 py-1.5 text-xs font-semibold text-amber-500 border-b border-gray-800 border-l border-gray-700">
              Exchange Online
            </th>
            <th colSpan={sharepointCols.length}
              className="text-center px-2 py-1.5 text-xs font-semibold text-sky-400 border-b border-gray-800 border-l border-gray-700">
              SharePoint
            </th>
            <th colSpan={teamsCols.length}
              className="text-center px-2 py-1.5 text-xs font-semibold text-violet-400 border-b border-gray-800 border-l border-gray-700">
              Teams
            </th>
            <th className="text-right px-3 py-2 text-xs font-medium text-gray-500 border-b border-gray-800 border-l border-gray-800/60">Coverage</th>
            <th className="text-right px-3 py-2 text-xs font-medium text-gray-500 border-b border-gray-800">Drifts</th>
          </tr>
          {/* Row 2: individual column labels with tooltips */}
          <tr>
            <th className="text-left px-4 py-1.5 border-b border-gray-800/60 bg-gray-900/20"/>
            {AREA_COLS.map((col) => (
              <th key={col.key} title={col.tooltip}
                className={`text-center px-1 py-1.5 text-xs text-gray-500 border-b border-gray-800/60 font-medium
                  ${isSubGroupStart(col) ? 'border-l border-gray-700' : ''}`}>
                {col.label}
              </th>
            ))}
            <th className="border-b border-gray-800/60 border-l border-gray-800/60"/>
            <th className="border-b border-gray-800/60"/>
          </tr>
        </thead>
        <tbody>
          {tenants.map((tenant, ti) => {
            const score = complianceScore(tenant)
            const isLast = ti === tenants.length - 1
            const rowBorder = isLast ? '' : 'border-b border-gray-800/40'
            return (
              <tr key={tenant.id} className="group hover:bg-gray-800/20 transition-colors">
                <td className={`px-4 py-3 ${rowBorder}`}>
                  <button onClick={() => goToTenant(tenant)} className="text-left w-full">
                    <div className="text-sm font-medium text-white group-hover:text-brand-300 transition-colors">
                      {tenant.display_name}
                    </div>
                    <div className="text-xs text-gray-600 font-mono mt-0.5">{tenant.tenant_id?.slice(0,8)}…</div>
                    {(tenant.tags || []).length > 0 && (
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {tenant.tags.map(t => (
                          <span key={t} className="text-xs text-gray-600 bg-gray-800/60 border border-gray-700/40 px-1.5 py-0 rounded">{t}</span>
                        ))}
                      </div>
                    )}
                  </button>
                </td>
                {AREA_COLS.map((col) => {
                  const area = tenant.areas?.find(a => a.areaKey === col.key)
                  const s  = area?.drift?.status
                  const dc = area?.drift?.drift_count || 0
                  const nb = area && !area.hasBaseline
                  const effectiveClean   = s === 'clean' || (s === 'drifted' && dc === 0)
                  const effectiveDrifted = s === 'drifted' && dc > 0
                  return (
                    <td key={col.key} title={col.tooltip}
                      className={`text-center px-1 py-2 ${rowBorder}
                        ${isSubGroupStart(col) ? 'border-l border-gray-700' : ''}`}>
                      {!area ? (
                        <span className="text-gray-700 text-xs">·</span>
                      ) : effectiveClean ? (
                        <span className="inline-flex items-center justify-center w-6 h-6 rounded bg-green-950/40 text-green-400 text-xs font-bold">✓</span>
                      ) : effectiveDrifted ? (
                        <button onClick={() => goToTenant(tenant, col.key)}
                          className="inline-flex items-center justify-center min-w-[24px] h-6 px-1 rounded bg-red-950/60 text-red-400 text-xs font-bold hover:bg-red-950 transition-colors">
                          {dc}
                        </button>
                      ) : nb ? (
                        <span className="inline-flex items-center justify-center w-6 h-6 rounded bg-yellow-950/20 text-yellow-700 text-xs">—</span>
                      ) : (
                        <span className="inline-flex items-center justify-center w-6 h-6 rounded bg-gray-800/40 text-gray-700 text-xs">·</span>
                      )}
                    </td>
                  )
                })}
                <td className={`text-right px-3 py-2 ${rowBorder} border-l border-gray-800/60`}>
                  <ScoreBadge score={score}/>
                </td>
                <td className={`text-right px-3 py-2 ${rowBorder}`}>
                  {tenant.totalDrifts > 0
                    ? <span className="text-sm font-bold text-red-400">{tenant.totalDrifts}</span>
                    : <span className="text-sm text-green-500">0</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {/* Matrix legend */}
      <div className="px-4 py-3 border-t border-gray-800 flex items-center gap-5 flex-wrap">
        {[
          { cell: <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-green-950/40 text-green-400 text-xs font-bold">✓</span>, label: 'Clean' },
          { cell: <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-red-950/60 text-red-400 text-xs font-bold">n</span>, label: 'Drifted (count)' },
          { cell: <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-yellow-950/20 text-yellow-700 text-xs font-bold">—</span>, label: 'No baseline' },
          { cell: <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-gray-800/40 text-gray-700 text-xs">·</span>, label: 'Not synced' },
        ].map(({ cell, label }) => (
          <div key={label} className="flex items-center gap-1.5 text-xs text-gray-600">
            {cell} {label}
          </div>
        ))}
        <div className="ml-auto flex items-center gap-4 text-xs text-gray-700">
          <span className="text-brand-400/60">■ Entra ID</span>
          <span className="text-emerald-500/60">■ Intune Policies</span>
          <span className="text-orange-400/60">■ Endpoint Security</span>
          <span className="text-sky-400/60">■ Telemetry</span>
        </div>
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Portfolio({ navigate, setSelectedTenant, showToast }) {
  const [portfolio,    setPortfolio]    = useState([])
  const [loading,      setLoading]      = useState(true)
  const [bulkSyncing,  setBulkSyncing]  = useState(false)
  const [bulkSyncId,   setBulkSyncId]   = useState(null)
  const [bulkProgress, setBulkProgress] = useState(null)
  const [showReportModal, setShowReportModal] = useState(false)

  const [filterTag,    setFilterTag]    = useState(() => lsGet('trustm365_portfolio_tag',    ''))
  const [filterStatus, setFilterStatus] = useState(() => lsGet('trustm365_portfolio_status', ''))
  const [filterSearch, setFilterSearch] = useState(() => lsGet('trustm365_portfolio_search', ''))
  const [sortKey,      setSortKey]      = useState(() => lsGet('trustm365_portfolio_sort',   'drift-desc'))
  const [showSort,     setShowSort]     = useState(false)
  const [viewMode,     setViewMode]     = useState(() => lsGet('trustm365_portfolio_view',   'scorecard'))

  const setAndSaveTag    = v => { setFilterTag(v);    lsSet('trustm365_portfolio_tag',    v) }
  const setAndSaveStatus = v => { setFilterStatus(v); lsSet('trustm365_portfolio_status', v) }
  const setAndSaveSearch = v => { setFilterSearch(v); lsSet('trustm365_portfolio_search', v) }
  const setAndSaveSort   = v => { setSortKey(v);      lsSet('trustm365_portfolio_sort',   v); setShowSort(false) }
  const setAndSaveView   = v => { setViewMode(v);     lsSet('trustm365_portfolio_view',   v) }

  const clearAllFilters = () => { setAndSaveStatus(''); setAndSaveTag(''); setAndSaveSearch('') }
  const hasActiveFilters = !!(filterStatus || filterTag || filterSearch)

  const load = useCallback(async () => {
    try {
      const data = await tenantApi.portfolio()
      setPortfolio(data)
    } catch { showToast('Failed to load portfolio', 'error') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!bulkSyncId) return
    const interval = setInterval(async () => {
      try {
        const status = await tenantApi.bulkSyncStatus(bulkSyncId)
        setBulkProgress(status)
        if (status.completed_at) {
          clearInterval(interval)
          setBulkSyncing(false)
          load()
          showToast(`Bulk sync complete — ${status.success_count}/${status.tenant_count} tenants synced`, 'success')
        }
      } catch { clearInterval(interval) }
    }, 2500)
    return () => clearInterval(interval)
  }, [bulkSyncId])

  const startBulkSync = async () => {
    setBulkSyncing(true)
    setBulkProgress(null)
    try {
      const { bulkSyncId: id } = await tenantApi.bulkSync()
      setBulkSyncId(id)
    } catch (err) {
      setBulkSyncing(false)
      showToast(err.response?.data?.error || 'Bulk sync failed', 'error')
    }
  }

  const exportCSV = async () => {
    try {
      const blob = await tenantApi.exportDriftReport('csv')
      const url = URL.createObjectURL(new Blob([blob], { type: 'text/csv' }))
      const a = document.createElement('a'); a.href = url
      a.download = `trustm365-drift-${new Date().toISOString().split('T')[0]}.csv`
      a.click(); URL.revokeObjectURL(url)
    } catch { showToast('Export failed', 'error') }
  }

  const exportJSON = async () => {
    try {
      const data = await tenantApi.exportDriftReport('json')
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
      const a = document.createElement('a'); a.href = url
      a.download = `trustm365-drift-${new Date().toISOString().split('T')[0]}.json`
      a.click(); URL.revokeObjectURL(url)
    } catch { showToast('Export failed', 'error') }
  }

  const goToTenant = (tenant, areaKey = null) => {
    const t = { id: tenant.id, display_name: tenant.display_name, tenant_id: tenant.tenant_id }
    setSelectedTenant(t)
    navigate(areaKey ? `/area/${tenant.id}/${areaKey}` : '/')
  }

  const allTags = [...new Set(portfolio.flatMap(t => t.tags || []))].sort()

  const filtered = portfolio.filter(t => {
    if (filterTag && !(t.tags || []).includes(filterTag)) return false
    if (filterStatus && t.overallStatus !== filterStatus) return false
    if (filterSearch) {
      const q = filterSearch.toLowerCase()
      const nameMatch = t.display_name?.toLowerCase().includes(q)
      const idMatch   = t.tenant_id?.toLowerCase().includes(q)
      const tagMatch  = (t.tags || []).some(tag => tag.toLowerCase().includes(q))
      if (!nameMatch && !idMatch && !tagMatch) return false
    }
    return true
  })

  const sorted = [...filtered].sort((a, b) => {
    switch (sortKey) {
      case 'drift-desc': {
        const da = a.totalDrifts || 0; const db = b.totalDrifts || 0
        return db - da
      }
      case 'alpha':      return a.display_name.localeCompare(b.display_name)
      case 'alpha-desc': return b.display_name.localeCompare(a.display_name)
      case 'synced':     return (b.last_synced_at || '').localeCompare(a.last_synced_at || '')
      default:           return 0
    }
  })

  const total        = portfolio.length
  const drifted      = portfolio.filter(t => t.overallStatus === 'drifted').length
  const clean        = portfolio.filter(t => t.overallStatus === 'clean').length
  const unconfigured = portfolio.filter(t => t.overallStatus === 'unconfigured').length

  if (loading) return <div className="flex items-center justify-center h-full text-gray-500">Loading portfolio…</div>

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Layers size={20} className="text-brand-500"/> MSSP Portfolio
          </h1>
          <p className="text-gray-500 text-sm mt-1">Cross-tenant drift status and telemetry</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* View toggle */}
          <div className="flex items-center border border-gray-700 rounded-lg overflow-hidden">
            <button onClick={() => setAndSaveView('scorecard')}
              title="Scorecard view"
              className={`px-2.5 py-1.5 text-xs flex items-center gap-1.5 transition-colors
                ${viewMode === 'scorecard' ? 'bg-brand-700/50 text-brand-300' : 'text-gray-500 hover:text-gray-300'}`}>
              <LayoutGrid size={13}/> Scorecard
            </button>
            <div className="w-px h-5 bg-gray-700"/>
            <button onClick={() => setAndSaveView('matrix')}
              title="Matrix view"
              className={`px-2.5 py-1.5 text-xs flex items-center gap-1.5 transition-colors
                ${viewMode === 'matrix' ? 'bg-brand-700/50 text-brand-300' : 'text-gray-500 hover:text-gray-300'}`}>
              <TableProperties size={13}/> Matrix
            </button>
          </div>

          <button onClick={exportCSV} className="btn-secondary">
            <FileText size={13}/> CSV
          </button>
          <button onClick={exportJSON} className="btn-secondary">
            <Download size={13}/> JSON
          </button>
          <button onClick={() => setShowReportModal(true)} className="btn-secondary">
            <FileText size={13}/> Report
          </button>
          <button onClick={startBulkSync} disabled={bulkSyncing} className="btn-primary">
            <RefreshCw size={13} className={bulkSyncing ? 'animate-spin' : ''}/>
            {bulkSyncing ? 'Syncing…' : 'Sync All'}
          </button>
        </div>
      </div>

      {/* Bulk sync progress */}
      {bulkSyncing && bulkProgress && (
        <div className="card border-brand-700/40 border space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-300 font-medium">Bulk sync in progress</span>
            <span className="text-gray-500">{bulkProgress.success_count + bulkProgress.error_count} / {bulkProgress.tenant_count}</span>
          </div>
          <div className="w-full bg-gray-800 rounded-full h-1.5">
            <div className="bg-brand-500 h-1.5 rounded-full transition-all"
              style={{ width: `${((bulkProgress.success_count + bulkProgress.error_count) / bulkProgress.tenant_count) * 100}%` }}/>
          </div>
        </div>
      )}

      {/* Summary strip — tenant-level counts only */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Tenants',      value: total,        color: 'text-white' },
          { label: 'Drifted',      value: drifted,      color: drifted > 0 ? 'text-red-400' : 'text-gray-500' },
          { label: 'Clean',        value: clean,        color: 'text-green-400' },
          { label: 'No Baselines', value: unconfigured, color: 'text-gray-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="card-sm text-center">
            <div className={`text-2xl font-bold tabular-nums ${color}`}>{value}</div>
            <div className="text-xs text-gray-500 mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* Filters + Sort */}
      {(allTags.length > 0 || portfolio.length > 2) && (
        <div className="space-y-2">
          {/* Search input */}
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-600 pointer-events-none"/>
            <input
              className="input w-full pl-7 py-1.5 text-xs"
              placeholder="Search tenants by name, ID or tag…"
              value={filterSearch}
              onChange={e => setAndSaveSearch(e.target.value)}
            />
            {filterSearch && (
              <button onClick={() => setAndSaveSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400 transition-colors">
                <X size={11}/>
              </button>
            )}
          </div>
          {/* Status + tag pills + sort */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-500">Filter:</span>
            <button onClick={() => { setAndSaveStatus(''); setAndSaveTag('') }}
              className={`text-xs px-2 py-1 rounded border transition-colors ${!filterStatus && !filterTag ? 'bg-brand-700 border-brand-600 text-white' : 'border-gray-700 text-gray-400 hover:text-white'}`}>
              All
            </button>
            {['drifted', 'clean', 'partial', 'unconfigured'].map(s => (
              <button key={s} onClick={() => setAndSaveStatus(filterStatus === s ? '' : s)}
                className={`text-xs px-2 py-1 rounded border transition-colors capitalize ${filterStatus === s ? 'bg-brand-700 border-brand-600 text-white' : 'border-gray-700 text-gray-400 hover:text-white'}`}>
                {s}
              </button>
            ))}
            {allTags.map(tag => (
              <button key={tag} onClick={() => setAndSaveTag(filterTag === tag ? '' : tag)}
                className={`text-xs px-2 py-1 rounded border transition-colors flex items-center gap-1 ${filterTag === tag ? 'bg-brand-700 border-brand-600 text-white' : 'border-gray-700 text-gray-400 hover:text-white'}`}>
                <Tag size={10}/> {tag}
              </button>
            ))}
            {hasActiveFilters && (
              <button onClick={clearAllFilters}
                className="text-xs text-gray-600 hover:text-red-400 transition-colors flex items-center gap-1 ml-1">
                <X size={10}/> Clear
              </button>
            )}
            <div className="ml-auto relative">
              <button onClick={() => setShowSort(v => !v)}
                className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border transition-colors
                  ${showSort ? 'border-brand-600 text-brand-300' : 'border-gray-700 text-gray-400 hover:text-white'}`}>
                <ArrowUpDown size={11}/>
                {SORT_OPTIONS.find(o => o.key === sortKey)?.label || 'Sort'}
              </button>
              {showSort && (
                <div className="absolute right-0 top-full mt-1 w-44 bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-10 overflow-hidden">
                  {SORT_OPTIONS.map(opt => (
                    <button key={opt.key} onClick={() => setAndSaveSort(opt.key)}
                      className={`w-full text-left text-xs px-3 py-2 transition-colors
                        ${sortKey === opt.key ? 'bg-brand-900/60 text-brand-300' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {sorted.length === 0 && portfolio.length > 0 && (
        <p className="text-xs text-gray-600">No tenants match the current filter.</p>
      )}

      {/* Empty state */}
      {portfolio.length === 0 ? (
        <div className="card text-center py-12">
          <Layers size={40} className="text-gray-700 mx-auto mb-3"/>
          <p className="text-gray-400 mb-4">No tenants registered yet.</p>
          <button onClick={() => navigate('/add-tenant')} className="btn-primary mx-auto">Register First Tenant</button>
        </div>
      ) : viewMode === 'scorecard' ? (
        <ScorecardView tenants={sorted} goToTenant={goToTenant} showToast={showToast}/>
      ) : (
        <MatrixView tenants={sorted} goToTenant={goToTenant}/>
      )}

      {showReportModal && (
        <GenerateReportModal
          onClose={() => setShowReportModal(false)}
          onGenerated={(fullReport) => {
            setShowReportModal(false)
            showToast('Portfolio report generated — opening viewer', 'success')
            navigate('/reports')
          }}
          showToast={showToast}
        />
      )}
    </div>
  )
}
