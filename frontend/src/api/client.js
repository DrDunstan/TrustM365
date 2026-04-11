import axios from 'axios'
const api = axios.create({ baseURL: '/api' })

export const tenantApi = {
  list:               ()          => api.get('/tenants').then(r => r.data),
  create:             (data)      => api.post('/tenants', data).then(r => r.data),
  remove:             (id)        => api.delete(`/tenants/${id}`).then(r => r.data),
  updateSettings:     (id, data)  => api.patch(`/tenants/${id}/settings`, data).then(r => r.data),
  updateMeta:         (id, data)  => api.patch(`/tenants/${id}/meta`, data).then(r => r.data),
  rotateCredentials:  (id, data)  => api.patch(`/tenants/${id}/credentials`, data).then(r => r.data),
  portfolio:          ()          => api.get('/tenants/portfolio').then(r => r.data),
  bulkSync:         ()          => api.post('/tenants/bulk-sync').then(r => r.data),
  bulkSyncStatus:   (id)        => api.get(`/tenants/bulk-sync/${id}`).then(r => r.data),
  exportDriftReport: (format = 'json') => api.get(`/tenants/export/drift-report?format=${format}`, {
    responseType: format === 'csv' ? 'blob' : 'json'
  }).then(r => r.data),
  getOverview:      (id)        => api.get(`/tenants/${id}/overview`).then(r => r.data),
  refreshOverview:  (id)        => api.post(`/tenants/${id}/overview/refresh`).then(r => r.data),
  getInsights:      (id)        => api.get(`/tenants/${id}/insights`).then(r => r.data),
  refreshInsights:  (id)        => api.post(`/tenants/${id}/insights`).then(r => r.data),
  checkPermissions: (body)      => api.post('/tenants/check-permissions', body).then(r => r.data),
  getPermissions:     (id)        => api.get(`/tenants/${id}/permissions`).then(r => r.data),
  refreshPermissions: (id)        => api.post(`/tenants/${id}/refresh-permissions`).then(r => r.data),
}

export const areaApi = {
  list:           (tenantId)                => api.get(`/areas/${tenantId}`).then(r => r.data),
  pull:           (tenantId, areaKey)       => api.post(`/areas/${tenantId}/${areaKey}/pull`).then(r => r.data),
  getLive:        (tenantId, areaKey)       => api.get(`/areas/${tenantId}/${areaKey}/live`).then(r => r.data),
  getBaseline:    (tenantId, areaKey)       => api.get(`/areas/${tenantId}/${areaKey}/baseline`).then(r => r.data),
  saveBaseline:   (tenantId, areaKey, data) => api.post(`/areas/${tenantId}/${areaKey}/baseline`, data).then(r => r.data),
  deleteBaseline: (tenantId, areaKey)       => api.delete(`/areas/${tenantId}/${areaKey}/baseline`).then(r => r.data),
  restoreBaseline: (tenantId, areaKey, historyId) =>
    api.post(`/areas/${tenantId}/${areaKey}/baseline/restore/${historyId}`).then(r => r.data),
  getDrift:       (tenantId, areaKey)       => api.get(`/areas/${tenantId}/${areaKey}/drift`).then(r => r.data),
  checkDrift:     (tenantId, areaKey)       => api.post(`/areas/${tenantId}/${areaKey}/drift`).then(r => r.data),
  setAutoRestore: (tenantId, areaKey, enabled) =>
    api.patch(`/areas/${tenantId}/${areaKey}/auto-restore`, { enabled }).then(r => r.data),
  restore:        (tenantId, areaKey, resourceId, propertyPath, restoreType) =>
    api.post(`/areas/${tenantId}/${areaKey}/restore`, { resourceId, propertyPath, restoreType }).then(r => r.data),
  getRestoreLog:  (tenantId, areaKey)       => api.get(`/areas/${tenantId}/${areaKey}/restore-log`).then(r => r.data),
  getHistory:     (tenantId, areaKey)       => api.get(`/areas/${tenantId}/${areaKey}/history`).then(r => r.data),
}

export const templateApi = {
  list:   (areaKey) => api.get(`/templates${areaKey ? `?areaKey=${areaKey}` : ''}`).then(r => r.data),
  get:    (id)      => api.get(`/templates/${id}`).then(r => r.data),
  create: (data)    => api.post('/templates', data).then(r => r.data),
  update: (id, data) => api.patch(`/templates/${id}`, data).then(r => r.data),
  remove: (id)      => api.delete(`/templates/${id}`).then(r => r.data),
  apply:  (id, tenantIds) => api.post(`/templates/${id}/apply`, { tenantIds }).then(r => r.data),
}

export const customCollectorApi = {
  list:       ()                         => api.get('/custom-collectors').then(r => r.data),
  create:     (data)                     => api.post('/custom-collectors', data).then(r => r.data),
  update:     (id, data)                 => api.patch(`/custom-collectors/${id}`, data).then(r => r.data),
  remove:     (id)                       => api.delete(`/custom-collectors/${id}`).then(r => r.data),
  testPull:   (data)                     => api.post('/custom-collectors/test-pull', data).then(r => r.data),
  deploy:     (id, tenantId)             => api.post(`/custom-collectors/${id}/deploy/${tenantId}`).then(r => r.data),
  undeploy:   (id, tenantId)             => api.delete(`/custom-collectors/${id}/deploy/${tenantId}`).then(r => r.data),
}

export const msspApi = {
  getSettings:    ()     => api.get('/mssp/settings').then(r => r.data),
  updateSettings: (data) => api.patch('/mssp/settings', data).then(r => r.data),
  uploadLogo: (file) => {
    const form = new FormData()
    form.append('logo', file)
    return api.post('/mssp/logo', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data)
  },
  deleteLogo:    () => api.delete('/mssp/logo').then(r => r.data),
  resetDefaults: () => api.post('/mssp/reset').then(r => r.data),
}

export const jobApi = {
  get: (id) => api.get(`/jobs/${id}`).then(r => r.data),
}

export const reportApi = {
  list:         (params = {}) => api.get('/reports', { params }).then(r => r.data),
  get:          (id)          => api.get(`/reports/${id}`).then(r => r.data),
  preview:      (body)        => api.post('/reports/preview', body).then(r => r.data),
  generate:     (body)        => api.post('/reports/generate', body).then(r => r.data),
  delete:       (id)          => api.delete(`/reports/${id}`).then(r => r.data),
  markRead:     ()            => api.post('/reports/mark-read').then(r => r.data),
  getSchedule:  (tenantId)    => api.get(`/reports/schedule/${tenantId}`).then(r => r.data),
  saveSchedule: (tenantId, body) => api.patch(`/reports/schedule/${tenantId}`, body).then(r => r.data),
  docxDownload: (id, title)   => {
    const url = `${api.defaults.baseURL}/reports/${id}/docx`;
    const a   = document.createElement('a');
    a.href     = url;
    a.download = `${(title || 'report').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.docx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  },
  // Baseline export
  baselineHistory:  (tenantId)        => api.get(`/reports/baseline-history/${tenantId}`).then(r => r.data),
  baselinePreview:  (body)            => api.post('/reports/baseline-preview', body).then(r => r.data),
  baselineGenerate: (body)            => api.post('/reports/baseline-generate', body).then(r => r.data),
  baselineDocx:     (reportId, title) => {
    const url = `${api.defaults.baseURL}/reports/baseline-docx/${reportId}`;
    const a   = document.createElement('a');
    a.href     = url;
    a.download = `${(title || 'baseline-export').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.docx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  },
}

export const webhookApi = {
  list:   ()         => api.get('/webhooks').then(r => r.data),
  create: (body)     => api.post('/webhooks', body).then(r => r.data),
  update: (id, body) => api.patch(`/webhooks/${id}`, body).then(r => r.data),
  delete: (id)       => api.delete(`/webhooks/${id}`).then(r => r.data),
  test:   (id)       => api.post(`/webhooks/${id}/test`).then(r => r.data),
}
