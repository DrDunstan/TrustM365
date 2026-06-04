const { getDb } = require('../database/init');
const { decrypt, encrypt } = require('../utils/encryption');

function getPrimaryBinding(tenantId, appRegistrationId = null) {
  const db = getDb();
  if (appRegistrationId) {
    return db.prepare(`
      SELECT * FROM tenant_app_bindings
      WHERE tenant_id = ? AND app_registration_id = ?
      ORDER BY is_primary DESC, created_at ASC
      LIMIT 1
    `).get(tenantId, appRegistrationId);
  }
  return db.prepare(`
    SELECT * FROM tenant_app_bindings
    WHERE tenant_id = ?
    ORDER BY is_primary DESC, created_at ASC
    LIMIT 1
  `).get(tenantId);
}

function ensureTenantAppBinding(tenant) {
  const db = getDb();

  // If already linked, make sure binding exists.
  if (tenant.app_registration_id) {
    const existingBinding = getPrimaryBinding(tenant.id, tenant.app_registration_id);
    if (existingBinding) return { appRegistrationId: tenant.app_registration_id, bindingId: existingBinding.id };

    db.prepare(`
      INSERT INTO tenant_app_bindings (id, tenant_id, app_registration_id, authority_tenant_id, is_primary)
      VALUES (?,?,?,?,1)
    `).run(require('crypto').randomUUID(), tenant.id, tenant.app_registration_id, tenant.tenant_id);

    const bound = getPrimaryBinding(tenant.id, tenant.app_registration_id);
    return { appRegistrationId: tenant.app_registration_id, bindingId: bound?.id || null };
  }

  const appRegistrationId = require('crypto').randomUUID();
  db.prepare(`
    INSERT INTO app_registrations (id, display_name, client_id, client_secret_encrypted)
    VALUES (?,?,?,?)
  `).run(
    appRegistrationId,
    `${tenant.display_name || tenant.tenant_id} App Registration`,
    tenant.client_id,
    tenant.client_secret_encrypted
  );

  const bindingId = require('crypto').randomUUID();
  db.prepare(`
    INSERT INTO tenant_app_bindings (id, tenant_id, app_registration_id, authority_tenant_id, is_primary)
    VALUES (?,?,?,?,1)
  `).run(bindingId, tenant.id, appRegistrationId, tenant.tenant_id);

  db.prepare('UPDATE tenants SET app_registration_id = ? WHERE id = ?').run(appRegistrationId, tenant.id);
  return { appRegistrationId, bindingId };
}

function resolveTenantAuthContext(tenantDbId) {
  const db = getDb();
  const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantDbId);
  if (!tenant) throw new Error('Tenant not found');

  // Compatibility-first: ensure migrated linkage exists, then resolve from shared auth tables.
  if (!tenant.app_registration_id) {
    ensureTenantAppBinding(tenant);
    tenant.app_registration_id = db.prepare('SELECT app_registration_id FROM tenants WHERE id = ?').get(tenant.id)?.app_registration_id || null;
  }

  const binding = getPrimaryBinding(tenant.id, tenant.app_registration_id);
  if (binding) {
    const app = db.prepare('SELECT * FROM app_registrations WHERE id = ?').get(binding.app_registration_id);
    if (app?.client_id && app?.client_secret_encrypted) {
      return {
        tenant,
        binding,
        appRegistration: app,
        authorityTenantId: binding.authority_tenant_id || tenant.tenant_id,
        clientId: app.client_id,
        clientSecret: decrypt(app.client_secret_encrypted),
      };
    }
  }

  // Legacy fallback: tenant-owned credentials.
  return {
    tenant,
    binding: null,
    appRegistration: null,
    authorityTenantId: tenant.tenant_id,
    clientId: tenant.client_id,
    clientSecret: decrypt(tenant.client_secret_encrypted),
  };
}

function rotateTenantAuthSecret(tenantDbId, plainClientSecret) {
  const db = getDb();
  const ctx = resolveTenantAuthContext(tenantDbId);
  const enc = encrypt(plainClientSecret);

  if (ctx.appRegistration?.id) {
    db.prepare(`
      UPDATE app_registrations
      SET client_secret_encrypted = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(enc, ctx.appRegistration.id);
  }

  // Keep tenant legacy column in sync during compatibility period.
  db.prepare(`
    UPDATE tenants
    SET client_secret_encrypted = ?,
        last_sync_error = NULL,
        last_sync_error_at = NULL
    WHERE id = ?
  `).run(enc, tenantDbId);

  return ctx;
}

module.exports = {
  resolveTenantAuthContext,
  rotateTenantAuthSecret,
  ensureTenantAppBinding,
};
