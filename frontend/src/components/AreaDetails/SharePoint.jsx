import React, { useState } from 'react'
import { areaApi } from '../../api/client.js'

export default function SharePointArea({ tenantId, areaKey, liveData, baseline }) {
  if (!liveData) {
    return (
      <div className="card text-center py-6">
        <div className="text-sm font-medium text-gray-300">SharePoint Sites</div>
        <p className="text-xs text-gray-500 mt-1">Area key: {areaKey}</p>
        <p className="text-xs text-gray-500 mt-2">No live snapshot yet. Use the <strong>Pull Live Data</strong> button to fetch site collections from Microsoft Graph.</p>
      </div>
    );
  }

  // Summarise key signals across site snapshots for a concise landing view
  const resources = liveData.resources || {};
  const ids = Object.keys(resources);
  const totalSites = ids.length;
  let anonymousLinkCount = 0;
  let externalShareCount = 0;
  const sharedItems = [];

  for (const id of ids) {
    const r = resources[id] || {};
    anonymousLinkCount += Number(r.anonymousLinkCount || 0);
    externalShareCount += Number(r.externalShareCount || 0);
    if (Array.isArray(r.topExternallyShared)) {
      for (const it of r.topExternallyShared) {
        const key = it.webUrl || it.id || JSON.stringify(it);
        sharedItems.push({ key, item: it, siteName: r.displayName || id });
      }
    }
  }

  const seen = new Set();
  const topUnique = sharedItems.filter(s => {
    if (seen.has(s.key)) return false;
    seen.add(s.key);
    return true;
  }).slice(0, 5);

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
      setDetailError(err?.message || 'Failed to load site details')
    } finally {
      setLoadingDetail(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <div className="card-sm p-3">
          <div className="text-xs text-gray-400">Sites</div>
          <div className="text-lg font-bold text-white">{totalSites}</div>
        </div>
        <div className="card-sm p-3">
          <div className="text-xs text-gray-400">Anonymous links</div>
          <div className="text-lg font-bold text-white">{anonymousLinkCount}</div>
        </div>
        <div className="card-sm p-3">
          <div className="text-xs text-gray-400">External shares</div>
          <div className="text-lg font-bold text-white">{externalShareCount}</div>
        </div>
      </div>

      {totalSites > 0 && (
        <div className="card p-3">
          <div className="text-sm font-medium text-gray-300">Sites</div>
          <ul className="text-xs space-y-1 mt-2">
            {ids.slice(0, 50).map(id => {
              const r = resources[id] || {}
              return (
                <li key={id} onClick={() => openDetail(id)} className="flex items-start justify-between cursor-pointer">
                  <div className="min-w-0">
                    <div className="text-xs text-gray-200 truncate">{r.displayName || id}</div>
                    <div className="text-xs text-gray-500">{r.webUrl || ''}</div>
                  </div>
                  <div className="text-xs text-gray-400 ml-3">{Number(r.externalShareCount || 0) > 0 ? 'shared' : 'ok'}</div>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {topUnique.length > 0 && (
        <div className="card p-3 space-y-2">
          <div className="text-sm font-medium text-gray-300">Top externally-shared items</div>
          <ul className="text-xs space-y-1 mt-2">
            {topUnique.map(({ item, siteName }, i) => (
              <li key={i} className="flex items-start justify-between">
                <div className="min-w-0">
                  <div className="text-xs text-gray-200 truncate">{item.webUrl || item.displayName || item.id || 'Item'}</div>
                  <div className="text-xs text-gray-500">{siteName}</div>
                </div>
                <div className="text-xs text-gray-400 ml-3">{(item.roles || []).join(', ')}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(detail || loadingDetail || detailError) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => { setDetail(null); setDetailError(null) }}></div>
          <div className="relative w-11/12 max-w-3xl bg-gray-900 border border-gray-800 rounded-lg p-4 text-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-white">{detail?.displayName || 'SharePoint Site'}</h3>
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
  );
}
