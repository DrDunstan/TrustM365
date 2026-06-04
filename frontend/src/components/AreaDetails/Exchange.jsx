import React, { useState } from 'react'
import { areaApi } from '../../api/client.js'

export default function ExchangeArea({ tenantId, areaKey, liveData }) {
  if (!liveData) {
    return (
      <div className="card text-center py-6">
        <div className="text-sm font-medium text-gray-300">Exchange Mailboxes</div>
        <p className="text-xs text-gray-500 mt-1">Area key: {areaKey}</p>
        <p className="text-xs text-gray-500 mt-2">No live snapshot yet. Use the <strong>Pull Live Data</strong> button to fetch mailbox posture from Microsoft Graph.</p>
      </div>
    )
  }

  const resources = liveData.resources || {}
  const ids = Object.keys(resources)
  const total = ids.length
  const withSettings = ids.reduce((s, id) => s + (resources[id]?.mailboxSettings ? 1 : 0), 0)
  const riskyForwarding = ids.reduce((s, id) => s + ((resources[id]?.forwardingRules?.length || 0) > 0 ? 1 : 0), 0)

  const [detail, setDetail] = useState(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [detailError, setDetailError] = useState(null)

  const openDetail = async (resourceId) => {
    setDetail(null)
    setDetailError(null)
    setLoadingDetail(true)
    try {
      const r = await areaApi.getResource(tenantId, areaKey, resourceId)
      setDetail(r)
    } catch (err) {
      setDetailError(err?.message || 'Failed to load mailbox details')
    } finally {
      setLoadingDetail(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <div className="card-sm p-3">
          <div className="text-xs text-gray-400">Mailboxes</div>
          <div className="text-lg font-bold text-white">{total}</div>
        </div>
        <div className="card-sm p-3">
          <div className="text-xs text-gray-400">Mailbox settings available</div>
          <div className="text-lg font-bold text-white">{withSettings}</div>
        </div>
        <div className="card-sm p-3">
          <div className="text-xs text-gray-400">Forwarding indicators</div>
          <div className="text-lg font-bold text-white">{riskyForwarding}</div>
        </div>
      </div>

      {total > 0 && (
        <div className="card p-3">
          <div className="text-sm font-medium text-gray-300">Mailboxes</div>
          <ul className="text-xs space-y-1 mt-2">
            {ids.slice(0, 50).map(id => {
              const r = resources[id] || {}
              return (
                <li key={id} onClick={() => openDetail(id)} className="flex items-start justify-between cursor-pointer">
                  <div className="min-w-0">
                    <div className="text-xs text-gray-200 truncate">{r.displayName || id}</div>
                    <div className="text-xs text-gray-500">{r.mail || r.raw?.userPrincipalName || ''}</div>
                  </div>
                  <div className="text-xs text-gray-400 ml-3">{(r.forwardingRules || []).length > 0 ? 'forwarding' : 'ok'}</div>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {(detail || loadingDetail || detailError) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => { setDetail(null); setDetailError(null) }}></div>
          <div className="relative w-11/12 max-w-3xl bg-gray-900 border border-gray-800 rounded-lg p-4 text-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-white">{detail?.displayName || 'Mailbox'}</h3>
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
