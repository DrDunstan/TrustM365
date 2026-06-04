// Helpers for permission mapping used by the frontend
export function applyImpliedRead(areas, granted) {
  if (!granted || !granted.length) return areas;
  const normalizePerm = (p) => (typeof p === 'string' && p.endsWith('.All') ? p.slice(0, -4) : p);
  const grantedSet = new Set((granted || []).map(normalizePerm));
  for (const p of Array.from(grantedSet)) {
    if (p.includes('ReadWrite')) grantedSet.add(p.replace('ReadWrite', 'Read'));
    if (p.endsWith('.ReadWrite')) grantedSet.add(p.replace('.ReadWrite', '.Read'));
  }
  return areas.map(a => {
    const missingRead = (a.readPermissions || []).filter(p => !grantedSet.has(normalizePerm(p)));
    const missingWrite = (a.writePermissions || []).filter(p => !grantedSet.has(normalizePerm(p)));
    const missingPermissions = Array.from(new Set([...(missingRead || []), ...(missingWrite || [])]));
    return {
      ...a,
      canRead: missingRead.length === 0,
      canWrite: missingWrite.length === 0,
      missingRead,
      missingWrite,
      missingPermissions,
    };
  });
}

export default { applyImpliedRead }
