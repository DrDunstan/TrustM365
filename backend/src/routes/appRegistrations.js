const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { z } = require('zod');
const { getDb } = require('../database/init');
const { encrypt, decrypt } = require('../utils/encryption');
const { getAccessToken, evictClientsByClientId } = require('../services/auth');
const { checkGrantedPermissions, buildAreaPermissionMap } = require('../services/permissions');
const { COLLECTORS } = require('../collectors');
const { persistPermissionState } = require('../services/permissionState');
const logger = require('../utils/logger');

const router = express.Router();

const AppRegistrationSchema = z.object({
  displayName: z.string().min(1).max(120),
  clientId: z.string().uuid(),
  clientSecret: z.string().min(1),
  defaultAuthorityTenantId: z.string().uuid().optional(),
});

const UpdateAppRegistrationSchema = z.object({
  displayName: z.string().min(1).max(120).optional(),
  clientSecret: z.string().min(1).optional(),
  defaultAuthorityTenantId: z.string().uuid().optional(),
}).refine(v => Object.keys(v).length > 0, { message: 'At least one field is required' });

const BindingSchema = z.object({
  tenantId: z.string().uuid(),
  authorityTenantId: z.string().uuid().optional(),
  isPrimary: z.boolean().optional(),
  refreshPermissions: z.boolean().optional(),
});

function parseMetadata(meta) {
  if (!meta) return {};
  try { return JSON.parse(meta); } catch { return {}; }
}

function getDefaultAuthority(app) {
  const meta = parseMetadata(app.metadata);
  return meta.defaultAuthorityTenantId || null;
}

function syncTenantLegacyCredentialsFromApp(tenantId, appRegistrationId) {
  const db = getDb();
  const app = db.prepare('SELECT * FROM app_registrations WHERE id = ?').get(appRegistrationId);
  if (!app) return;
  db.prepare(`
    UPDATE tenants
    SET app_registration_id = ?,
        client_id = ?,
        client_secret_encrypted = ?
    WHERE id = ?
  `).run(app.id, app.client_id, app.client_secret_encrypted, tenantId);
}

async function maybeRefreshPermissionsForBinding(tenantId, app, authorityTenantId, shouldRefresh) {
  if (!shouldRefresh) return null;
  const token = await getAccessToken(authorityTenantId, app.client_id, decrypt(app.client_secret_encrypted));
  const { granted } = await checkGrantedPermissions(token, app.client_id, authorityTenantId);
  const areas = buildAreaPermissionMap(granted, COLLECTORS);
  persistPermissionState(tenantId, granted, areas);
  return { grantedCount: granted.length };
}

router.get('/', (req, res) => {
  const db = getDb();
  const apps = db.prepare(`
    SELECT ar.id, ar.display_name, ar.client_id, ar.auth_mode, ar.metadata, ar.created_at, ar.updated_at,
           COUNT(tab.id) AS tenant_count
    FROM app_registrations ar
    LEFT JOIN tenant_app_bindings tab ON tab.app_registration_id = ar.id
    GROUP BY ar.id
    ORDER BY ar.display_name
  `).all();

  const list = apps.map(app => {
    const bindings = db.prepare(`
      SELECT tab.tenant_id, tab.authority_tenant_id, tab.is_primary, tab.permissions_checked_at,
             t.display_name AS tenant_display_name, t.tenant_id AS tenant_uuid
      FROM tenant_app_bindings tab
      JOIN tenants t ON t.id = tab.tenant_id
      WHERE tab.app_registration_id = ?
      ORDER BY t.display_name
    `).all(app.id);

    return {
      ...app,
      metadata: parseMetadata(app.metadata),
      tenant_count: Number(app.tenant_count || 0),
      bindings,
    };
  });

  res.json(list);
});

router.post('/', async (req, res) => {
  const parsed = AppRegistrationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });

  const { displayName, clientId, clientSecret, defaultAuthorityTenantId } = parsed.data;
  const authorityTenantId = defaultAuthorityTenantId;

  try {
    if (authorityTenantId) {
      await getAccessToken(authorityTenantId, clientId, clientSecret);
    }
  } catch (err) {
    return res.status(400).json({ error: 'Credential validation failed', message: err.message });
  }

  const db = getDb();
  const id = uuidv4();
  const metadata = JSON.stringify({ defaultAuthorityTenantId: authorityTenantId || null });

  db.prepare(`
    INSERT INTO app_registrations (id, display_name, client_id, client_secret_encrypted, metadata)
    VALUES (?,?,?,?,?)
  `).run(id, displayName, clientId, encrypt(clientSecret), metadata);

  const row = db.prepare(`
    SELECT id, display_name, client_id, auth_mode, metadata, created_at, updated_at
    FROM app_registrations WHERE id = ?
  `).get(id);

  res.status(201).json({ ...row, metadata: parseMetadata(row.metadata), tenant_count: 0, bindings: [] });
});

router.patch('/:id', async (req, res) => {
  const parsed = UpdateAppRegistrationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });

  const db = getDb();
  const app = db.prepare('SELECT * FROM app_registrations WHERE id = ?').get(req.params.id);
  if (!app) return res.status(404).json({ error: 'App registration not found' });

  const nextDisplayName = parsed.data.displayName || app.display_name;
  const nextSecretEnc = parsed.data.clientSecret ? encrypt(parsed.data.clientSecret) : app.client_secret_encrypted;
  const currentMeta = parseMetadata(app.metadata);
  const nextMeta = {
    ...currentMeta,
    ...(parsed.data.defaultAuthorityTenantId ? { defaultAuthorityTenantId: parsed.data.defaultAuthorityTenantId } : {}),
  };

  const authorityForValidation = nextMeta.defaultAuthorityTenantId || null;
  if (parsed.data.clientSecret && authorityForValidation) {
    try {
      await getAccessToken(authorityForValidation, app.client_id, parsed.data.clientSecret);
    } catch (err) {
      return res.status(400).json({ error: 'Credential validation failed', message: err.message });
    }
  }

  db.prepare(`
    UPDATE app_registrations
    SET display_name = ?, client_secret_encrypted = ?, metadata = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(nextDisplayName, nextSecretEnc, JSON.stringify(nextMeta), app.id);

  const primaryBindings = db.prepare(`
    SELECT tenant_id FROM tenant_app_bindings
    WHERE app_registration_id = ? AND is_primary = 1
  `).all(app.id);
  for (const b of primaryBindings) {
    syncTenantLegacyCredentialsFromApp(b.tenant_id, app.id);
  }

  evictClientsByClientId(app.client_id);

  const updated = db.prepare(`
    SELECT id, display_name, client_id, auth_mode, metadata, created_at, updated_at
    FROM app_registrations WHERE id = ?
  `).get(app.id);

  res.json({ ...updated, metadata: parseMetadata(updated.metadata) });
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  const app = db.prepare('SELECT * FROM app_registrations WHERE id = ?').get(req.params.id);
  if (!app) return res.status(404).json({ error: 'App registration not found' });

  const bindingCount = db.prepare('SELECT COUNT(*) AS c FROM tenant_app_bindings WHERE app_registration_id = ?').get(app.id).c;
  if (bindingCount > 0) {
    return res.status(409).json({ error: 'App registration is bound to tenants. Remove bindings first.' });
  }

  db.prepare('DELETE FROM app_registrations WHERE id = ?').run(app.id);
  evictClientsByClientId(app.client_id);
  res.json({ message: 'App registration deleted' });
});

router.post('/:id/bindings', async (req, res) => {
  const parsed = BindingSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });

  const db = getDb();
  const app = db.prepare('SELECT * FROM app_registrations WHERE id = ?').get(req.params.id);
  if (!app) return res.status(404).json({ error: 'App registration not found' });

  const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(parsed.data.tenantId);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

  const authorityTenantId = parsed.data.authorityTenantId || getDefaultAuthority(app) || tenant.tenant_id;
  const isPrimary = parsed.data.isPrimary !== false;

  try {
    await getAccessToken(authorityTenantId, app.client_id, decrypt(app.client_secret_encrypted));
  } catch (err) {
    return res.status(400).json({ error: 'Credential validation failed for binding authority tenant', message: err.message });
  }

  const existing = db.prepare(`
    SELECT * FROM tenant_app_bindings
    WHERE tenant_id = ? AND app_registration_id = ?
  `).get(tenant.id, app.id);

  if (isPrimary) {
    db.prepare('UPDATE tenant_app_bindings SET is_primary = 0, updated_at = datetime(\'now\') WHERE tenant_id = ?')
      .run(tenant.id);
  }

  if (existing) {
    db.prepare(`
      UPDATE tenant_app_bindings
      SET authority_tenant_id = ?, is_primary = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(authorityTenantId, isPrimary ? 1 : existing.is_primary, existing.id);
  } else {
    db.prepare(`
      INSERT INTO tenant_app_bindings (id, tenant_id, app_registration_id, authority_tenant_id, is_primary)
      VALUES (?,?,?,?,?)
    `).run(uuidv4(), tenant.id, app.id, authorityTenantId, isPrimary ? 1 : 0);
  }

  if (isPrimary) {
    syncTenantLegacyCredentialsFromApp(tenant.id, app.id);
  }

  let permissionInfo = null;
  try {
    permissionInfo = await maybeRefreshPermissionsForBinding(
      tenant.id,
      app,
      authorityTenantId,
      parsed.data.refreshPermissions === true
    );
  } catch (err) {
    logger.warn({ err, tenantId: tenant.id, appRegistrationId: app.id }, 'Permissions refresh after binding failed');
  }

  res.status(existing ? 200 : 201).json({
    message: existing ? 'Binding updated' : 'Binding created',
    tenantId: tenant.id,
    appRegistrationId: app.id,
    authorityTenantId,
    isPrimary,
    permissions: permissionInfo,
  });
});

router.delete('/:id/bindings/:tenantId', (req, res) => {
  const db = getDb();
  const app = db.prepare('SELECT * FROM app_registrations WHERE id = ?').get(req.params.id);
  if (!app) return res.status(404).json({ error: 'App registration not found' });

  const binding = db.prepare(`
    SELECT * FROM tenant_app_bindings
    WHERE app_registration_id = ? AND tenant_id = ?
  `).get(app.id, req.params.tenantId);
  if (!binding) return res.status(404).json({ error: 'Binding not found' });

  db.prepare('DELETE FROM tenant_app_bindings WHERE id = ?').run(binding.id);

  const nextPrimary = db.prepare(`
    SELECT * FROM tenant_app_bindings
    WHERE tenant_id = ?
    ORDER BY is_primary DESC, created_at ASC
    LIMIT 1
  `).get(req.params.tenantId);

  if (nextPrimary) {
    db.prepare('UPDATE tenant_app_bindings SET is_primary = 1, updated_at = datetime(\'now\') WHERE id = ?')
      .run(nextPrimary.id);
    syncTenantLegacyCredentialsFromApp(req.params.tenantId, nextPrimary.app_registration_id);
  } else {
    db.prepare('UPDATE tenants SET app_registration_id = NULL WHERE id = ?').run(req.params.tenantId);
  }

  res.json({ message: 'Binding removed' });
});

router.post('/:id/bindings/:tenantId/primary', (req, res) => {
  const db = getDb();
  const app = db.prepare('SELECT * FROM app_registrations WHERE id = ?').get(req.params.id);
  if (!app) return res.status(404).json({ error: 'App registration not found' });

  const binding = db.prepare(`
    SELECT * FROM tenant_app_bindings
    WHERE app_registration_id = ? AND tenant_id = ?
  `).get(app.id, req.params.tenantId);
  if (!binding) return res.status(404).json({ error: 'Binding not found' });

  db.prepare('UPDATE tenant_app_bindings SET is_primary = 0, updated_at = datetime(\'now\') WHERE tenant_id = ?')
    .run(req.params.tenantId);
  db.prepare('UPDATE tenant_app_bindings SET is_primary = 1, updated_at = datetime(\'now\') WHERE id = ?')
    .run(binding.id);

  syncTenantLegacyCredentialsFromApp(req.params.tenantId, app.id);
  res.json({ message: 'Primary binding updated' });
});

router.post('/:id/bindings/:tenantId/refresh-permissions', async (req, res) => {
  const db = getDb();
  const app = db.prepare('SELECT * FROM app_registrations WHERE id = ?').get(req.params.id);
  if (!app) return res.status(404).json({ error: 'App registration not found' });

  const binding = db.prepare(`
    SELECT * FROM tenant_app_bindings
    WHERE app_registration_id = ? AND tenant_id = ?
  `).get(app.id, req.params.tenantId);
  if (!binding) return res.status(404).json({ error: 'Binding not found' });

  try {
    const token = await getAccessToken(binding.authority_tenant_id, app.client_id, decrypt(app.client_secret_encrypted));
    const { granted } = await checkGrantedPermissions(token, app.client_id, binding.authority_tenant_id);
    const areas = buildAreaPermissionMap(granted, COLLECTORS);
    persistPermissionState(req.params.tenantId, granted, areas);

    res.json({
      granted,
      areas,
      message: `${granted.length} permission${granted.length !== 1 ? 's' : ''} found`,
    });
  } catch (err) {
    logger.error({ err, appRegistrationId: app.id, tenantId: req.params.tenantId }, 'Binding permission refresh failed');
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
