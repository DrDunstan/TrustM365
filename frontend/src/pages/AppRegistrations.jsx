import { useEffect, useMemo, useState } from 'react'
import { appRegistrationApi, tenantApi } from '../api/client.js'
import { KeyRound, Plus, Link2, RefreshCw, Trash2, ShieldCheck, Crown, Save } from 'lucide-react'

const emptyCreate = {
  displayName: '',
  clientId: '',
  clientSecret: '',
  defaultAuthorityTenantId: '',
}

const emptyBind = {
  tenantId: '',
  authorityTenantId: '',
  isPrimary: true,
  refreshPermissions: true,
}

function BindingRow({ app, binding, onSetPrimary, onRefreshPerms, onRemoveBinding, busy }) {
  return (
    <div className="grid grid-cols-12 gap-2 text-xs items-center py-1.5 px-2 rounded border border-gray-800 bg-gray-900/40">
      <div className="col-span-3 text-gray-300 truncate">{binding.tenant_display_name}</div>
      <div className="col-span-3 font-mono text-gray-500 truncate">{binding.tenant_uuid}</div>
      <div className="col-span-3 font-mono text-gray-500 truncate">{binding.authority_tenant_id}</div>
      <div className="col-span-3 flex items-center justify-end gap-1">
        {binding.is_primary === 1 && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-amber-800 text-amber-300 bg-amber-950/40">
            <Crown size={10}/> Primary
          </span>
        )}
        {binding.is_primary !== 1 && (
          <button
            onClick={() => onSetPrimary(app.id, binding.tenant_id)}
            disabled={busy}
            className="px-2 py-1 rounded border border-gray-700 text-gray-400 hover:text-white hover:bg-gray-800 disabled:opacity-50">
            Set Primary
          </button>
        )}
        <button
          onClick={() => onRefreshPerms(app.id, binding.tenant_id)}
          disabled={busy}
          className="p-1 rounded border border-gray-700 text-gray-400 hover:text-white hover:bg-gray-800 disabled:opacity-50"
          title="Refresh permissions">
          <ShieldCheck size={12}/>
        </button>
        <button
          onClick={() => onRemoveBinding(app.id, binding.tenant_id)}
          disabled={busy}
          className="p-1 rounded border border-red-900 text-red-400 hover:bg-red-950/40 disabled:opacity-50"
          title="Remove binding">
          <Trash2 size={12}/>
        </button>
      </div>
    </div>
  )
}

export default function AppRegistrations({ showToast }) {
  const [apps, setApps] = useState([])
  const [tenants, setTenants] = useState([])
  const [loading, setLoading] = useState(true)
  const [createForm, setCreateForm] = useState(emptyCreate)
  const [bindForms, setBindForms] = useState({})
  const [editForms, setEditForms] = useState({})
  const [busyKey, setBusyKey] = useState('')

  const tenantOptions = useMemo(() => tenants.map(t => ({ id: t.id, label: t.display_name, tenantId: t.tenant_id })), [tenants])

  const loadData = async () => {
    setLoading(true)
    try {
      const [appsData, tenantsData] = await Promise.all([appRegistrationApi.list(), tenantApi.list()])
      setApps(appsData)
      setTenants(tenantsData)

      const nextBindForms = {}
      const nextEditForms = {}
      for (const app of appsData) {
        nextBindForms[app.id] = { ...emptyBind }
        nextEditForms[app.id] = {
          displayName: app.display_name || '',
          clientSecret: '',
          defaultAuthorityTenantId: app.metadata?.defaultAuthorityTenantId || '',
        }
      }
      setBindForms(nextBindForms)
      setEditForms(nextEditForms)
    } catch {
      showToast('Failed to load app registrations', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [])

  const setBusy = (key, val) => setBusyKey(val ? key : '')
  const isBusy = (key) => busyKey === key

  const createApp = async (e) => {
    e.preventDefault()
    const key = 'create'
    setBusy(key, true)
    try {
      await appRegistrationApi.create({
        displayName: createForm.displayName,
        clientId: createForm.clientId,
        clientSecret: createForm.clientSecret,
        defaultAuthorityTenantId: createForm.defaultAuthorityTenantId || undefined,
      })
      setCreateForm(emptyCreate)
      showToast('App registration created', 'success')
      await loadData()
    } catch (err) {
      showToast(err.response?.data?.error || err.response?.data?.message || 'Create failed', 'error')
    } finally {
      setBusy(key, false)
    }
  }

  const updateApp = async (appId) => {
    const key = `update:${appId}`
    setBusy(key, true)
    try {
      const form = editForms[appId]
      const body = {}
      if (form.displayName?.trim()) body.displayName = form.displayName.trim()
      if (form.clientSecret?.trim()) body.clientSecret = form.clientSecret.trim()
      if (form.defaultAuthorityTenantId?.trim()) body.defaultAuthorityTenantId = form.defaultAuthorityTenantId.trim()
      await appRegistrationApi.update(appId, body)
      showToast('App registration updated', 'success')
      await loadData()
    } catch (err) {
      showToast(err.response?.data?.error || err.response?.data?.message || 'Update failed', 'error')
    } finally {
      setBusy(key, false)
    }
  }

  const removeApp = async (appId) => {
    if (!confirm('Delete this app registration? It must be unbound from all tenants first.')) return
    const key = `delete:${appId}`
    setBusy(key, true)
    try {
      await appRegistrationApi.remove(appId)
      showToast('App registration deleted', 'success')
      await loadData()
    } catch (err) {
      showToast(err.response?.data?.error || 'Delete failed', 'error')
    } finally {
      setBusy(key, false)
    }
  }

  const bindTenant = async (appId) => {
    const form = bindForms[appId]
    if (!form?.tenantId) return showToast('Select a tenant to bind', 'error')
    const key = `bind:${appId}`
    setBusy(key, true)
    try {
      await appRegistrationApi.bind(appId, {
        tenantId: form.tenantId,
        authorityTenantId: form.authorityTenantId || undefined,
        isPrimary: !!form.isPrimary,
        refreshPermissions: !!form.refreshPermissions,
      })
      showToast('Binding saved', 'success')
      await loadData()
    } catch (err) {
      showToast(err.response?.data?.error || err.response?.data?.message || 'Binding failed', 'error')
    } finally {
      setBusy(key, false)
    }
  }

  const setPrimary = async (appId, tenantId) => {
    const key = `primary:${appId}:${tenantId}`
    setBusy(key, true)
    try {
      await appRegistrationApi.setPrimary(appId, tenantId)
      showToast('Primary binding updated', 'success')
      await loadData()
    } catch (err) {
      showToast(err.response?.data?.error || 'Set primary failed', 'error')
    } finally {
      setBusy(key, false)
    }
  }

  const refreshPermissions = async (appId, tenantId) => {
    const key = `perm:${appId}:${tenantId}`
    setBusy(key, true)
    try {
      const out = await appRegistrationApi.refreshPermissions(appId, tenantId)
      showToast(out.message || 'Permissions refreshed', 'success')
      await loadData()
    } catch (err) {
      showToast(err.response?.data?.error || 'Permission refresh failed', 'error')
    } finally {
      setBusy(key, false)
    }
  }

  const unbind = async (appId, tenantId) => {
    const key = `unbind:${appId}:${tenantId}`
    setBusy(key, true)
    try {
      await appRegistrationApi.unbind(appId, tenantId)
      showToast('Binding removed', 'success')
      await loadData()
    } catch (err) {
      showToast(err.response?.data?.error || 'Unbind failed', 'error')
    } finally {
      setBusy(key, false)
    }
  }

  if (loading) return <div className="flex items-center justify-center h-full text-gray-500">Loading…</div>

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <KeyRound size={20} className="text-brand-500"/> App Registrations
        </h1>
        <p className="text-gray-500 text-sm mt-1">Manage shared app credentials and bind them across tenants.</p>
      </div>

      <form onSubmit={createApp} className="card space-y-3">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2"><Plus size={14}/> New App Registration</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input className="input" placeholder="Display name"
            value={createForm.displayName}
            onChange={e => setCreateForm(f => ({ ...f, displayName: e.target.value }))} required />
          <input className="input font-mono" placeholder="Client ID (GUID)"
            value={createForm.clientId}
            onChange={e => setCreateForm(f => ({ ...f, clientId: e.target.value }))} required />
          <input className="input" type="password" placeholder="Client secret"
            value={createForm.clientSecret}
            onChange={e => setCreateForm(f => ({ ...f, clientSecret: e.target.value }))} required />
          <input className="input font-mono" placeholder="Default authority tenant ID (optional)"
            value={createForm.defaultAuthorityTenantId}
            onChange={e => setCreateForm(f => ({ ...f, defaultAuthorityTenantId: e.target.value }))} />
        </div>
        <div className="flex justify-end">
          <button type="submit" disabled={isBusy('create')} className="btn-primary">
            {isBusy('create') ? 'Creating…' : 'Create App Registration'}
          </button>
        </div>
      </form>

      <div className="space-y-4">
        {apps.length === 0 && (
          <div className="card text-sm text-gray-500">No app registrations yet.</div>
        )}

        {apps.map(app => {
          const bindForm = bindForms[app.id] || { ...emptyBind }
          const editForm = editForms[app.id] || { displayName: '', clientSecret: '', defaultAuthorityTenantId: '' }

          return (
            <div key={app.id} className="card space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-white font-semibold">{app.display_name}</h3>
                  <p className="text-xs text-gray-500 font-mono mt-1">client_id: {app.client_id}</p>
                  <p className="text-xs text-gray-600 mt-1">Bound tenants: {app.tenant_count}</p>
                </div>
                <button
                  onClick={() => removeApp(app.id)}
                  disabled={isBusy(`delete:${app.id}`)}
                  className="text-xs px-2.5 py-1.5 rounded border border-red-900 text-red-400 hover:bg-red-950/40 disabled:opacity-50">
                  {isBusy(`delete:${app.id}`) ? 'Deleting…' : 'Delete'}
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <input className="input" placeholder="Display name"
                  value={editForm.displayName}
                  onChange={e => setEditForms(prev => ({ ...prev, [app.id]: { ...prev[app.id], displayName: e.target.value } }))} />
                <input className="input font-mono" placeholder="Default authority tenant ID"
                  value={editForm.defaultAuthorityTenantId}
                  onChange={e => setEditForms(prev => ({ ...prev, [app.id]: { ...prev[app.id], defaultAuthorityTenantId: e.target.value } }))} />
                <input className="input" type="password" placeholder="New client secret (optional)"
                  value={editForm.clientSecret}
                  onChange={e => setEditForms(prev => ({ ...prev, [app.id]: { ...prev[app.id], clientSecret: e.target.value } }))} />
              </div>
              <div className="flex justify-end">
                <button
                  onClick={() => updateApp(app.id)}
                  disabled={isBusy(`update:${app.id}`)}
                  className="text-xs px-3 py-1.5 rounded border border-gray-700 text-gray-300 hover:text-white hover:bg-gray-800 flex items-center gap-1.5 disabled:opacity-50">
                  <Save size={12}/>{isBusy(`update:${app.id}`) ? 'Saving…' : 'Save Changes'}
                </button>
              </div>

              <div className="space-y-2">
                <h4 className="text-sm font-medium text-gray-200 flex items-center gap-2"><Link2 size={13}/> Bindings</h4>
                {(app.bindings || []).length === 0 && (
                  <p className="text-xs text-gray-600">No tenant bindings yet.</p>
                )}
                {(app.bindings || []).map(binding => (
                  <BindingRow
                    key={`${app.id}:${binding.tenant_id}`}
                    app={app}
                    binding={binding}
                    busy={busyKey !== ''}
                    onSetPrimary={setPrimary}
                    onRefreshPerms={refreshPermissions}
                    onRemoveBinding={unbind}
                  />
                ))}
              </div>

              <div className="pt-2 border-t border-gray-800 space-y-2">
                <h4 className="text-sm font-medium text-gray-200">Add / Update Binding</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <select
                    className="input"
                    value={bindForm.tenantId}
                    onChange={e => setBindForms(prev => ({ ...prev, [app.id]: { ...prev[app.id], tenantId: e.target.value } }))}>
                    <option value="">Select tenant…</option>
                    {tenantOptions.map(t => (
                      <option key={t.id} value={t.id}>{t.label} ({t.tenantId})</option>
                    ))}
                  </select>
                  <input className="input font-mono" placeholder="Authority tenant ID (optional)"
                    value={bindForm.authorityTenantId}
                    onChange={e => setBindForms(prev => ({ ...prev, [app.id]: { ...prev[app.id], authorityTenantId: e.target.value } }))} />
                </div>
                <div className="flex items-center gap-4 text-xs text-gray-400">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={!!bindForm.isPrimary}
                      onChange={e => setBindForms(prev => ({ ...prev, [app.id]: { ...prev[app.id], isPrimary: e.target.checked } }))} />
                    Set as primary
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={!!bindForm.refreshPermissions}
                      onChange={e => setBindForms(prev => ({ ...prev, [app.id]: { ...prev[app.id], refreshPermissions: e.target.checked } }))} />
                    Refresh permissions now
                  </label>
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={() => bindTenant(app.id)}
                    disabled={isBusy(`bind:${app.id}`)}
                    className="text-xs px-3 py-1.5 rounded border border-brand-700 text-brand-300 hover:text-white hover:bg-brand-900/50 disabled:opacity-50 flex items-center gap-1.5">
                    {isBusy(`bind:${app.id}`)
                      ? <><RefreshCw size={12} className="animate-spin"/> Saving…</>
                      : <><Link2 size={12}/> Save Binding</>}
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
