import { useState, useEffect, useRef } from 'react'
import Modal from '../components/Modal.jsx'
import { useNavigate } from 'react-router-dom'
import {
  Settings, Upload, Image, Info, Check, AlertTriangle, ExternalLink,
  Trash2, RefreshCw, RotateCcw, Palette, Eye, FileText,
  Webhook, Plus, X, Send, Globe, ChevronDown, ChevronRight, Clock, KeyRound
} from 'lucide-react'
import { appRegistrationApi, msspApi, webhookApi, tenantApi } from '../api/client.js'
import { applyBrandHue, useBranding } from '../App.jsx'

const LOG_ANALYTICS_GUIDE_URL = 'https://github.com/AntoPorter/trustm365/blob/main/docs/guides/21-log-analytics-and-sentinel.md'

// ── TrustM365 default brand hue (indigo ~238°)
const DEFAULT_HUE = 238

// ── Preset accent palettes ───────────────────────────────────────────────────
const PRESETS = [
  { name: 'TrustM365',    hue: null,  hex: '#6366f1' },  // null = use defaults
  { name: 'Ocean',        hue: 210,   hex: '#3b82f6' },
  { name: 'Teal',         hue: 174,   hex: '#14b8a6' },
  { name: 'Emerald',      hue: 142,   hex: '#22c55e' },
  { name: 'Amber',        hue:  38,   hex: '#f59e0b' },
  { name: 'Rose',         hue: 345,   hex: '#f43f5e' },
  { name: 'Violet',       hue: 263,   hex: '#8b5cf6' },
  { name: 'Slate',        hue: 215,   hex: '#64748b' },
]

// ── Logo drop zone ────────────────────────────────────────────────────────────
function LogoDropZone({ currentLogoUrl, onUploaded, onRemoved, showToast }) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef();

  const handleFile = async (file) => {
    if (!file) return;
    const allowed = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];
    if (!allowed.includes(file.type)) {
      showToast('Only PNG, JPEG, SVG, and WebP files are accepted', 'error');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      showToast('File must be under 2 MB', 'error');
      return;
    }
    setUploading(true);
    try {
      const result = await msspApi.uploadLogo(file);
      onUploaded(result.logo_url);
      showToast('Logo uploaded successfully', 'success');
    } catch (err) {
      showToast(err.response?.data?.error || 'Upload failed', 'error');
    } finally {
      setUploading(false);
    }
  };

  const removeLogo = async () => {
    try {
      await msspApi.deleteLogo();
      onRemoved();
      showToast('Logo removed — TrustM365 default restored', 'success');
    } catch {
      showToast('Remove failed', 'error');
    }
  };

  return (
    <div className="space-y-3">
      {/* Current logo preview */}
      {currentLogoUrl && (
        <div className="flex items-center gap-4 p-3 bg-gray-800/40 border border-gray-700 rounded-xl">
          <div className="w-14 h-14 rounded-lg border border-gray-700 bg-gray-800 flex items-center justify-center overflow-hidden shrink-0">
            <img
              src={currentLogoUrl}
              alt="Current logo"
              className="w-12 h-12 object-contain"
              onError={e => {
                e.currentTarget.style.display = 'none';
              }}
            />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white font-medium">Custom logo active</p>
            <p className="text-xs text-gray-500 mt-0.5 truncate">{currentLogoUrl}</p>
          </div>
          <button
            onClick={removeLogo}
            className="flex items-center gap-1.5 text-xs text-red-400 border border-red-900/50 hover:bg-red-950/30 px-2.5 py-1.5 rounded-lg transition-colors shrink-0"
          >
            <Trash2 size={11} /> Remove
          </button>
        </div>
      )}

      {/* Drop zone */}
      <div
        onDragOver={e => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => {
          e.preventDefault();
          setDragOver(false);
          handleFile(e.dataTransfer.files[0]);
        }}
        onClick={() => fileRef.current?.click()}
        className={`flex flex-col items-center justify-center gap-2 p-6 rounded-xl border-2 border-dashed cursor-pointer transition-all ${dragOver ? 'border-brand-500 bg-brand-950/20' : 'border-gray-700 hover:border-gray-600 hover:bg-gray-800/30'}`}
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/svg+xml,image/webp"
          className="hidden"
          onChange={e => handleFile(e.target.files[0])}
        />
        {uploading ? (
          <RefreshCw size={20} className="text-brand-400 animate-spin" />
        ) : (
          <Upload size={20} className={dragOver ? 'text-brand-400' : 'text-gray-600'} />
        )}
        <div className="text-center">
          <p className="text-sm text-gray-400 font-medium">
            {uploading ? 'Uploading…' : 'Drop your logo here or click to browse'}
          </p>
          <p className="text-xs text-gray-600 mt-1">PNG, JPEG, SVG, or WebP · Max 2 MB · Square recommended</p>
        </div>
      </div>

      {/* Spec guidance */}
      <div className="flex items-start gap-2 bg-blue-950/20 border border-blue-900/40 rounded-lg px-3 py-2.5 text-xs text-blue-300">
        <Info size={11} className="shrink-0 mt-0.5" />
        <span>
          For best results use a square image (e.g. 200×200px) with a transparent background. The logo appears in the sidebar at 32×32px and on the homepage at up to 88×88px. SVG is recommended for crisp rendering at all sizes.
        </span>
      </div>
    </div>
  );
}


// ── Colour scheme picker ──────────────────────────────────────────────────────
function ColourPicker({ currentHue, onChange }) {
  const [customHue, setCustomHue] = useState(currentHue ?? DEFAULT_HUE)

  const handlePreset = (hue) => {
    onChange(hue)
    if (hue !== null) setCustomHue(hue)
  }

  const handleCustom = (val) => {
    const h = parseInt(val)
    setCustomHue(h)
    onChange(h)
  }

  return (
    <div className="space-y-4">
      {/* Preset swatches */}
      <div>
        <p className="text-xs text-gray-500 mb-2.5 font-medium">Presets</p>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map(preset => {
            const isActive = preset.hue === null
              ? currentHue === null
              : currentHue === preset.hue
            return (
              <button key={preset.name} onClick={() => handlePreset(preset.hue)}
                title={preset.name}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs transition-all
                  ${isActive
                    ? 'border-white/40 bg-gray-700 text-white ring-2 ring-offset-1 ring-offset-gray-900 ring-white/20'
                    : 'border-gray-700 text-gray-400 hover:border-gray-600 hover:text-white'}`}>
                <span className="w-3 h-3 rounded-full shrink-0 border border-white/20"
                  style={{ backgroundColor: preset.hex }}/>
                {preset.name}
              </button>
            )
          })}
        </div>
      </div>

      {/* Custom hue slider */}
      <div>
        <p className="text-xs text-gray-500 mb-2 font-medium">Custom hue</p>
        <div className="flex items-center gap-3">
          {/* Hue spectrum track */}
          <div className="relative flex-1 h-8 rounded-lg overflow-hidden"
            style={{ background: 'linear-gradient(to right, hsl(0,80%,55%),hsl(60,80%,55%),hsl(120,80%,55%),hsl(180,80%,55%),hsl(240,80%,55%),hsl(300,80%,55%),hsl(360,80%,55%))' }}>
            <input type="range" min={0} max={359} value={customHue}
              onChange={e => handleCustom(e.target.value)}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
            {/* Thumb indicator */}
            <div className="absolute top-1/2 -translate-y-1/2 w-5 h-5 rounded-full border-2 border-white shadow-md pointer-events-none transition-all"
              style={{
                left: `calc(${(customHue / 359) * 100}% - 10px)`,
                backgroundColor: `hsl(${customHue},80%,55%)`
              }}/>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-7 h-7 rounded-lg border border-gray-600 shrink-0"
              style={{ backgroundColor: `hsl(${customHue},80%,55%)` }}/>
            <input type="number" min={0} max={359} value={customHue}
              onChange={e => handleCustom(e.target.value)}
              className="input w-16 text-center text-xs py-1.5 font-mono"/>
            <span className="text-xs text-gray-600">°</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function MsspSettings({ showToast }) {
  const navigate = useNavigate()
  const { logoUrl: contextLogo, setLogoUrl: setContextLogo } = useBranding()

  const [loading,        setLoading]        = useState(true)
  const [saving,         setSaving]         = useState(false)
  const [resetting,      setResetting]      = useState(false)
  const [companyName,    setCompanyName]    = useState('')
  const [tagline,        setTagline]        = useState('')
  const [labelTemplate,  setLabelTemplate]  = useState('')
  const [currentLogoUrl, setCurrentLogoUrl] = useState(null)
  const [brandHue,       setBrandHue]       = useState(null)
  const [reportAccent,   setReportAccent]   = useState('')
  const [laEnabled,      setLaEnabled]      = useState(false)
  const [laWorkspaceId,  setLaWorkspaceId]  = useState('')
  const [laSharedKey,    setLaSharedKey]    = useState('')
  const [laHasSharedKey, setLaHasSharedKey] = useState(false)
  const [laClearKey,     setLaClearKey]     = useState(false)
  const [laLogTypePrefix, setLaLogTypePrefix] = useState('TrustM365')
  const [laSchemaVersion, setLaSchemaVersion] = useState('1.0')
  const [laIngest, setLaIngest] = useState({
    drift: true,
    restore: true,
    jobs: true,
    webhooks: true,
    api_logs: false,
  })
  const [testingLa, setTestingLa] = useState(false)
  // Timezone setting removed: timestamps now use server local time or UTC

  // Webhook state
  const [webhooks,     setWebhooks]     = useState([])
  const [appRegistrations, setAppRegistrations] = useState([])
  const [allTenants,   setAllTenants]   = useState([])
  const [showAddWh,    setShowAddWh]    = useState(false)
  const [testingWh,    setTestingWh]    = useState(null)
  const [deletingWh,   setDeletingWh]   = useState(null)
  const [newWh, setNewWh] = useState({ label: '', url: '', tenantId: '', fireMode: 'first' })

  useEffect(() => {
    msspApi.getSettings()
      .then(s => {
        setCompanyName(s.company_name || '')
        setTagline(s.tagline || '')
        setLabelTemplate(s.baseline_label_template || '')
        setCurrentLogoUrl(s.logo_url || null)
        setBrandHue(s.brand_hue !== undefined ? s.brand_hue : null)
        setReportAccent(s.report_accent || '')
        setLaEnabled(Number(s.la_enabled || 0) === 1)
        setLaWorkspaceId(s.la_workspace_id || '')
        setLaHasSharedKey(!!s.la_has_shared_key)
        setLaLogTypePrefix(s.la_log_type_prefix || 'TrustM365')
        setLaSchemaVersion(s.la_schema_version || '1.0')
        setLaIngest({
          drift: Number(s.la_ingest_drift ?? 1) === 1,
          restore: Number(s.la_ingest_restore ?? 1) === 1,
          jobs: Number(s.la_ingest_jobs ?? 1) === 1,
          webhooks: Number(s.la_ingest_webhooks ?? 1) === 1,
          api_logs: Number(s.la_ingest_api_logs ?? 0) === 1,
        })
        // setTimezone removed
        if (s.brand_hue) applyBrandHue(s.brand_hue)
      })
      .catch(() => showToast('Failed to load MSSP settings', 'error'))
      .finally(() => setLoading(false))
    webhookApi.list().then(setWebhooks).catch(() => {})
    appRegistrationApi.list().then(setAppRegistrations).catch(() => {})
    tenantApi.list().then(setAllTenants).catch(() => {})
  }, [])

  const totalBindings = appRegistrations.reduce((sum, app) => sum + Number(app.tenant_count || 0), 0)
  const multiTenantApps = appRegistrations.filter(app => Number(app.tenant_count || 0) > 1).length

  const save = async () => {
    setSaving(true)
    try {
      await msspApi.updateSettings({
        company_name: companyName,
        baseline_label_template: labelTemplate,
        brand_hue: brandHue,
        tagline,
        // report_theme: always light (fixed in renderer)
        report_accent: reportAccent,
        la_enabled: laEnabled,
        la_workspace_id: laWorkspaceId,
        la_shared_key: laSharedKey || undefined,
        la_clear_shared_key: laClearKey,
        la_log_type_prefix: laLogTypePrefix,
        la_schema_version: laSchemaVersion,
        la_ingest_drift: laIngest.drift,
        la_ingest_restore: laIngest.restore,
        la_ingest_jobs: laIngest.jobs,
        la_ingest_webhooks: laIngest.webhooks,
        la_ingest_api_logs: laIngest.api_logs,
        // timezone removed
      })
      if (laClearKey) {
        setLaHasSharedKey(false)
        setLaClearKey(false)
      }
      if (laSharedKey) {
        setLaHasSharedKey(true)
        setLaSharedKey('')
      }
      applyBrandHue(brandHue)
      showToast('Settings saved', 'success')
    } catch { showToast('Save failed', 'error') }
    finally { setSaving(false) }
  }

  const [showResetModal, setShowResetModal] = useState(false)
  const resetToDefaults = async () => {
    setResetting(true)
    try {
      await msspApi.resetDefaults()
      setCompanyName('')
      setTagline('')
      setLabelTemplate('')
      setCurrentLogoUrl(null)
      setContextLogo(null)
      setBrandHue(null)
      setReportAccent('')
      setLaEnabled(false)
      setLaWorkspaceId('')
      setLaSharedKey('')
      setLaHasSharedKey(false)
      setLaClearKey(false)
      setLaLogTypePrefix('TrustM365')
      setLaSchemaVersion('1.0')
      setLaIngest({ drift: true, restore: true, jobs: true, webhooks: true, api_logs: false })
      // setTimezone removed
      applyBrandHue(null)
      showToast('Reset to TrustM365 defaults', 'success')
    } catch { showToast('Reset failed', 'error') }
    finally { setResetting(false); setShowResetModal(false) }
  }

  if (loading) return <div className="flex items-center justify-center h-full text-gray-500">Loading…</div>


  return (
    <div className="p-6 max-w-3xl mx-auto space-y-10">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Settings size={20} className="text-brand-500"/> MSSP Settings
          </h1>
          <p className="text-gray-500 text-sm mt-1">White-label and branding configuration.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={save} disabled={saving} className="btn-primary text-xs">
            {saving ? <><RefreshCw size={12} className="animate-spin"/> Saving…</> : <><Check size={12}/> Save Settings</>}
          </button>
          <button onClick={() => setShowResetModal(true)} disabled={resetting}
            className="flex items-center gap-2 text-xs text-gray-500 hover:text-red-400 border border-gray-700 hover:border-red-900/60 px-3 py-2 rounded-lg transition-colors">
            <RotateCcw size={12} className={resetting ? 'animate-spin' : ''}/>
            {resetting ? 'Resetting…' : 'Reset to Defaults'}
          </button>
          <Modal
            open={showResetModal}
            title="Reset to TrustM365 Defaults"
            onClose={() => setShowResetModal(false)}
            actions={[
              <button key="cancel" onClick={() => setShowResetModal(false)} className="btn-secondary text-xs">Cancel</button>,
              <button key="reset" onClick={resetToDefaults} disabled={resetting} className="btn-primary text-xs bg-red-700 hover:bg-red-800 border-red-900">
                {resetting ? <><RefreshCw size={12} className="animate-spin"/> Resetting…</> : 'Yes, Reset All'}
              </button>
            ]}
          >
            Are you sure you want to reset <b>all branding and settings</b> to TrustM365 defaults? This will remove your custom logo, accent colour, company name, tagline, and all report branding.
          </Modal>
        </div>
      </div>

      {/* ── MSSP Branding Section ── */}
      <section>
        <h2 className="text-lg font-bold text-brand-400 mb-4">MSSP Branding</h2>
        <div className="space-y-6">
          {/* Organisation name */}
          <div className="card space-y-3">
            <h3 className="text-sm font-semibold text-white">Organisation Name</h3>
            <p className="text-xs text-gray-500">Displayed on reports and the portfolio view. Replaces "TrustM365" as the primary brand name on all customer-facing outputs.</p>
            <input className="input" placeholder="e.g. Acme Security Services"
              value={companyName} onChange={e => setCompanyName(e.target.value)}/>
          </div>

          {/* Tagline */}
          <div className="card space-y-3">
            <h3 className="text-sm font-semibold text-white">Tagline</h3>
            <p className="text-xs text-gray-500">Optional short descriptor shown beneath your company name on report cover pages and the footer.</p>
            <input className="input" placeholder="e.g. Your trusted M365 security partner"
              value={tagline} onChange={e => setTagline(e.target.value)}/>
            {tagline && (
              <p className="text-xs text-gray-600">Preview: <span className="text-gray-300">{companyName || 'Company Name'}</span> · <span className="text-gray-500">{tagline}</span></p>
            )}
          </div>

          {/* Default baseline label template */}
          <div className="card space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-white">Default Baseline Label</h3>
              <p className="text-xs text-gray-500 mt-1">
                Pre-fills the label field when creating a new baseline. Use <code className="bg-gray-800 px-1 rounded">{'{date}'}</code> to insert today's date.
              </p>
            </div>
            <input className="input" placeholder="e.g. Baseline — {date}"
              value={labelTemplate} onChange={e => setLabelTemplate(e.target.value)}/>
            {labelTemplate && (
              <p className="text-xs text-gray-600">
                Preview: <span className="text-gray-300">
                  {labelTemplate.replace('{date}', new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }))}
                </span>
              </p>
            )}
          </div>

          {/* Logo */}
          <div className="card space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Image size={14} className="text-brand-500"/> Custom Logo
              </h3>
              <p className="text-xs text-gray-500 mt-1">
                Replaces the TrustM365 shield mark in the sidebar and on the homepage.
              </p>
            </div>
            <LogoDropZone
              currentLogoUrl={currentLogoUrl}
              onUploaded={url => { setCurrentLogoUrl(url); setContextLogo(url) }}
              onRemoved={() => { setCurrentLogoUrl(null); setContextLogo(null) }}
              showToast={showToast}
            />
          </div>

          {/* Accent colour */}
          <div className="card space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Palette size={14} className="text-brand-500"/> Accent Colour
              </h3>
              <p className="text-xs text-gray-500 mt-1">
                Changes the brand colour used for buttons, focus rings, active states, and highlights across the entire dashboard — in both dark and light mode.
              </p>
            </div>
            <ColourPicker
              currentHue={brandHue !== null ? parseInt(brandHue) : null}
              onChange={hue => {
                setBrandHue(hue)
                applyBrandHue(hue)  // live preview as you drag
              }}
            />
            <div className="flex items-start gap-2 bg-amber-950/20 border border-amber-900/40 rounded-lg px-3 py-2.5 text-xs text-amber-300">
              <Eye size={11} className="shrink-0 mt-0.5"/>
              <span>The colour preview updates live as you adjust. Click <strong>Save Settings</strong> to persist across sessions.</span>
            </div>
          </div>

          {/* Report branding */}
          <div className="card space-y-5">
            <div>
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <FileText size={14} className="text-brand-500"/> Report Branding
              </h3>
              <p className="text-xs text-gray-500 mt-1">
                Controls how generated reports look when sent to clients. These settings are independent of the dashboard theme.
              </p>
            </div>

            {/* Report accent colour */}
            <div>
              <p className="text-xs text-gray-400 font-medium mb-2">Report accent colour</p>
              <p className="text-xs text-gray-600 mb-3">
                Overrides the accent colour used in reports — headings, coverage donut, commentary callouts, stat values.
                Leave blank to use the dashboard accent colour.
              </p>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={reportAccent || '#6366f1'}
                  onChange={e => setReportAccent(e.target.value)}
                  className="w-10 h-10 rounded-lg border border-gray-700 bg-gray-800 cursor-pointer p-0.5"
                />
                <input
                  className="input w-32 font-mono text-xs"
                  placeholder="#6366f1"
                  value={reportAccent}
                  onChange={e => setReportAccent(e.target.value)}
                />
                {reportAccent && (
                  <button onClick={() => setReportAccent('')}
                    className="text-xs text-gray-600 hover:text-gray-400 transition-colors">
                    Clear (use dashboard colour)
                  </button>
                )}
              </div>
            </div>

            {/* Preview note */}
            <div className="flex items-start gap-2 bg-blue-950/20 border border-blue-900/40 rounded-lg px-3 py-2.5 text-xs text-blue-300">
              <Info size={11} className="shrink-0 mt-0.5"/>
              <span>
                These settings apply to all newly generated reports. Existing stored reports are not affected.
                Generate a new report to see the updated branding.
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Integration & Notifications Section ── */}
      <section>
        <h2 className="text-lg font-bold text-brand-400 mb-4 mt-8">Integration & Notifications</h2>
        <div className="space-y-6">

      <div className="card space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <Globe size={14} className="text-brand-500"/> Log Analytics and Sentinel
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            Stream TrustM365 telemetry into Azure Log Analytics for Microsoft Sentinel analytics, incidents, and workbooks.
          </p>
        </div>

        <div className="flex items-start gap-2 bg-blue-950/20 border border-blue-900/40 rounded-lg px-3 py-2.5 text-xs text-blue-300">
          <Info size={11} className="shrink-0 mt-0.5"/>
          <span>
            For setup details, use the{' '}
            <a
              href={LOG_ANALYTICS_GUIDE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-blue-200 hover:text-blue-100 underline"
            >
              Log Analytics and Sentinel guide
              <ExternalLink size={10}/>
            </a>
            . Keep the default <code className="bg-blue-950 px-1 rounded">TrustM365</code> table prefix to align with the prebuilt Sentinel content pack queries, analytics rules, and workbook.
          </span>
        </div>

        <label className="flex items-center justify-between gap-3 rounded-lg border border-gray-800 bg-gray-900/40 px-3 py-2.5">
          <div>
            <p className="text-sm text-white font-medium">Enable Log Analytics export</p>
            <p className="text-xs text-gray-500">When enabled, selected event categories are exported to custom tables.</p>
          </div>
          <input type="checkbox" checked={laEnabled} onChange={e => setLaEnabled(e.target.checked)} />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Workspace ID</label>
            <input
              className="input w-full text-xs font-mono"
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              value={laWorkspaceId}
              onChange={e => setLaWorkspaceId(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Shared key</label>
            <input
              type="password"
              className="input w-full text-xs font-mono"
              placeholder={laHasSharedKey ? 'Saved key exists. Enter to rotate.' : 'Paste workspace shared key'}
              value={laSharedKey}
              onChange={e => {
                setLaSharedKey(e.target.value)
                setLaClearKey(false)
              }}
            />
            <div className="flex items-center gap-2 mt-1">
              {laHasSharedKey && !laSharedKey && !laClearKey && (
                <span className="text-[11px] text-green-400">Saved key is configured</span>
              )}
              {laHasSharedKey && (
                <button
                  type="button"
                  onClick={() => setLaClearKey(v => !v)}
                  className="text-[11px] text-gray-500 hover:text-red-400"
                >
                  {laClearKey ? 'Cancel key removal' : 'Clear saved key on next save'}
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Table prefix</label>
            <input
              className="input w-full text-xs font-mono"
              placeholder="TrustM365"
              value={laLogTypePrefix}
              onChange={e => setLaLogTypePrefix(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Schema version</label>
            <input
              className="input w-full text-xs font-mono"
              placeholder="1.0"
              value={laSchemaVersion}
              onChange={e => setLaSchemaVersion(e.target.value)}
            />
          </div>
        </div>

        <div>
          <p className="text-xs text-gray-400 font-medium mb-2">Ingestion categories</p>
          <div className="grid grid-cols-2 gap-2">
            {[
              ['drift', 'Drift lifecycle'],
              ['restore', 'Remediation and restore outcomes'],
              ['jobs', 'Job and scheduler health'],
              ['webhooks', 'Webhook delivery outcomes'],
              ['api_logs', 'API request logs (high volume)'],
            ].map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-xs text-gray-300 border border-gray-800 rounded-lg px-2.5 py-2">
                <input
                  type="checkbox"
                  checked={!!laIngest[key]}
                  onChange={e => setLaIngest(prev => ({ ...prev, [key]: e.target.checked }))}
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-blue-900/40 bg-blue-950/20 px-3 py-2.5 gap-2">
          <p className="text-xs text-blue-300">Use Test Connection, then click Save Settings (top of page) to persist your Log Analytics configuration.</p>
          <button
            onClick={async () => {
              setTestingLa(true)
              try {
                await msspApi.testLogAnalytics({
                  la_enabled: laEnabled,
                  la_workspace_id: laWorkspaceId,
                  la_shared_key: laSharedKey || undefined,
                  la_log_type_prefix: laLogTypePrefix,
                  la_schema_version: laSchemaVersion,
                })
                showToast('Log Analytics connection test successful', 'success')
              } catch (err) {
                showToast(err.response?.data?.error || 'Log Analytics connection test failed', 'error')
              } finally {
                setTestingLa(false)
              }
            }}
            disabled={testingLa}
            className="btn-secondary text-xs shrink-0"
          >
            {testingLa ? <><RefreshCw size={12} className="animate-spin"/> Testing…</> : <><Send size={12}/> Test Connection</>}
          </button>
        </div>
      </div>

      {/* Webhook destinations */}
      <div className="card space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <KeyRound size={14} className="text-brand-500"/> Identity & App Registrations
            </h2>
            <p className="text-xs text-gray-500 mt-1">
              Central control plane for multi-tenant authentication, shared app registrations, tenant bindings, and secret lifecycle.
            </p>
          </div>
          <button
            onClick={() => navigate('/mssp-settings/app-registrations')}
            className="btn-secondary text-xs">
            Manage App Registrations
          </button>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-gray-800 bg-gray-900/40 px-3 py-2.5">
            <p className="text-xs text-gray-500">App registrations</p>
            <p className="text-lg font-semibold text-white mt-0.5">{appRegistrations.length}</p>
          </div>
          <div className="rounded-lg border border-gray-800 bg-gray-900/40 px-3 py-2.5">
            <p className="text-xs text-gray-500">Tenant bindings</p>
            <p className="text-lg font-semibold text-white mt-0.5">{totalBindings}</p>
          </div>
          <div className="rounded-lg border border-gray-800 bg-gray-900/40 px-3 py-2.5">
            <p className="text-xs text-gray-500">Multi-tenant apps</p>
            <p className="text-lg font-semibold text-white mt-0.5">{multiTenantApps}</p>
          </div>
        </div>

        <div className="rounded-lg border border-blue-900/40 bg-blue-950/20 px-3 py-2.5 text-xs text-blue-300">
          Use this area when onboarding new tenants with shared credentials, rotating secrets once for many tenants,
          and confirming cross-tenant authority mappings.
        </div>
      </div>

      {/* Webhook destinations */}
      <div className="card space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <Webhook size={14} className="text-brand-500"/> Webhook Notifications
            </h2>
            <p className="text-xs text-gray-500 mt-1">
              Send a JSON payload to a URL when drift is detected. Compatible with Teams, Slack, PagerDuty, and any service that accepts an incoming webhook.
            </p>
          </div>
          <button onClick={() => setShowAddWh(v => !v)}
            className={`btn-secondary text-xs ${showAddWh ? 'border-brand-700/60 text-brand-300' : ''}`}>
            <Plus size={12}/> Add
          </button>
        </div>

        {/* Add form */}
        {showAddWh && (
          <div className="border border-gray-700 rounded-xl p-4 space-y-3 bg-gray-900/30">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Label</label>
                <input className="input w-full text-xs" placeholder="e.g. Teams — Security Alerts"
                  value={newWh.label} onChange={e => setNewWh(w => ({ ...w, label: e.target.value }))}/>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Webhook URL <span className="text-red-500">*</span></label>
                <input className="input w-full text-xs font-mono" placeholder="https://…"
                  value={newWh.url} onChange={e => setNewWh(w => ({ ...w, url: e.target.value }))}/>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Scope</label>
                <select className="input w-full text-xs" value={newWh.tenantId}
                  onChange={e => setNewWh(w => ({ ...w, tenantId: e.target.value }))}>
                  <option value="">All tenants (MSSP-wide)</option>
                  {allTenants.map(t => <option key={t.id} value={t.id}>{t.display_name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Fire mode</label>
                <select className="input w-full text-xs" value={newWh.fireMode}
                  onChange={e => setNewWh(w => ({ ...w, fireMode: e.target.value }))}>
                  <option value="first">First detection only — once until resolved</option>
                  <option value="every">Every sync — fires each time drift is confirmed</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => { setShowAddWh(false); setNewWh({ label: '', url: '', tenantId: '', fireMode: 'first' }) }}
                className="btn-secondary text-xs">Cancel</button>
              <button
                disabled={!newWh.url.trim()}
                onClick={async () => {
                  try {
                    await webhookApi.create({ label: newWh.label, url: newWh.url, tenantId: newWh.tenantId || null, fireMode: newWh.fireMode })
                    const updated = await webhookApi.list()
                    setWebhooks(updated)
                    setShowAddWh(false)
                    setNewWh({ label: '', url: '', tenantId: '', fireMode: 'first' })
                    showToast('Webhook destination added', 'success')
                  } catch (err) { showToast(err.response?.data?.error || 'Failed to add webhook', 'error') }
                }}
                className="btn-primary text-xs"><Check size={12}/> Save</button>
            </div>
          </div>
        )}

        {/* Webhook list */}
        {webhooks.length === 0 && !showAddWh && (
          <p className="text-xs text-gray-700 text-center py-4">No webhook destinations configured.</p>
        )}
        {webhooks.length > 0 && (
          <div className="space-y-2">
            {webhooks.map(wh => (
              <div key={wh.id}
                className={`flex items-start gap-3 border rounded-xl px-3 py-2.5 transition-colors
                  ${wh.enabled ? 'border-gray-800' : 'border-gray-800/40 opacity-60'}`}>
                <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${wh.enabled ? 'bg-green-500' : 'bg-gray-700'}`}/>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-white font-medium truncate">
                      {wh.label || 'Untitled'}
                    </span>
                    <span className="text-xs text-gray-600 border border-gray-800 rounded px-1.5 py-0.5">
                      {wh.fire_mode === 'first' ? 'First detection' : 'Every sync'}
                    </span>
                    {wh.tenant_name && (
                      <span className="text-xs text-brand-400/70">{wh.tenant_name}</span>
                    )}
                    {!wh.tenant_name && (
                      <span className="text-xs text-gray-600">All tenants</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-600 font-mono truncate mt-0.5">{wh.url}</p>
                  {wh.last_fired_at && (
                    <p className="text-xs text-gray-700 mt-0.5">
                      Last fired: {new Date(wh.last_fired_at).toLocaleString()}
                    </p>
                  )}
                  {wh.last_error && (
                    <p className="text-xs text-red-500 mt-0.5">Error: {wh.last_error}</p>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {/* Enable/disable toggle */}
                  <button
                    onClick={async () => {
                      await webhookApi.update(wh.id, { enabled: !wh.enabled })
                      setWebhooks(whs => whs.map(w => w.id === wh.id ? { ...w, enabled: !w.enabled } : w))
                    }}
                    className="text-xs text-gray-600 hover:text-gray-300 border border-gray-800 rounded px-2 py-1 transition-colors">
                    {wh.enabled ? 'Disable' : 'Enable'}
                  </button>
                  {/* Test */}
                  <button
                    disabled={testingWh === wh.id}
                    onClick={async () => {
                      setTestingWh(wh.id)
                      try {
                        await webhookApi.test(wh.id)
                        setWebhooks(await webhookApi.list())
                        showToast('Test delivery successful', 'success')
                      } catch (err) {
                        setWebhooks(await webhookApi.list())
                        showToast(err.response?.data?.error || 'Test delivery failed', 'error')
                      } finally { setTestingWh(null) }
                    }}
                    className="text-xs text-gray-600 hover:text-brand-400 border border-gray-800 rounded px-2 py-1 transition-colors">
                    <Send size={10} className={testingWh === wh.id ? 'animate-pulse' : ''}/>
                  </button>
                  {/* Delete */}
                  <button
                    disabled={deletingWh === wh.id}
                    onClick={async () => {
                      if (!confirm(`Delete webhook "${wh.label || wh.url}"?`)) return
                      setDeletingWh(wh.id)
                      try {
                        await webhookApi.delete(wh.id)
                        setWebhooks(whs => whs.filter(w => w.id !== wh.id))
                        showToast('Webhook deleted', 'success')
                      } catch { showToast('Delete failed', 'error') }
                      finally { setDeletingWh(null) }
                    }}
                    className="text-xs text-red-500/70 hover:text-red-400 border border-gray-800 hover:border-red-900/50 rounded px-2 py-1 transition-colors">
                    <Trash2 size={10}/>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-start gap-2 bg-blue-950/20 border border-blue-900/40 rounded-lg px-3 py-2.5 text-xs text-blue-300">
          <Info size={11} className="shrink-0 mt-0.5"/>
          <span>
            Payload is a JSON <code className="bg-blue-950 px-1 rounded">POST</code> to your URL.
            Works with Teams, Slack, PagerDuty, and any service with an incoming webhook.
            Use the <Send size={9} className="inline"/> test button to verify delivery before relying on it.
          </span>
        </div>
      </div>

      {/* Timezone setting removed: timestamps now use server local time or UTC */}

      </div>
      </section>
    </div>
  );
}
