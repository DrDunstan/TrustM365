import { useState, useEffect, useCallback } from 'react'
import { FileText, Download, Trash2, RefreshCw, Plus, Calendar, Clock, ChevronRight, Search, X, Layers } from 'lucide-react'
import { reportApi, tenantApi } from '../api/client.js'
import GenerateReportModal from '../components/GenerateReportModal.jsx'
import BaselineExportModal from '../components/BaselineExportModal.jsx'

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

function triggerPill(trigger) {
  return trigger === 'on-demand'
    ? <span className="text-xs text-gray-600">On-demand</span>
    : <span className="text-xs text-brand-400 capitalize">{trigger}</span>
}

function typePill(type) {
  if (type === 'baseline')
    return <span className="text-xs px-2 py-0.5 rounded border bg-violet-950/40 border-violet-900/50 text-violet-400">Baseline Export</span>
  return null
}

export default function Reports({ showToast, setSelectedTenant, navigate }) {
  const [reports,       setReports]       = useState([])
  const [tenants,       setTenants]       = useState([])
  const [unread,        setUnread]        = useState(0)
  const [loading,       setLoading]       = useState(true)
  const [viewing,       setViewing]       = useState(null)
  const [showModal,          setShowModal]          = useState(false)
  const [showBaselineExport, setShowBaselineExport] = useState(false)
  const [deleting,           setDeleting]           = useState(null)
  const [searchQuery,   setSearchQuery]   = useState('')
  const [filterTenant,  setFilterTenant]  = useState('')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo,   setFilterDateTo]   = useState('')

  const load = useCallback(async () => {
    try {
      const data = await reportApi.list()
      setReports(data.reports || [])
      setUnread(data.unreadCount || 0)
    } catch { showToast('Failed to load reports', 'error') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  // Fetch tenant list for the tenant filter dropdown
  useEffect(() => {
    tenantApi.list().then(setTenants).catch(() => {})
  }, [])

  const openReport = async (report) => {
    try {
      const full = await reportApi.get(report.id)
      setViewing(full)
      setUnread(u => Math.max(0, u - (report.unread ? 1 : 0)))
      setReports(rs => rs.map(r => r.id === report.id ? { ...r, unread: 0 } : r))
    } catch { showToast('Failed to load report', 'error') }
  }

  const downloadPdf = (report) => {
    const win = window.open('', '_blank')
    win.document.write(viewing?.html_content || '')
    win.document.close()
    setTimeout(() => win.print(), 400)
  }

  const deleteReport = async (id) => {
    setDeleting(id)
    try {
      await reportApi.delete(id)
      setReports(rs => rs.filter(r => r.id !== id))
      if (viewing?.id === id) setViewing(null)
      showToast('Report deleted', 'success')
    } catch { showToast('Delete failed', 'error') }
    finally { setDeleting(null) }
  }

  const clearFilters = () => {
    setSearchQuery(''); setFilterTenant(''); setFilterDateFrom(''); setFilterDateTo('')
  }
  const hasActiveFilters = !!(searchQuery || filterTenant || filterDateFrom || filterDateTo)

  const filtered = reports.filter(r => {
    if (filterTenant && r.tenant_id !== filterTenant) return false
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      if (!r.title?.toLowerCase().includes(q)) return false
    }
    if (filterDateFrom && r.date_range_start < filterDateFrom) return false
    if (filterDateTo   && r.date_range_end   > filterDateTo + 'T23:59:59') return false
    return true
  })

  if (viewing) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-3 px-6 py-3 border-b border-gray-800 shrink-0">
          <button onClick={() => setViewing(null)} className="btn-secondary text-xs">
            ← Back to Reports
          </button>
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium text-white truncate">{viewing.title}</span>
            <span className="text-xs text-gray-600 ml-2">{formatDate(viewing.generated_at)}</span>
          </div>
          <button onClick={downloadPdf} className="btn-secondary text-xs">
            <Download size={13}/> PDF
          </button>
          <button onClick={() => reportApi.docxDownload(viewing.id, viewing.title)} className="btn-primary text-xs">
            <FileText size={13}/> Download Word
          </button>
          <button onClick={() => deleteReport(viewing.id)} disabled={deleting === viewing.id}
            className="btn-danger text-xs">
            <Trash2 size={12}/> Delete
          </button>
        </div>
        <div className="flex-1 overflow-hidden">
          <iframe
            srcDoc={viewing.html_content}
            className="w-full h-full border-0"
            title={viewing.title}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <FileText size={20} className="text-brand-500"/> Reports
            {unread > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-brand-700 text-white text-xs font-medium">{unread}</span>
            )}
          </h1>
          <p className="text-gray-500 text-sm mt-1">Generated reports — download as PDF or view in-app</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowBaselineExport(true)} className="btn-secondary">
            <Layers size={14}/> Baseline Export
          </button>
          <button onClick={() => setShowModal(true)} className="btn-primary">
            <Plus size={14}/> Generate Report
          </button>
        </div>
      </div>

      {/* Search + tenant + date filters */}
      {reports.length > 0 && (
        <div className="space-y-2">
          {/* Search input */}
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-600 pointer-events-none"/>
            <input
              className="input w-full pl-7 py-1.5 text-xs"
              placeholder="Search reports by title…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400 transition-colors">
                <X size={11}/>
              </button>
            )}
          </div>
          {/* Tenant + date row */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Tenant filter */}
            {tenants.length > 0 && (
              <select className="input py-1 text-xs w-44"
                value={filterTenant}
                onChange={e => setFilterTenant(e.target.value)}>
                <option value="">All tenants</option>
                {tenants.map(t => (
                  <option key={t.id} value={t.id}>{t.display_name}</option>
                ))}
              </select>
            )}
            {/* Date range */}
            <div className="flex items-center gap-1.5">
              <Calendar size={11} className="text-gray-600"/>
              <input type="date" className="input py-1 text-xs w-32"
                value={filterDateFrom}
                onChange={e => setFilterDateFrom(e.target.value)}
                title="Report period — from"
              />
              <span className="text-gray-700 text-xs">→</span>
              <input type="date" className="input py-1 text-xs w-32"
                value={filterDateTo}
                onChange={e => setFilterDateTo(e.target.value)}
                title="Report period — to"
              />
            </div>
            {hasActiveFilters && (
              <button onClick={clearFilters}
                className="text-xs text-gray-600 hover:text-red-400 transition-colors flex items-center gap-1 ml-1">
                <X size={10}/> Clear filters
              </button>
            )}
            {hasActiveFilters && (
              <span className="text-xs text-gray-600 ml-auto">
                {filtered.length} of {reports.length} reports
              </span>
            )}
          </div>
        </div>
      )}

      {loading && <div className="text-gray-600 text-sm py-4">Loading reports…</div>}

      {!loading && filtered.length === 0 && (
        <div className="card text-center py-12">
          <FileText size={40} className="text-gray-700 mx-auto mb-3"/>
          <p className="text-gray-400 mb-4">No reports yet. Generate your first report to get started.</p>
          <button onClick={() => setShowModal(true)} className="btn-primary mx-auto">
            <Plus size={14}/> Generate Report
          </button>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="space-y-2">
          {filtered.map(report => (
            <div key={report.id}
              className={`card cursor-pointer hover:border-gray-700 transition-colors
                ${report.unread ? 'border-brand-700/40' : ''}`}
              onClick={() => openReport(report)}>
              <div className="flex items-center gap-3">
                {report.unread
                  ? <div className="w-2 h-2 rounded-full bg-brand-500 shrink-0"/>
                  : <FileText size={16} className="text-gray-600 shrink-0"/>}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-sm font-medium ${report.unread ? 'text-white' : 'text-gray-300'}`}>
                      {report.title}
                    </span>
                    {typePill(report.report_type)}
                    {triggerPill(report.trigger)}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-600">
                    <span className="flex items-center gap-1">
                      <Calendar size={10}/> {report.date_range_start?.slice(0,10)} → {report.date_range_end?.slice(0,10)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock size={10}/> Generated {formatDate(report.generated_at)}
                    </span>
                  </div>
                </div>
                <ChevronRight size={14} className="text-gray-600 shrink-0"/>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <GenerateReportModal
          onClose={() => setShowModal(false)}
          onGenerated={(fullReport) => {
            setReports(rs => [fullReport, ...rs])
            setShowModal(false)
            setViewing(fullReport)
            showToast('Report generated', 'success')
          }}
          showToast={showToast}
        />
      )}

      {showBaselineExport && (
        <BaselineExportModal
          tenantId={null}
          onClose={() => { setShowBaselineExport(false); load() }}
          showToast={showToast}
        />
      )}
    </div>
  )
}
