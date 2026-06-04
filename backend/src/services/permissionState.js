const { getDb } = require('../database/init');

function persistPermissionState(tenantId, granted, areas, checkedAt = new Date().toISOString()) {
  const db = getDb();
  const payload = JSON.stringify({ granted, areas });

  db.prepare('UPDATE tenants SET permissions_json = ?, permissions_checked_at = ? WHERE id = ?')
    .run(payload, checkedAt, tenantId);

  const binding = db.prepare(`
    SELECT id
    FROM tenant_app_bindings
    WHERE tenant_id = ?
    ORDER BY is_primary DESC, created_at ASC
    LIMIT 1
  `).get(tenantId);

  if (binding?.id) {
    db.prepare(`
      UPDATE tenant_app_bindings
      SET permissions_json = ?, permissions_checked_at = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(payload, checkedAt, binding.id);
  }
}

module.exports = { persistPermissionState };
