'use strict';
/**
 * Tests for assembler-level logic — event deduplication, outstanding
 * computation, and the effectiveStatus (drifted+0 = clean) rule that
 * prevents stale post-restore rows from surfacing as false positives.
 *
 * All tests use in-memory logic isolated from the DB — they test the
 * pure functions extracted from assembler.js.
 */

// ── effectiveStatus — the core guard ─────────────────────────────────────────
function effectiveStatus(status, driftCount) {
  if (status === 'drifted' && (driftCount || 0) === 0) return 'clean';
  return status;
}

describe('effectiveStatus', () => {
  test('returns clean when status=drifted and driftCount=0 (post-auto-restore edge case)', () => {
    expect(effectiveStatus('drifted', 0)).toBe('clean');
  });

  test('returns drifted when status=drifted and driftCount>0', () => {
    expect(effectiveStatus('drifted', 3)).toBe('drifted');
  });

  test('returns clean when status=clean', () => {
    expect(effectiveStatus('clean', 0)).toBe('clean');
  });

  test('returns clean when status=clean and driftCount is null', () => {
    expect(effectiveStatus('clean', null)).toBe('clean');
  });

  test('treats null driftCount as 0', () => {
    expect(effectiveStatus('drifted', null)).toBe('clean');
  });

  test('treats undefined driftCount as 0', () => {
    expect(effectiveStatus('drifted', undefined)).toBe('clean');
  });

  test('returns unavailable passthrough', () => {
    expect(effectiveStatus('unavailable', 0)).toBe('unavailable');
  });
});

// ── Drift event deduplication ─────────────────────────────────────────────────
// Mirrors the logic in assembler.js: dedup by area_key, take first detection.
function deduplicateDriftRows(rows) {
  const seenAreas = new Set();
  const events = [];
  for (const r of rows) {
    if (r.status !== 'drifted' || (r.drift_count || 0) === 0) continue;
    if (seenAreas.has(r.area_key)) continue;
    seenAreas.add(r.area_key);
    events.push(r);
  }
  return events;
}

describe('drift event deduplication', () => {
  const makeRow = (area_key, status, drift_count, checked_at) => ({
    area_key, status, drift_count, checked_at
  });

  test('counts each area once even with multiple drift rows', () => {
    const rows = [
      makeRow('entra_users', 'drifted', 3, '2026-03-20T04:53:00Z'),
      makeRow('entra_users', 'drifted', 3, '2026-03-20T04:54:00Z'), // second sync
      makeRow('entra_users', 'drifted', 3, '2026-03-20T04:59:00Z'), // third sync
    ];
    const events = deduplicateDriftRows(rows);
    expect(events).toHaveLength(1);
    expect(events[0].checked_at).toBe('2026-03-20T04:53:00Z'); // first detection
  });

  test('counts distinct areas separately', () => {
    const rows = [
      makeRow('entra_users',  'drifted', 3, '2026-03-20T04:53:00Z'),
      makeRow('entra_groups', 'drifted', 1, '2026-03-20T04:53:00Z'),
    ];
    const events = deduplicateDriftRows(rows);
    expect(events).toHaveLength(2);
  });

  test('skips clean rows', () => {
    const rows = [
      makeRow('entra_users', 'clean',   0, '2026-03-20T05:00:00Z'),
      makeRow('entra_users', 'drifted', 3, '2026-03-20T04:53:00Z'),
    ];
    const events = deduplicateDriftRows(rows);
    // Only the drifted row counts; clean rows are skipped
    expect(events).toHaveLength(1);
  });

  test('skips drifted rows with drift_count=0 (post-restore ghost rows)', () => {
    const rows = [
      makeRow('entra_users', 'drifted', 0, '2026-03-20T05:05:00Z'), // ghost
    ];
    const events = deduplicateDriftRows(rows);
    expect(events).toHaveLength(0);
  });

  test('returns empty for empty input', () => {
    expect(deduplicateDriftRows([])).toHaveLength(0);
  });

  test('handles mixed areas with some having only ghost rows', () => {
    const rows = [
      makeRow('entra_users',  'drifted', 3, '2026-03-20T04:53:00Z'),
      makeRow('entra_users',  'drifted', 0, '2026-03-20T05:05:00Z'), // ghost after restore
      makeRow('entra_groups', 'drifted', 0, '2026-03-20T04:53:00Z'), // only a ghost — not counted
    ];
    const events = deduplicateDriftRows(rows);
    expect(events).toHaveLength(1);
    expect(events[0].area_key).toBe('entra_users');
  });
});

// ── Outstanding computation ───────────────────────────────────────────────────
// Mirrors assembler logic: count areas that had drift events AND are currently still drifted.
function computeOutstandingFromState(driftedAreaKeys, latestStateByArea) {
  let count = 0;
  for (const key of driftedAreaKeys) {
    const latest = latestStateByArea[key];
    if (!latest) continue;
    if (effectiveStatus(latest.status, latest.drift_count) === 'drifted') count++;
  }
  return count;
}

describe('outstanding computation', () => {
  test('returns 0 when all drifted areas are now clean', () => {
    const driftedKeys = ['entra_users'];
    const latestState = { 'entra_users': { status: 'clean', drift_count: 0 } };
    expect(computeOutstandingFromState(driftedKeys, latestState)).toBe(0);
  });

  test('returns 1 when one area is still genuinely drifted', () => {
    const driftedKeys = ['entra_users'];
    const latestState = { 'entra_users': { status: 'drifted', drift_count: 2 } };
    expect(computeOutstandingFromState(driftedKeys, latestState)).toBe(1);
  });

  test('returns 0 when area has drifted+0 (post-restore ghost)', () => {
    const driftedKeys = ['entra_users'];
    const latestState = { 'entra_users': { status: 'drifted', drift_count: 0 } };
    expect(computeOutstandingFromState(driftedKeys, latestState)).toBe(0);
  });

  test('counts correctly across multiple areas', () => {
    const driftedKeys = ['entra_users', 'entra_ca', 'entra_groups'];
    const latestState = {
      'entra_users':  { status: 'clean',   drift_count: 0 }, // resolved
      'entra_ca':     { status: 'drifted', drift_count: 1 }, // still outstanding
      'entra_groups': { status: 'drifted', drift_count: 0 }, // ghost — resolved
    };
    expect(computeOutstandingFromState(driftedKeys, latestState)).toBe(1);
  });

  test('returns 0 for empty input', () => {
    expect(computeOutstandingFromState([], {})).toBe(0);
  });
});

// ── Portfolio overallStatus ───────────────────────────────────────────────────
function computeOverallStatus(areas) {
  const driftedCount = areas.filter(a =>
    a.drift?.status === 'drifted' && (a.drift?.drift_count || 0) > 0
  ).length;
  const baselined = areas.filter(a => a.hasBaseline).length;
  const baselinedClean = areas.filter(a =>
    a.hasBaseline && (
      a.drift?.status === 'clean' ||
      (a.drift?.status === 'drifted' && (a.drift?.drift_count || 0) === 0)
    )
  ).length;
  if (driftedCount > 0)              return 'drifted';
  if (baselined === 0)               return 'unconfigured';
  if (baselinedClean === baselined)  return 'clean';
  return 'partial';
}

describe('portfolio overallStatus', () => {
  test('returns clean when all baselined areas are clean', () => {
    const areas = [
      { hasBaseline: true,  drift: { status: 'clean',   drift_count: 0 } },
      { hasBaseline: false, drift: null }, // unmonitored — neutral
      { hasBaseline: false, drift: null },
    ];
    expect(computeOverallStatus(areas)).toBe('clean');
  });

  test('returns drifted when any baselined area has genuine drift', () => {
    const areas = [
      { hasBaseline: true, drift: { status: 'drifted', drift_count: 2 } },
      { hasBaseline: true, drift: { status: 'clean',   drift_count: 0 } },
    ];
    expect(computeOverallStatus(areas)).toBe('drifted');
  });

  test('returns clean when all areas have drifted+0 (post-restore)', () => {
    const areas = [
      { hasBaseline: true, drift: { status: 'drifted', drift_count: 0 } },
    ];
    expect(computeOverallStatus(areas)).toBe('clean');
  });

  test('returns unconfigured when nothing has a baseline', () => {
    const areas = [
      { hasBaseline: false, drift: null },
      { hasBaseline: false, drift: null },
    ];
    expect(computeOverallStatus(areas)).toBe('unconfigured');
  });

  test('unmonitored areas do not drag status to partial', () => {
    // 1 baselined+clean, 15 unmonitored — should be clean not partial
    const areas = [
      { hasBaseline: true,  drift: { status: 'clean', drift_count: 0 } },
      ...Array(15).fill({ hasBaseline: false, drift: null }),
    ];
    expect(computeOverallStatus(areas)).toBe('clean');
  });

  test('returns partial when some baselined areas have no data yet', () => {
    const areas = [
      { hasBaseline: true, drift: { status: 'clean', drift_count: 0 } },
      { hasBaseline: true, drift: null }, // not yet checked
    ];
    expect(computeOverallStatus(areas)).toBe('partial');
  });
});
