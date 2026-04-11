'use strict';
/**
 * Tests for the drift computation engine.
 * watchedKeys must be { path, label } objects — the format collectors produce.
 * resourceHashes must be computed with the engine's stableHash (via sha256).
 */

const { computeDrift } = require('../src/engine/drift');
const crypto = require('crypto');

// ── Helpers ───────────────────────────────────────────────────────────────────
function wk(...paths) {
  return paths.map(p => ({ path: p, label: p }));
}

// Match the engine's stableHash function for snapshot tests
const VOLATILE_KEYS = new Set(['createdDateTime','lastModifiedDateTime','modifiedDateTime','renewedDateTime','deletedDateTime','@odata.context','@odata.etag']);
function sortDeep(v) {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).sort(([a],[b]) => a.localeCompare(b)).map(([k,vv]) => [k, sortDeep(vv)]));
  return v;
}
function stableHash(resource) {
  const clean = Object.fromEntries(Object.entries(resource).filter(([k]) => !VOLATILE_KEYS.has(k)));
  return crypto.createHash('sha256').update(JSON.stringify(sortDeep(clean))).digest('hex').slice(0, 16);
}

function makeUser(overrides = {}) {
  return { id: 'user-1', displayName: 'Anto Porter', accountEnabled: true, department: 'Engineering', jobTitle: 'Engineer', userPrincipalName: 'anto@example.com', ...overrides };
}
function makePolicy(overrides = {}) {
  return { id: 'policy-1', displayName: 'MFA Policy', state: 'enabled', grantControls: { operator: 'OR', builtInControls: ['mfa'] }, ...overrides };
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('computeDrift — basic', () => {
  test('returns clean when live matches baseline exactly', () => {
    const user = makeUser();
    const result = computeDrift({ 'user-1': user }, { 'user-1': user }, wk('displayName','accountEnabled','department'), { 'user-1': 'properties' }, {});
    expect(result.status).toBe('clean');
    expect(result.driftCount).toBe(0);
    expect(result.summary[0].status).toBe('clean');
  });

  test('detects drift on a changed property', () => {
    const baseline = makeUser({ displayName: 'Anto Porter' });
    const live     = makeUser({ displayName: 'Anto Por' });
    const result = computeDrift({ 'user-1': live }, { 'user-1': baseline }, wk('displayName','accountEnabled','department'), { 'user-1': 'properties' }, {});
    expect(result.status).toBe('drifted');
    expect(result.driftCount).toBeGreaterThan(0);
    const d = result.summary[0].drifts.find(d => d.path === 'displayName');
    expect(d.baselineValue).toBe('Anto Porter');
    expect(d.liveValue).toBe('Anto Por');
  });

  test('detects multiple drifted properties on the same resource', () => {
    const baseline = makeUser({ department: 'Engineering', jobTitle: 'Engineer' });
    const live     = makeUser({ department: 'IT',          jobTitle: 'Consultant' });
    const result = computeDrift({ 'user-1': live }, { 'user-1': baseline }, wk('displayName','department','jobTitle'), { 'user-1': 'properties' }, {});
    expect(result.driftCount).toBeGreaterThanOrEqual(2);
    expect(result.summary[0].drifts.map(d => d.path)).toEqual(expect.arrayContaining(['department','jobTitle']));
  });

  test('marks resource as missing when absent from live data', () => {
    const result = computeDrift({}, { 'user-1': makeUser() }, wk('displayName'), { 'user-1': 'properties' }, {});
    expect(result.status).toBe('drifted');
    expect(result.summary[0].status).toBe('missing');
  });

  test('handles multiple resources — mixed clean and drifted', () => {
    const base1 = makeUser({ id: 'user-1', displayName: 'Alice' });
    const live1  = makeUser({ id: 'user-1', displayName: 'Alice' });
    const base2  = makeUser({ id: 'user-2', displayName: 'Bob', accountEnabled: true });
    const live2  = makeUser({ id: 'user-2', displayName: 'Bob', accountEnabled: false });
    const result = computeDrift(
      { 'user-1': live1, 'user-2': live2 },
      { 'user-1': base1, 'user-2': base2 },
      wk('displayName','accountEnabled'),
      { 'user-1': 'properties', 'user-2': 'properties' }, {}
    );
    expect(result.status).toBe('drifted');
    expect(result.summary.find(s => s.resourceId === 'user-1').status).toBe('clean');
    expect(result.summary.find(s => s.resourceId === 'user-2').status).toBe('drifted');
  });

  test('returns clean when all resources match', () => {
    const u1 = makeUser({ id: 'user-1' });
    const u2 = makeUser({ id: 'user-2', displayName: 'Bob' });
    const result = computeDrift({ 'user-1': u1, 'user-2': u2 }, { 'user-1': u1, 'user-2': u2 }, wk('displayName','accountEnabled'), { 'user-1': 'properties', 'user-2': 'properties' }, {});
    expect(result.status).toBe('clean');
    expect(result.driftCount).toBe(0);
  });

  test('ignores extra live fields not in watchedKeys', () => {
    const baseline = makeUser({ displayName: 'Anto Porter' });
    const live     = makeUser({ displayName: 'Anto Porter', unknownField: 'injected' });
    const result = computeDrift({ 'user-1': live }, { 'user-1': baseline }, wk('displayName','accountEnabled'), { 'user-1': 'properties' }, {});
    expect(result.status).toBe('clean');
  });

  test('snapshot mode clean when hash matches', () => {
    const baseline = makePolicy();
    const hash = stableHash(baseline);
    const result = computeDrift({ 'policy-1': baseline }, { 'policy-1': baseline }, [], { 'policy-1': 'snapshot' }, { 'policy-1': hash });
    expect(result.summary.find(s => s.resourceId === 'policy-1')?.status).toBe('clean');
  });

  test('snapshot mode detects drift when hash differs', () => {
    const baseline = makePolicy({ state: 'enabled' });
    const live     = makePolicy({ state: 'disabled' });
    const hash = stableHash(baseline);
    const result = computeDrift({ 'policy-1': live }, { 'policy-1': baseline }, [], { 'policy-1': 'snapshot' }, { 'policy-1': hash });
    expect(result.status).toBe('drifted');
  });

  test('resources in "none" mode are excluded from drift count', () => {
    const baseline = makeUser({ displayName: 'Anto Porter' });
    const live     = makeUser({ displayName: 'Different Name' });
    const result = computeDrift({ 'user-1': live }, { 'user-1': baseline }, wk('displayName'), { 'user-1': 'none' }, {});
    expect(result.status).toBe('clean');
    expect(result.driftCount).toBe(0);
  });

  test('returns clean with empty baseline and live', () => {
    const result = computeDrift({}, {}, [], {}, {});
    expect(result.status).toBe('clean');
    expect(result.driftCount).toBe(0);
  });
});
