import { useState, useEffect, useCallback } from 'react'
import {
  Plus, Trash2, ChevronRight, ChevronDown, RefreshCw, Check, X,
  AlertTriangle, CheckCircle, Eye, Code, Info, Shield, Zap,
  ExternalLink, ToggleLeft, ToggleRight, Edit2
} from 'lucide-react'
import { customCollectorApi, tenantApi } from '../api/client.js'

// ── Read-only badge ───────────────────────────────────────────────────────────
function ReadOnlyBadge() {
  return (
    <span className="flex items-center gap-1 text-xs font-semibold text-amber-400 bg-amber-950/30 border border-amber-900/50 px-2 py-0.5 rounded-full">
      <Eye size={10}/> Read-Only
    </span>
  )
}

// ── Field type chip ───────────────────────────────────────────────────────────
function TypeChip({ type }) {
  const cfg = {
    boolean: 'bg-green-950/40 border-green-800/50 text-green-400',
    number:  'bg-blue-950/40 border-blue-800/50 text-blue-400',
    array:   'bg-violet-950/40 border-violet-800/50 text-violet-400',
    json:    'bg-orange-950/40 border-orange-800/50 text-orange-400',
    string:  'bg-gray-800/60 border-gray-700/60 text-gray-500',
  }[type] || 'bg-gray-800/60 border-gray-700/60 text-gray-500'
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded border font-mono ${cfg}`}>{type}</span>
  )
}

// ── Step indicator ────────────────────────────────────────────────────────────
function Steps({ current, steps }) {
  return (
    <div className="flex items-center mb-6">
      {steps.map((label, i) => (
        <div key={i} className="flex items-center flex-1">
          <div className="flex flex-col items-center">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors
              ${i < current  ? 'bg-green-600 text-white'
              : i === current ? 'bg-brand-500 text-white'
              :                 'bg-gray-800 text-gray-500'}`}>
              {i < current ? <Check size={13}/> : i + 1}
            </div>
            <div className={`text-xs mt-1 text-center leading-tight ${i === current ? 'text-white' : 'text-gray-600'}`}>
              {label}
            </div>
          </div>
          {i < steps.length - 1 && (
            <div className={`flex-1 h-px mx-2 mb-4 ${i < current ? 'bg-green-600' : 'bg-gray-800'}`}/>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Create wizard ─────────────────────────────────────────────────────────────
function CreateWizard({ tenants, onCreated, onCancel }) {
  const [step,       setStep]       = useState(0)
  const [form,       setForm]       = useState({
    display_name: '', description: '', graph_endpoint: '',
    select_fields: '', id_field: 'id', name_field: 'displayName',
  })
  const [testTenantId, setTestTenantId] = useState(tenants[0]?.id || '')
  const [testing,    setTesting]    = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [testError,  setTestError]  = useState(null)
  const [selectedFields, setSelectedFields] = useState([])
  const [fieldLabels,    setFieldLabels]    = useState({})
  const [saving,     setSaving]     = useState(false)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // Step 0 → 1: validate form basics
  const goToTest = () => {
    if (!form.display_name.trim()) return
    if (!form.graph_endpoint.trim().startsWith('/')) return
    setStep(1)
  }

  // Step 1: run a test pull
  const runTest = async () => {
    setTesting(true)
    setTestResult(null)
    setTestError(null)
    try {
      const result = await customCollectorApi.testPull({
        tenantId:       testTenantId,
        graph_endpoint: form.graph_endpoint,
        select_fields:  form.select_fields,
        id_field:       form.id_field,
        name_field:     form.name_field,
      })
      setTestResult(result)
      if (result.success && result.discoveredFields?.length > 0) {
        // Pre-select all discovered fields
        setSelectedFields(result.discoveredFields.map(f => f.path))
        setFieldLabels(Object.fromEntries(result.discoveredFields.map(f => [f.path, f.label])))
      }
    } catch (err) {
      setTestError(err.response?.data?.error || err.message)
    } finally {
      setTesting(false)
    }
  }

  // Step 2: save
  const save = async () => {
    setSaving(true)
    try {
      const watchable_keys = (testResult?.discoveredFields || [])
        .filter(f => selectedFields.includes(f.path))
        .map(f => ({ path: f.path, label: fieldLabels[f.path] || f.label, type: f.type }))

      await customCollectorApi.create({ ...form, watchable_keys })
      onCreated()
    } catch (err) {
      setTestError(err.response?.data?.error || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const toggleField = (path) => {
    setSelectedFields(prev =>
      prev.includes(path) ? prev.filter(p => p !== path) : [...prev, path]
    )
  }

  const step0Valid = form.display_name.trim() && form.graph_endpoint.trim().startsWith('/')

  return (
    <div className="card border-brand-700/40 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <Plus size={14} className="text-brand-400"/> New Custom Collector
        </h2>
        <button onClick={onCancel} className="text-gray-500 hover:text-gray-300">
          <X size={16}/>
        </button>
      </div>

      <Steps current={step} steps={['Define', 'Test Pull', 'Configure Fields']}/>

      {/* ── Step 0: Define ─────────────────────────────────────────── */}
      {step === 0 && (
        <div className="space-y-4">
          <div className="flex items-start gap-2 bg-amber-950/20 border border-amber-900/40 rounded-lg px-4 py-3 text-xs text-amber-300">
            <Eye size={13} className="shrink-0 mt-0.5"/>
            <span>
              Custom collectors are <strong>read-only</strong> — they pull live configuration and detect drift,
              but cannot restore. Restore capability is not supported for custom areas.
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="label">Display Name <span className="text-red-500">*</span></label>
              <input className="input" placeholder="e.g. Named Locations"
                value={form.display_name} onChange={e => set('display_name', e.target.value)}/>
              <p className="text-xs text-gray-600 mt-1">How this area will appear in the dashboard.</p>
            </div>
            <div className="col-span-2">
              <label className="label">Description</label>
              <input className="input" placeholder="e.g. Entra ID Named Locations — IP ranges and countries"
                value={form.description} onChange={e => set('description', e.target.value)}/>
            </div>
            <div className="col-span-2">
              <label className="label">Graph API Endpoint <span className="text-red-500">*</span></label>
              <input className="input font-mono" placeholder="/identity/conditionalAccess/namedLocations"
                value={form.graph_endpoint} onChange={e => set('graph_endpoint', e.target.value)}/>
              <p className="text-xs text-gray-600 mt-1">
                Must start with <code className="bg-gray-800 px-1 rounded">/</code>.
                Find endpoints at{' '}
                <a href="https://developer.microsoft.com/en-us/graph/graph-explorer" target="_blank"
                  rel="noopener noreferrer" className="text-brand-400 hover:underline inline-flex items-center gap-0.5">
                  Graph Explorer <ExternalLink size={9}/>
                </a>
              </p>
            </div>
            <div className="col-span-2">
              <label className="label">
                <code className="text-xs font-mono text-gray-400">$select</code> fields
                <span className="text-gray-600 font-normal ml-2">(optional — leave blank to pull all)</span>
              </label>
              <input className="input font-mono" placeholder="id,displayName,ipRanges,isTrusted"
                value={form.select_fields} onChange={e => set('select_fields', e.target.value)}/>
              <p className="text-xs text-gray-600 mt-1">Comma-separated field names to request from Graph. Reduces response size for large collections.</p>
            </div>
          </div>

          <details className="group">
            <summary className="flex items-center gap-1 text-xs text-gray-500 cursor-pointer hover:text-gray-300 list-none">
              <ChevronRight size={11} className="group-open:rotate-90 transition-transform"/>
              Advanced — ID and name field overrides
            </summary>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <label className="label">ID field</label>
                <input className="input font-mono text-sm" value={form.id_field}
                  onChange={e => set('id_field', e.target.value)} placeholder="id"/>
                <p className="text-xs text-gray-600 mt-1">Field used as the unique resource identifier. Default: <code className="bg-gray-800 px-1 rounded">id</code></p>
              </div>
              <div>
                <label className="label">Display name field</label>
                <input className="input font-mono text-sm" value={form.name_field}
                  onChange={e => set('name_field', e.target.value)} placeholder="displayName"/>
                <p className="text-xs text-gray-600 mt-1">Field shown as the resource name in the dashboard. Default: <code className="bg-gray-800 px-1 rounded">displayName</code></p>
              </div>
            </div>
          </details>

          <div className="flex justify-end gap-2">
            <button onClick={onCancel} className="btn-secondary">Cancel</button>
            <button onClick={goToTest} disabled={!step0Valid} className="btn-primary">
              Next — Test Pull <ChevronRight size={13}/>
            </button>
          </div>
        </div>
      )}

      {/* ── Step 1: Test Pull ──────────────────────────────────────── */}
      {step === 1 && (
        <div className="space-y-4">
          <p className="text-sm text-gray-400">
            Run a live test against one of your tenants to verify the endpoint and discover available fields.
            No data is saved at this stage.
          </p>

          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="label">Test against tenant</label>
              <select className="input" value={testTenantId} onChange={e => setTestTenantId(e.target.value)}>
                {tenants.map(t => <option key={t.id} value={t.id}>{t.display_name}</option>)}
              </select>
            </div>
            <button onClick={runTest} disabled={testing || !testTenantId} className="btn-primary shrink-0">
              <RefreshCw size={13} className={testing ? 'animate-spin' : ''}/>
              {testing ? 'Pulling…' : 'Run Test Pull'}
            </button>
          </div>

          {/* Error */}
          {testError && (
            <div className="flex items-start gap-2 bg-red-950/30 border border-red-900/50 rounded-lg px-4 py-3 text-sm text-red-300">
              <AlertTriangle size={14} className="shrink-0 mt-0.5"/>
              <div>
                <div className="font-medium">Test pull failed</div>
                <div className="text-red-400/80 mt-0.5 text-xs">{testError}</div>
              </div>
            </div>
          )}

          {/* Success */}
          {testResult?.success && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 bg-green-950/20 border border-green-900/40 rounded-lg px-4 py-3 text-sm text-green-300">
                <CheckCircle size={14} className="shrink-0"/>
                <div>
                  <span className="font-medium">Success</span>
                  <span className="text-green-500/70 ml-2">
                    {testResult.count} resource{testResult.count !== 1 ? 's' : ''} returned
                    {testResult.isSingleton && ' (singleton endpoint)'}
                  </span>
                </div>
              </div>

              {/* Sample response preview */}
              {testResult.sample && (
                <details className="group">
                  <summary className="flex items-center gap-1 text-xs text-gray-500 cursor-pointer hover:text-gray-300 list-none">
                    <Code size={11}/> View sample response
                    <ChevronRight size={11} className="group-open:rotate-90 transition-transform ml-0.5"/>
                  </summary>
                  <pre className="mt-2 bg-gray-950 border border-gray-800 rounded-lg p-3 text-xs text-gray-400 font-mono overflow-x-auto max-h-48">
                    {JSON.stringify(testResult.sample, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          )}

          <div className="flex justify-between">
            <button onClick={() => setStep(0)} className="btn-secondary">← Back</button>
            <button
              onClick={() => setStep(2)}
              disabled={!testResult?.success}
              className="btn-primary">
              Next — Configure Fields <ChevronRight size={13}/>
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2: Configure Fields ───────────────────────────────── */}
      {step === 2 && (
        <div className="space-y-4">
          <div>
            <p className="text-sm text-gray-400">
              Select which fields TrustM365 will monitor for drift. All selected fields will be available
              when setting a baseline for this area.
            </p>
            <p className="text-xs text-gray-600 mt-1">
              {selectedFields.length} of {testResult?.discoveredFields?.length || 0} fields selected
              <button onClick={() => setSelectedFields(testResult?.discoveredFields?.map(f => f.path) || [])}
                className="text-brand-400 hover:underline ml-3">Select all</button>
              <button onClick={() => setSelectedFields([])}
                className="text-gray-500 hover:text-gray-300 ml-2">Clear</button>
            </p>
          </div>

          <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
            {(testResult?.discoveredFields || []).map(field => {
              const selected = selectedFields.includes(field.path)
              return (
                <div key={field.path}
                  className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors
                    ${selected ? 'border-brand-700/60 bg-brand-950/20' : 'border-gray-800 hover:border-gray-700'}`}
                  onClick={() => toggleField(field.path)}>
                  <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors
                    ${selected ? 'bg-brand-500 border-brand-500' : 'border-gray-600'}`}>
                    {selected && <Check size={10} className="text-white"/>}
                  </div>
                  <div className="flex-1 min-w-0">
                    {/* Editable label */}
                    <div className="flex items-center gap-2">
                      <input
                        className={`text-sm font-medium bg-transparent border-none outline-none w-full
                          ${selected ? 'text-white' : 'text-gray-400'}`}
                        value={fieldLabels[field.path] || field.label}
                        onChange={e => setFieldLabels(prev => ({ ...prev, [field.path]: e.target.value }))}
                        onClick={e => e.stopPropagation()}
                        placeholder="Field label…"
                      />
                    </div>
                    <code className="text-xs text-gray-600 font-mono">{field.path}</code>
                  </div>
                  <TypeChip type={field.type}/>
                </div>
              )
            })}
          </div>

          {selectedFields.length === 0 && (
            <div className="flex items-center gap-2 text-xs text-yellow-400 bg-yellow-950/20 border border-yellow-900/40 rounded-lg px-3 py-2">
              <AlertTriangle size={11}/>
              Select at least one field to monitor.
            </div>
          )}

          <div className="flex justify-between">
            <button onClick={() => setStep(1)} className="btn-secondary">← Back</button>
            <button onClick={save} disabled={saving || selectedFields.length === 0} className="btn-primary">
              {saving ? <><RefreshCw size={13} className="animate-spin"/> Saving…</> : <><Check size={13}/> Create Collector</>}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Collector card ────────────────────────────────────────────────────────────
function CollectorCard({ collector, tenants, onUpdated, onDeleted, showToast }) {
  const [expanded,   setExpanded]   = useState(false)
  const [deploying,  setDeploying]  = useState({})
  const [deployedTo, setDeployedTo] = useState(new Set())
  const [loadingDeploy, setLoadingDeploy] = useState(true)

  // Find which tenants have this area in resource_areas
  useEffect(() => {
    // Use the tenants list + check via tenants' area lists
    // Simple heuristic: we know a tenant has it deployed if we can see it
    // We'll fetch all areas per tenant is too heavy — use a lightweight approach:
    // the backend deploy endpoint does INSERT OR IGNORE, so we just track locally
    setLoadingDeploy(false)
  }, [])

  const toggleDeploy = async (tenantId, tenantName) => {
    const isDeployed = deployedTo.has(tenantId)
    setDeploying(d => ({ ...d, [tenantId]: true }))
    try {
      if (isDeployed) {
        await customCollectorApi.undeploy(collector.id, tenantId)
        setDeployedTo(prev => { const n = new Set(prev); n.delete(tenantId); return n })
        showToast(`Removed from ${tenantName}`, 'success')
      } else {
        await customCollectorApi.deploy(collector.id, tenantId)
        setDeployedTo(prev => new Set([...prev, tenantId]))
        showToast(`Added to ${tenantName} — pull live data to start monitoring`, 'success')
      }
      onUpdated()
    } catch (err) {
      showToast(err.response?.data?.error || 'Deploy failed', 'error')
    } finally {
      setDeploying(d => ({ ...d, [tenantId]: false }))
    }
  }

  const deleteCollector = async () => {
    if (!confirm(`Delete "${collector.display_name}"? This will remove it from all tenants and delete all associated data.`)) return
    try {
      await customCollectorApi.remove(collector.id)
      onDeleted()
      showToast(`"${collector.display_name}" deleted`, 'success')
    } catch (err) {
      showToast(err.response?.data?.error || 'Delete failed', 'error')
    }
  }

  const watchableKeys = Array.isArray(collector.watchable_keys)
    ? collector.watchable_keys
    : JSON.parse(collector.watchable_keys || '[]')

  return (
    <div className="border border-gray-800 rounded-xl overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 bg-gray-900/30">
        <Zap size={14} className="text-brand-400 shrink-0"/>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-white text-sm">{collector.display_name}</span>
            <ReadOnlyBadge/>
          </div>
          {collector.description && (
            <p className="text-xs text-gray-600 mt-0.5 truncate">{collector.description}</p>
          )}
          <code className="text-xs text-gray-700 font-mono">{collector.graph_endpoint}</code>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-gray-600">{watchableKeys.length} field{watchableKeys.length !== 1 ? 's' : ''}</span>
          <button onClick={() => setExpanded(v => !v)} className="btn-secondary text-xs">
            {expanded ? <ChevronDown size={11}/> : <ChevronRight size={11}/>} Manage
          </button>
          <button onClick={deleteCollector} className="p-1.5 text-gray-600 hover:text-red-400 transition-colors">
            <Trash2 size={13}/>
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-gray-800 px-4 py-4 space-y-4">

          {/* Monitored fields */}
          {watchableKeys.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wider mb-2">Monitored Fields</p>
              <div className="flex flex-wrap gap-1.5">
                {watchableKeys.map(k => (
                  <span key={k.path} className="flex items-center gap-1.5 text-xs bg-gray-800 border border-gray-700 text-gray-300 px-2 py-1 rounded-lg">
                    <code className="text-gray-400 font-mono text-xs">{k.path}</code>
                    <span className="text-gray-500">{k.label !== k.path ? `· ${k.label}` : ''}</span>
                    <TypeChip type={k.type}/>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Tenant deployment */}
          <div>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wider mb-2">Deploy to Tenants</p>
            <p className="text-xs text-gray-600 mb-3">
              Toggle which tenants should include this area. After enabling, pull live data from the area to start monitoring.
            </p>
            {tenants.length === 0 ? (
              <p className="text-xs text-gray-600">No tenants registered yet.</p>
            ) : (
              <div className="space-y-1.5">
                {tenants.map(tenant => {
                  const isOn = deployedTo.has(tenant.id)
                  const isBusy = deploying[tenant.id]
                  return (
                    <div key={tenant.id}
                      className={`flex items-center justify-between px-3 py-2.5 rounded-lg border transition-colors
                        ${isOn ? 'border-brand-700/50 bg-brand-950/10' : 'border-gray-800'}`}>
                      <div>
                        <div className="text-sm text-white font-medium">{tenant.display_name}</div>
                        {isOn && (
                          <div className="text-xs text-brand-400/70 mt-0.5">Active — pull data to begin monitoring</div>
                        )}
                      </div>
                      <button
                        onClick={() => toggleDeploy(tenant.id, tenant.display_name)}
                        disabled={isBusy}
                        className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors
                          ${isOn
                            ? 'border-brand-700/60 text-brand-300 bg-brand-950/30 hover:bg-red-950/30 hover:text-red-400 hover:border-red-900/50'
                            : 'border-gray-700 text-gray-400 hover:border-brand-700/60 hover:text-brand-300'}`}>
                        {isBusy ? <RefreshCw size={11} className="animate-spin"/> : isOn ? <ToggleRight size={13}/> : <ToggleLeft size={13}/>}
                        {isBusy ? '…' : isOn ? 'Enabled' : 'Add'}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function CustomCollectors({ showToast }) {
  const [collectors, setCollectors] = useState([])
  const [tenants,    setTenants]    = useState([])
  const [loading,    setLoading]    = useState(true)
  const [creating,   setCreating]   = useState(false)

  const load = useCallback(async () => {
    try {
      const [cols, tens] = await Promise.all([
        customCollectorApi.list(),
        tenantApi.list(),
      ])
      setCollectors(cols)
      setTenants(tens)
    } catch { showToast('Failed to load custom collectors', 'error') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <div className="flex items-center justify-center h-full text-gray-500">Loading…</div>

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Zap size={20} className="text-brand-500"/> Custom Collectors
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            Define your own Microsoft Graph API resource areas for drift monitoring.
          </p>
        </div>
        {!creating && (
          <button onClick={() => setCreating(true)} className="btn-primary">
            <Plus size={13}/> New Collector
          </button>
        )}
      </div>

      {/* Read-only explainer */}
      <div className="flex items-start gap-3 bg-amber-950/20 border border-amber-900/40 rounded-xl px-4 py-3 text-sm">
        <Shield size={15} className="text-amber-400 shrink-0 mt-0.5"/>
        <div>
          <span className="text-amber-300 font-medium">Read-only monitoring only.</span>
          <span className="text-amber-400/70 ml-2">
            Custom collectors pull live configuration and detect drift against a baseline, but cannot restore.
            Restore capability requires a built-in collector with purpose-written Graph PATCH logic.
          </span>
        </div>
      </div>

      {/* How it works */}
      {collectors.length === 0 && !creating && (
        <div className="card border-gray-800 space-y-5 py-8 text-center">
          <Zap size={40} className="text-gray-700 mx-auto"/>
          <div>
            <h2 className="text-lg font-semibold text-white">No custom collectors yet</h2>
            <p className="text-gray-500 text-sm mt-1 max-w-md mx-auto">
              Any Microsoft Graph endpoint that returns a list of objects can be added as a custom area —
              for example Named Locations, Authentication Strength Policies, or Cross-Tenant Access Settings.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3 max-w-lg mx-auto text-left">
            {[
              { step: '1', label: 'Define',  desc: 'Enter a Graph endpoint and optional $select fields' },
              { step: '2', label: 'Test',    desc: 'Run a live pull to verify the endpoint and discover fields' },
              { step: '3', label: 'Monitor', desc: 'Select fields to watch, deploy to tenants, set a baseline' },
            ].map(({ step, label, desc }) => (
              <div key={step} className="card-sm border-gray-800 space-y-1">
                <div className="w-6 h-6 rounded-full bg-brand-900/60 border border-brand-700/60 text-brand-300 text-xs font-bold flex items-center justify-center">{step}</div>
                <div className="text-xs font-semibold text-gray-300">{label}</div>
                <div className="text-xs text-gray-600">{desc}</div>
              </div>
            ))}
          </div>
          <button onClick={() => setCreating(true)} className="btn-primary mx-auto">
            <Plus size={13}/> Create Your First Custom Collector
          </button>
        </div>
      )}

      {/* Create wizard */}
      {creating && (
        <CreateWizard
          tenants={tenants}
          onCreated={() => { setCreating(false); load() }}
          onCancel={() => setCreating(false)}
        />
      )}

      {/* Collector list */}
      {collectors.length > 0 && !creating && (
        <div className="space-y-3">
          {collectors.map(collector => (
            <CollectorCard
              key={collector.id}
              collector={collector}
              tenants={tenants}
              onUpdated={load}
              onDeleted={load}
              showToast={showToast}
            />
          ))}
        </div>
      )}
    </div>
  )
}
