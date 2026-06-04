import React, { useState } from 'react'
import { areaApi } from '../../api/client.js'

export default function ExchangeConnectorsArea({ tenantId, areaKey, liveData, baseline }) {
  if (!liveData) {
    return (
      <div>
        <h3 className="text-lg font-semibold">Mail Flow Connectors</h3>
        <p className="text-sm text-gray-400">Area key: {areaKey}</p>
        <p className="mt-2 text-xs text-gray-500">No live snapshot yet. Use the <strong>Pull Live Data</strong> button to attempt fetching connectors from Microsoft Graph.</p>
      </div>
    )
  }

  const resources = liveData.resources || {}
  const ids = Object.keys(resources)
  const total = ids.length
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
      setDetailError(err?.message || 'Failed to load resource')
    } finally {
      setLoadingDetail(false)
    }
  }

  return (
    <div>
      {total === 0 ? null : (
        <div className="card p-3">
          <div className="text-sm font-medium text-gray-300">Mail flow connectors</div>
          <ul className="text-xs space-y-1 mt-2">
            {ids.slice(0, 20).map(id => {
              const r = resources[id] || {}
              return (
                <li key={id} onClick={() => openDetail(id)} className="flex items-start justify-between cursor-pointer">
                  <div className="min-w-0">
                    <div className="text-xs text-gray-200 truncate">{r.displayName || id}</div>
                    <div className="text-xs text-gray-500">{r.type ? r.type : ''}</div>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* Detail modal */}
      {(detail || loadingDetail || detailError) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => { setDetail(null); setDetailError(null) }}></div>
          <div className="relative w-11/12 max-w-3xl bg-gray-900 border border-gray-800 rounded-lg p-4 text-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-white">{detail?.displayName || 'Connector'}</h3>
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
