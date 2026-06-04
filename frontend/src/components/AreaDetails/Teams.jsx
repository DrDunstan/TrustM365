import React, { useEffect, useState } from 'react'
import { areaApi } from '../../api/client.js'

export default function TeamsArea({ tenantId, areaKey, liveData, baseline }) {
  const specificTeamsCollectors = [
    'teams_policies_meetings',
    'teams_membership',
    'teams_policies_messaging',
    'teams_app_permission_policies',
    'teams_channels_policies',
    'teams_org_app_settings',
  ]
  // Use any available live snapshot for teams summary; allow rendering even
  // when the groups-based `teams_teams` snapshot is not present so we can
  // show the other Teams collectors individually.
  const resources = (liveData && liveData.resources) || {}
  const ids = Object.keys(resources)
  const totalTeams = ids.length
  let guestCount = 0
  let installedAppCount = 0
  const privilegedApps = []

  for (const id of ids) {
    const r = resources[id] || {}
    guestCount += Number(r.guestCount || 0)
    installedAppCount += Number(r.installedAppCount || 0)
    if (Array.isArray(r.privilegedInstalledApps)) {
      for (const a of r.privilegedInstalledApps) {
        const key = a.teamsAppId || a.id || JSON.stringify(a)
        privilegedApps.push({ key, app: a, teamName: r.displayName || id })
      }
    }
  }

  const seen = new Set()
  const topPrivileged = privilegedApps.filter(p => {
    if (seen.has(p.key)) return false
    seen.add(p.key)
    return true
  }).slice(0, 5)

  const showSummary = !specificTeamsCollectors.includes(areaKey)

  return (
    <div>
      {showSummary && !liveData && (
        <div className="mb-3">
          <p className="mt-2 text-xs text-gray-500">No teams summary available — use the <strong>Pull Live Data</strong> action to retrieve Teams from Microsoft Graph.</p>
        </div>
      )}

      {showSummary && (
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="card-sm p-3">
          <div className="text-xs text-gray-400">Teams</div>
          <div className="text-lg font-bold text-white">{totalTeams}</div>
        </div>
        <div className="card-sm p-3">
          <div className="text-xs text-gray-400">Guest members</div>
          <div className="text-lg font-bold text-white">{guestCount}</div>
        </div>
        <div className="card-sm p-3">
          <div className="text-xs text-gray-400">Installed apps</div>
          <div className="text-lg font-bold text-white">{installedAppCount}</div>
        </div>
      </div>
      )}

      {showSummary && topPrivileged.length > 0 && (
        <div className="card p-3 space-y-2">
          <div className="text-sm font-medium text-gray-300">Privileged / notable installed apps</div>
          <ul className="text-xs space-y-1 mt-2">
            {topPrivileged.map(({ app, teamName }, i) => (
              <li key={i} className="flex items-start justify-between">
                <div className="min-w-0">
                  <div className="text-xs text-gray-200 truncate">{app.displayName || app.teamsAppId || app.id}</div>
                  <div className="text-xs text-gray-500">{teamName}</div>
                </div>
                <div className="text-xs text-gray-400 ml-3">{app.distributionMethod || ''}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Extra Teams collectors: Messaging policies, Meeting policies, Membership */}
      {/* If a specific teams_* area is selected, render only that collector's
          section. Otherwise show all three subsections. */}
      {/* Messaging policies view intentionally hidden */}
      {/* Meeting policies view intentionally hidden */}
      {/* Team membership view intentionally hidden */}
      {areaKey === 'teams_policies_messaging' && <MessagingPoliciesSection tenantId={tenantId} />}
      {areaKey === 'teams_policies_meetings' && <MeetingPoliciesSection tenantId={tenantId} />}
      {areaKey === 'teams_membership' && <MembershipSection tenantId={tenantId} />}
      {areaKey === 'teams_app_permission_policies' && <AppPermissionPoliciesSection tenantId={tenantId} />}
      {areaKey === 'teams_channels_policies' && <ChannelsPoliciesSection tenantId={tenantId} />}
      {areaKey === 'teams_org_app_settings' && <OrgAppSettingsSection tenantId={tenantId} />}

      {!specificTeamsCollectors.includes(areaKey) && (
        <>
          <MessagingPoliciesSection tenantId={tenantId} />
          <MeetingPoliciesSection tenantId={tenantId} />
          <MembershipSection tenantId={tenantId} />
          <AppPermissionPoliciesSection tenantId={tenantId} />
          <ChannelsPoliciesSection tenantId={tenantId} />
          <OrgAppSettingsSection tenantId={tenantId} />
        </>
      )}
    </div>
  )
}


function CollectorListCard({ tenantId, areaKey, title }) {
  const [live, setLive] = useState(null)
  const [detail, setDetail] = useState(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [detailError, setDetailError] = useState(null)

  useEffect(() => {
    let mounted = true
    areaApi.getLive(tenantId, areaKey).then(d => { if (mounted) setLive(d) }).catch(() => { if (mounted) setLive(null) })
    return () => { mounted = false }
  }, [tenantId, areaKey])

  const openDetail = async (resourceId) => {
    setDetail(null)
    setDetailError(null)
    setLoadingDetail(true)
    try {
      const r = await areaApi.getResource(tenantId, areaKey, resourceId)
      setDetail(r)
    } catch (err) {
      setDetailError(err?.message || 'Failed to load resource')
    } finally {
      setLoadingDetail(false)
    }
  }

  const resources = (live && live.resources) || {}
  const ids = Object.keys(resources)
  const total = ids.length
  const summary = buildCollectorSummary(areaKey, resources)

  const [pulling, setPulling] = useState(false)

  const pullNow = async () => {
    setPulling(true)
    try {
      await areaApi.pull(tenantId, areaKey)
      // refresh live snapshot after a short delay
      setTimeout(() => areaApi.getLive(tenantId, areaKey).then(d => setLive(d)).catch(() => setLive(null)), 1200)
    } catch {
      // ignore
    } finally {
      setPulling(false)
    }
  }

  if (total === 0) {
    return (
      <div className="card text-center py-6" data-area-key={areaKey}>
        <div className="text-sm font-medium text-gray-300">{title}</div>
        <p className="text-xs text-gray-600 mt-2">No data yet</p>
        <p className="text-xs text-gray-500 mt-1">Pull the live configuration to see what exists in this area, then set a baseline to start drift monitoring.</p>
        <div className="mt-3">
          <button onClick={pullNow} disabled={pulling} className="btn-secondary">
            {pulling ? 'Pulling…' : 'Pull Live Data'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {summary.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {summary.map(s => (
            <div key={s.label} className="card-sm p-3">
              <div className="text-xs text-gray-400">{s.label}</div>
              <div className="text-lg font-bold text-white">{s.value}</div>
            </div>
          ))}
        </div>
      )}

      <div className="card p-3">
        <div className="text-sm font-medium text-gray-300">{title}</div>
        <ul className="text-xs space-y-1 mt-2">
          {ids.slice(0, 20).map(id => {
            const r = resources[id] || {}
            return (
              <li key={id} onClick={() => openDetail(id)} className="flex items-start justify-between cursor-pointer">
                <div className="min-w-0">
                  <div className="text-xs text-gray-200 truncate">{r.displayName || id}</div>
                  <div className="text-xs text-gray-500">{r.description || r.type || ''}</div>
                </div>
              </li>
            )
          })}
        </ul>
      </div>

      {/* Detail modal */}
      {(detail || loadingDetail || detailError) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => { setDetail(null); setDetailError(null) }}></div>
          <div className="relative w-11/12 max-w-3xl bg-gray-900 border border-gray-800 rounded-lg p-4 text-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-white">{detail?.displayName || title}</h3>
              <button onClick={() => { setDetail(null); setDetailError(null) }} className="text-gray-400 hover:text-white">Close</button>
            </div>
            {loadingDetail && <div className="text-xs text-gray-400">Loading…</div>}
            {detailError && <div className="text-xs text-red-400">{detailError}</div>}
            {detail && (
              <pre className="text-xs text-gray-300 overflow-auto max-h-[60vh] bg-black/20 p-3 rounded">{JSON.stringify(detail, null, 2)}</pre>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function buildCollectorSummary(areaKey, resources) {
  const items = Object.values(resources || {})
  const total = items.length

  if (areaKey === 'teams_policies_messaging') {
    const giphyEnabled = items.filter(i => i?.allowGiphy === true).length
    const editEnabled = items.filter(i => i?.allowUserEditMessages === true).length
    const deleteEnabled = items.filter(i => i?.allowUserDeleteMessages === true).length
    return [
      { label: 'Policies', value: total },
      { label: 'Allow Giphy', value: giphyEnabled },
      { label: 'Allow Edit/Delete', value: `${editEnabled}/${deleteEnabled}` },
    ]
  }

  if (areaKey === 'teams_policies_meetings') {
    const recordingEnabled = items.filter(i => i?.allowRecording === true).length
    const transcriptionEnabled = items.filter(i => i?.allowTranscription === true).length
    const anonymousJoinEnabled = items.filter(i => i?.allowAnonymousJoin === true).length
    return [
      { label: 'Policies', value: total },
      { label: 'Recording Enabled', value: recordingEnabled },
      { label: 'Anon Join Enabled', value: anonymousJoinEnabled },
      { label: 'Transcription Enabled', value: transcriptionEnabled },
    ]
  }

  if (areaKey === 'teams_membership') {
    const memberCount = items.reduce((s, i) => s + Number(i?.memberCount || 0), 0)
    const ownerCount = items.reduce((s, i) => s + Number(i?.ownerCount || 0), 0)
    const guestCount = items.reduce((s, i) => s + Number(i?.guestCount || 0), 0)
    return [
      { label: 'Teams', value: total },
      { label: 'Members', value: memberCount },
      { label: 'Owners', value: ownerCount },
      { label: 'Guests', value: guestCount },
    ]
  }

  if (areaKey === 'teams_app_permission_policies') {
    const defaultUnrestricted = items.filter(i => String(i?.defaultCatalogAppsType || '').toLowerCase().includes('all')).length
    const globalUnrestricted = items.filter(i => String(i?.globalCatalogAppsType || '').toLowerCase().includes('all')).length
    return [
      { label: 'Policies', value: total },
      { label: 'Default Catalog = All', value: defaultUnrestricted },
      { label: 'Global Catalog = All', value: globalUnrestricted },
    ]
  }

  if (areaKey === 'teams_channels_policies') {
    const allowPrivate = items.filter(i => i?.allowPrivateChannelCreation === true).length
    const allowShared = items.filter(i => i?.allowSharedChannelCreation === true).length
    return [
      { label: 'Policies', value: total },
      { label: 'Private Channels On', value: allowPrivate },
      { label: 'Shared Channels On', value: allowShared },
    ]
  }

  if (areaKey === 'teams_org_app_settings') {
    const sideloadingOn = items.filter(i => i?.isSideloadingEnabled === true).length
    const requestsOn = items.filter(i => i?.isUserRequestsForAppAccessEnabled === true).length
    return [
      { label: 'Snapshots', value: total },
      { label: 'Sideloading Enabled', value: sideloadingOn },
      { label: 'App Requests Enabled', value: requestsOn },
    ]
  }

  return total > 0 ? [{ label: 'Resources', value: total }] : []
}


function MessagingPoliciesSection({ tenantId }) {
  return <CollectorListCard tenantId={tenantId} areaKey={'teams_policies_messaging'} title={'Messaging Policies'} />
}

function MeetingPoliciesSection({ tenantId }) {
  return <CollectorListCard tenantId={tenantId} areaKey={'teams_policies_meetings'} title={'Meeting Policies'} />
}

function MembershipSection({ tenantId }) {
  return <CollectorListCard tenantId={tenantId} areaKey={'teams_membership'} title={'Team Membership'} />
}

function AppPermissionPoliciesSection({ tenantId }) {
  return <CollectorListCard tenantId={tenantId} areaKey={'teams_app_permission_policies'} title={'App Permission Policies'} />
}

function ChannelsPoliciesSection({ tenantId }) {
  return <CollectorListCard tenantId={tenantId} areaKey={'teams_channels_policies'} title={'Channels Policies'} />
}

function OrgAppSettingsSection({ tenantId }) {
  return <CollectorListCard tenantId={tenantId} areaKey={'teams_org_app_settings'} title={'Org App Settings'} />
}
