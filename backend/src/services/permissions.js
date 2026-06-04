/**
 * Permission checker — given a valid token, reads the app role assignments
 * actually granted to this service principal and returns a permission map.
 *
 * Uses /servicePrincipals?$filter=appId eq '{clientId}' to find the SP,
 * then /servicePrincipals/{id}/appRoleAssignments to list granted app roles,
 * then resolves them against the Microsoft Graph SP's appRoles manifest.
 */

const { graphGetAll, graphGet } = require('./graph');

// The well-known Microsoft Graph application ID (constant across all tenants)
const GRAPH_APP_ID = '00000003-0000-0000-c000-000000000000';

// Cache the Graph SP's appRoles manifest per-tenant (keyed by tenant_id).
// The manifest is identical across tenants — it's Microsoft's own Graph API
// definition — but caching per-tenant prevents any risk of stale cross-tenant
// bleed if Microsoft ever updates the manifest between tenant registrations.
const graphRolesCacheByTenant = new Map();

async function getGraphRoles(token, tenantId) {
  if (tenantId && graphRolesCacheByTenant.has(tenantId)) {
    return graphRolesCacheByTenant.get(tenantId);
  }
  const results = await graphGetAll(token,
    `/servicePrincipals?$filter=appId eq '${GRAPH_APP_ID}'&$select=id,appRoles`
  );
  const sp = results[0];
  if (!sp) throw new Error('Could not find Microsoft Graph service principal');
  const roles = sp.appRoles || [];
  if (tenantId) graphRolesCacheByTenant.set(tenantId, roles);
  return roles;
}

/**
 * Returns an object mapping permission name → boolean (granted or not).
 * Also returns the raw list of granted permission names for display.
 *
 * @param {string} token    - Access token for the tenant
 * @param {string} clientId - Client ID of the app registration to inspect
 * @param {string} [tenantId] - Tenant ID for per-tenant role manifest caching
 */
async function checkGrantedPermissions(token, clientId, tenantId = null) {
  // Find this app's service principal in the tenant
  const spResults = await graphGetAll(token,
    `/servicePrincipals?$filter=appId eq '${clientId}'&$select=id,displayName`
  );
  const sp = spResults[0];
  if (!sp) {
    throw new Error(
      'App Registration not found in this tenant. ' +
      'Make sure the Client ID is correct and the app exists in this directory.'
    );
  }

  // Get all app role assignments (Application permissions) granted to this SP
  const assignments = await graphGetAll(token,
    `/servicePrincipals/${sp.id}/appRoleAssignments`
  );

  // Build a set of granted roleIds (these are GUIDs)
  const grantedRoleIds = new Set(
    assignments
      .filter(a => a.resourceId) // only assignments to Graph
      .map(a => a.appRoleId)
  );

  // Resolve roleIds → permission names using Graph's appRoles manifest
  // Cache is keyed per-tenant to prevent cross-tenant contamination
  const graphRoles = await getGraphRoles(token, tenantId);
  const roleIdToName = {};
  for (const role of graphRoles) {
    roleIdToName[role.id] = role.value; // e.g. "User.Read.All"
  }

  const grantedNames = new Set();
  for (const roleId of grantedRoleIds) {
    const name = roleIdToName[roleId];
    if (name) grantedNames.add(name);
  }

  // Normalize permission names by stripping trailing '.All' (legacy forms)
  const normalizePerm = (p) => (typeof p === 'string' && p.endsWith('.All') ? p.slice(0, -4) : p);

  const grantedNamesRaw = new Set();
  for (const roleId of grantedRoleIds) {
    const name = roleIdToName[roleId];
    if (name) grantedNamesRaw.add(name);
  }

  // Canonicalize granted permission names for consistent comparisons
  const canonicalGranted = new Set(Array.from(grantedNamesRaw).map(normalizePerm));

  return {
    granted: Array.from(canonicalGranted).sort(),
    has: (permissionName) => canonicalGranted.has(normalizePerm(permissionName))
  };
}

/**
 * Maps granted permissions onto each collector, returning their unlock state.
 *
 * Returns array of:
 * {
 *   areaKey, displayName, description, licenceRequired,
 *   canRead:  boolean,   // all readPermissions granted
 *   canWrite: boolean,   // all writePermissions granted
 *   canRestore: boolean, // write granted and collector supports restore
 *   restoreSupported: boolean,
 *   restoreReason: string | null,
 *   missingRead:  [],    // permissions needed to unlock sync
 *   missingWrite: [],    // permissions needed to unlock restore
 *   missingPermissions: [], // union of missingRead and missingWrite
 * }
 */
function buildAreaPermissionMap(granted, collectors) {
  // Normalize granted entries and expand ReadWrite → Read.
  const normalizePerm = (p) => (typeof p === 'string' && p.endsWith('.All') ? p.slice(0, -4) : p);
  const grantedSet = new Set((granted || []).map(normalizePerm));
  for (const p of Array.from(grantedSet)) {
    if (p.includes('ReadWrite')) {
      grantedSet.add(p.replace('ReadWrite', 'Read'));
    }
    if (p.endsWith('.ReadWrite')) {
      grantedSet.add(p.replace('.ReadWrite', '.Read'));
    }
  }
  const has = (p) => grantedSet.has(normalizePerm(p));

  return Object.values(collectors).map(c => {
    const missingRead  = (c.readPermissions  || []).filter(p => !has(p));
    const missingWrite = (c.writePermissions || []).filter(p => !has(p));
    const restoreSupported = c.restoreSupported !== false;
    const restoreReason = c.restoreReason || (restoreSupported ? null : 'Restore is not currently supported for this collector.');
    const canRead = missingRead.length === 0;
    const hasWritePermissions = missingWrite.length === 0;
    const missingPermissions = Array.from(new Set([...(missingRead || []), ...(missingWrite || [])]));
    return {
      areaKey:        c.areaKey,
      displayName:    c.displayName,
      description:    c.description,
      licenceRequired: c.licenceRequired || null,
      readPermissions:  c.readPermissions  || [],
      writePermissions: c.writePermissions || [],
      canRead,
      canWrite: hasWritePermissions,
      canRestore: restoreSupported && hasWritePermissions,
      restoreSupported,
      restoreReason,
      missingRead,
      missingWrite,
      missingPermissions,
    };
  });
}

module.exports = { checkGrantedPermissions, buildAreaPermissionMap };
