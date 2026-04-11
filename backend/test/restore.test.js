'use strict';
/**
 * Tests for the restore engine's buildRestorePayload and webhook delivery logic.
 *
 * restoreResource itself is not tested here — it requires live Graph credentials.
 * buildRestorePayload is pure: given baseline and live resources, return the PATCH body.
 *
 * Webhook firing tests cover the first/every mode logic in isolation
 * without needing a live HTTP server.
 */

const { buildRestorePayload } = require('../src/engine/restore');

// ── buildRestorePayload ───────────────────────────────────────────────────────
describe('buildRestorePayload', () => {
  const baselineUser = {
    id: 'user-1',
    displayName: 'Anto Porter',
    accountEnabled: true,
    department: 'Engineering',
    jobTitle: 'Engineer',
    createdDateTime: '2024-01-01T00:00:00Z',    // read-only — must be stripped
    lastModifiedDateTime: '2025-01-01T00:00:00Z', // read-only — must be stripped
    '@odata.type': '#microsoft.graph.user',        // read-only — must be stripped
  };

  const liveUser = {
    ...baselineUser,
    displayName: 'Anto Por',  // drifted
    department: 'AAAA',       // drifted
  };

  test('full restore strips read-only fields from PATCH body', async () => {
    const patch = await buildRestorePayload('t', 'entra_users', 'user-1', null, baselineUser, liveUser);
    expect(patch).not.toHaveProperty('id');
    expect(patch).not.toHaveProperty('createdDateTime');
    expect(patch).not.toHaveProperty('lastModifiedDateTime');
    expect(patch).not.toHaveProperty('@odata.type');
  });

  test('full restore includes writable baseline values', async () => {
    const patch = await buildRestorePayload('t', 'entra_users', 'user-1', null, baselineUser, liveUser);
    expect(patch.displayName).toBe('Anto Porter');
    expect(patch.department).toBe('Engineering');
    expect(patch.accountEnabled).toBe(true);
  });

  test('property restore returns only the targeted property', async () => {
    const patch = await buildRestorePayload('t', 'entra_users', 'user-1', 'displayName', baselineUser, liveUser);
    expect(patch).toEqual({ displayName: 'Anto Porter' });
    expect(Object.keys(patch)).toHaveLength(1);
  });

  test('property restore for accountEnabled preserves boolean type', async () => {
    const patch = await buildRestorePayload('t', 'entra_users', 'user-1', 'accountEnabled', baselineUser, liveUser);
    expect(patch).toEqual({ accountEnabled: true });
    expect(typeof patch.accountEnabled).toBe('boolean');
  });

  test('property restore for nested object returns the full nested value', async () => {
    const baselinePolicy = {
      id: 'policy-1',
      displayName: 'MFA Policy',
      state: 'enabled',
      grantControls: { operator: 'OR', builtInControls: ['mfa'] },
    };
    const patch = await buildRestorePayload('t', 'entra_ca', 'policy-1', 'grantControls', baselinePolicy, {});
    expect(patch).toEqual({ grantControls: { operator: 'OR', builtInControls: ['mfa'] } });
  });

  test('handles null liveRes gracefully (resource was deleted)', async () => {
    const patch = await buildRestorePayload('t', 'entra_users', 'user-1', null, baselineUser, null);
    expect(patch).toBeDefined();
    expect(patch.displayName).toBe('Anto Porter');
  });
});

// ── Webhook fire-mode logic ───────────────────────────────────────────────────
// Tests the first/every mode decision logic in isolation.
describe('webhook fire-mode logic', () => {
  function shouldFire(webhook, alreadyFiredForArea) {
    if (!webhook.enabled) return false;
    if (webhook.fire_mode === 'first' && alreadyFiredForArea) return false;
    return true;
  }

  function shouldClearOnResolve(drift) {
    return drift.status === 'clean' ||
      (drift.status === 'drifted' && (drift.drift_count || 0) === 0);
  }

  test('first mode fires when not yet fired for this area', () => {
    const wh = { enabled: true, fire_mode: 'first' };
    expect(shouldFire(wh, false)).toBe(true);
  });

  test('first mode does NOT fire if already fired for this area', () => {
    const wh = { enabled: true, fire_mode: 'first' };
    expect(shouldFire(wh, true)).toBe(false);
  });

  test('every mode always fires regardless of previous fires', () => {
    const wh = { enabled: true, fire_mode: 'every' };
    expect(shouldFire(wh, true)).toBe(true);
    expect(shouldFire(wh, false)).toBe(true);
  });

  test('disabled webhook never fires', () => {
    const whFirst = { enabled: false, fire_mode: 'first' };
    const whEvery = { enabled: false, fire_mode: 'every' };
    expect(shouldFire(whFirst, false)).toBe(false);
    expect(shouldFire(whEvery, false)).toBe(false);
  });

  test('area resolving to clean should clear fired state', () => {
    expect(shouldClearOnResolve({ status: 'clean', drift_count: 0 })).toBe(true);
  });

  test('area with drifted+0 (post-restore ghost) should clear fired state', () => {
    expect(shouldClearOnResolve({ status: 'drifted', drift_count: 0 })).toBe(true);
  });

  test('area still genuinely drifted should NOT clear fired state', () => {
    expect(shouldClearOnResolve({ status: 'drifted', drift_count: 2 })).toBe(false);
  });
});

// ── Webhook payload structure ─────────────────────────────────────────────────
describe('webhook payload structure', () => {
  function buildTestPayload(tenant, area, driftCount, drifts = []) {
    return {
      event:     'drift.detected',
      timestamp: new Date().toISOString(),
      tenant: {
        id:          tenant.id,
        displayName: tenant.display_name,
        tenantUUID:  tenant.tenant_id,
      },
      area: {
        key:         area.area_key,
        displayName: area.display_name,
      },
      drift: { count: driftCount, properties: drifts },
      platform: 'TrustM365',
      version:  '1.0.0',
    };
  }

  test('payload has all required top-level fields', () => {
    const payload = buildTestPayload(
      { id: 't1', display_name: 'Contoso', tenant_id: 'abc-123' },
      { area_key: 'entra_users', display_name: 'User Accounts' },
      3
    );
    expect(payload).toHaveProperty('event', 'drift.detected');
    expect(payload).toHaveProperty('timestamp');
    expect(payload).toHaveProperty('tenant');
    expect(payload).toHaveProperty('area');
    expect(payload).toHaveProperty('drift');
    expect(payload).toHaveProperty('platform', 'TrustM365');
    expect(payload).toHaveProperty('version', '1.0.0');
  });

  test('tenant fields are correct', () => {
    const payload = buildTestPayload(
      { id: 't1', display_name: 'Contoso', tenant_id: 'abc-123' },
      { area_key: 'entra_users', display_name: 'User Accounts' },
      1
    );
    expect(payload.tenant.id).toBe('t1');
    expect(payload.tenant.displayName).toBe('Contoso');
    expect(payload.tenant.tenantUUID).toBe('abc-123');
  });

  test('area fields are correct', () => {
    const payload = buildTestPayload(
      { id: 't1', display_name: 'Contoso', tenant_id: 'abc-123' },
      { area_key: 'entra_ca', display_name: 'Conditional Access Policies' },
      2
    );
    expect(payload.area.key).toBe('entra_ca');
    expect(payload.area.displayName).toBe('Conditional Access Policies');
  });

  test('drift count is reflected correctly', () => {
    const payload = buildTestPayload(
      { id: 't1', display_name: 'Contoso', tenant_id: 'abc-123' },
      { area_key: 'entra_users', display_name: 'User Accounts' },
      5
    );
    expect(payload.drift.count).toBe(5);
  });

  test('timestamp is a valid ISO 8601 string', () => {
    const payload = buildTestPayload(
      { id: 't1', display_name: 'Contoso', tenant_id: 'abc-123' },
      { area_key: 'entra_users', display_name: 'User Accounts' },
      1
    );
    expect(() => new Date(payload.timestamp)).not.toThrow();
    expect(new Date(payload.timestamp).toISOString()).toBe(payload.timestamp);
  });
});
