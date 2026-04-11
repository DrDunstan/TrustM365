/**
 * Overview collector — tenant-level stats for the Dashboard summary panel.
 * All endpoints available on Entra ID Free except Intune managed devices.
 * Device registration data (Registered / Joined / Hybrid) uses the
 * /devices endpoint which is available on all licence tiers.
 */

const { graphGet, graphGetAll } = require('../services/graph');

async function fetchTenantOverview(token) {
  const results = {
    fetchedAt: new Date().toISOString(),
    users:   null,
    groups:  null,
    apps:    null,
    admins:  null,
    devices: null,
    errors:  []
  };

  // ── Users ──────────────────────────────────────────────────────────────────
  try {
    const all = await graphGetAll(token, '/users?$select=id,accountEnabled,userType');
    const total    = all.length;
    const guests   = all.filter(u => u.userType === 'Guest').length;
    const disabled = all.filter(u => u.accountEnabled === false).length;
    const active   = total - disabled - guests;
    results.users  = { total, active, guests, disabled };
  } catch (err) {
    results.errors.push({ section: 'users', message: err.message });
  }

  // ── Groups ─────────────────────────────────────────────────────────────────
  try {
    const groups = await graphGetAll(token, '/groups?$select=id,groupTypes,securityEnabled,mailEnabled');
    const m365              = groups.filter(g => (g.groupTypes || []).includes('Unified')).length;
    // Security group: securityEnabled=true, not M365, not mail-enabled
    const security          = groups.filter(g =>
      g.securityEnabled && !(g.groupTypes || []).includes('Unified') && !g.mailEnabled
    ).length;
    // Mail-enabled security: securityEnabled=true AND mailEnabled=true, not M365
    const mailEnabledSecurity = groups.filter(g =>
      g.securityEnabled && g.mailEnabled && !(g.groupTypes || []).includes('Unified')
    ).length;
    // Distribution: mailEnabled=true, NOT securityEnabled, not M365
    const distribution      = groups.filter(g =>
      g.mailEnabled && !g.securityEnabled && !(g.groupTypes || []).includes('Unified')
    ).length;
    // Dynamic membership flag (cross-cutting — reported separately)
    const dynamic           = groups.filter(g => (g.groupTypes || []).includes('DynamicMembership')).length;
    results.groups = { total: groups.length, m365, security, mailEnabledSecurity, distribution, dynamic };
  } catch (err) {
    results.errors.push({ section: 'groups', message: err.message });
  }

  // ── App Registrations ──────────────────────────────────────────────────────
  try {
    const apps = await graphGetAll(token,
      '/applications?$select=id,passwordCredentials,keyCredentials'
    );
    const now       = new Date();
    const soon      = new Date(now.getTime() + 30 * 86400000);
    let expired = 0, expiringSoon = 0;
    for (const app of apps) {
      const creds = [...(app.passwordCredentials || []), ...(app.keyCredentials || [])];
      for (const c of creds) {
        if (!c.endDateTime) continue;
        const exp = new Date(c.endDateTime);
        if (exp < now) expired++;
        else if (exp < soon) expiringSoon++;
      }
    }
    results.apps = { total: apps.length, expired, expiringSoon };
  } catch (err) {
    results.errors.push({ section: 'apps', message: err.message });
  }

  // ── Admin Role Assignments ─────────────────────────────────────────────────
  try {
    const assignments = await graphGetAll(token,
      '/roleManagement/directory/roleAssignments?$select=id,principalId'
    );
    const uniquePrincipals = new Set(assignments.map(a => a.principalId));
    results.admins = {
      total: assignments.length,
      uniquePrincipals: uniquePrincipals.size
    };
  } catch (err) {
    results.errors.push({ section: 'admins', message: err.message });
  }

  // ── Devices — Entra registered/joined/hybrid (no Intune needed) ───────────
  // trustType:
  //   null / undefined     → Azure AD Registered (personal BYOD)
  //   "AzureAd"            → Azure AD Joined (cloud-native)
  //   "ServerAd"           → Hybrid Azure AD Joined (on-prem + cloud)
  //   "Workplace"          → Workplace Registered (legacy)
  try {
    const devices = await graphGetAll(token,
      '/devices?$select=id,trustType,operatingSystem,isCompliant,isManaged'
    );

    let registered = 0, joined = 0, hybrid = 0, workplace = 0;
    let compliant = 0, managed = 0;

    for (const d of devices) {
      if (d.isCompliant) compliant++;
      if (d.isManaged)   managed++;
      switch (d.trustType) {
        case 'AzureAd':    joined++;     break;
        case 'ServerAd':   hybrid++;     break;
        case 'Workplace':  workplace++;  break;
        default:           registered++; break;  // null = Registered
      }
    }

    // OS breakdown (top platforms only)
    const byOS = devices.reduce((acc, d) => {
      const os = d.operatingSystem || 'Unknown';
      acc[os] = (acc[os] || 0) + 1;
      return acc;
    }, {});

    results.devices = {
      total: devices.length,
      registered,   // BYOD / personal registered
      joined,        // AAD Joined (cloud-native corporate)
      hybrid,        // Hybrid AAD Joined (on-prem synced)
      workplace,     // Workplace registered (legacy, usually 0)
      compliant,
      managed,
      byOS
    };
  } catch (err) {
    results.errors.push({ section: 'devices', message: err.message });
  }

  return results;
}

module.exports = { fetchTenantOverview };

// ── Extended insights — auth methods, MFA, guest ratio ──────────────────────
// These are added as a second function so the base overview stays fast.
// Called separately when the insights panel is displayed.
async function fetchTenantInsights(token) {
  const insights = {
    fetchedAt: new Date().toISOString(),
    mfaRegistration:    null,
    authMethods:        null,
    guestRatio:         null,
    privilegedMfa:      null,
    deviceCompliance:   null,
    deviceOwnership:    null,
    errors: []
  };

  // ── MFA registration + auth method breakdown (requires AuditLog.Read.All) ──
  // Uses the v1.0 userRegistrationDetails endpoint (replaces the deprecated
  // beta credentialUserRegistrationDetails which stopped returning data June 2024).
  //
  // Endpoint: GET /reports/authenticationMethods/userRegistrationDetails
  // Fields:   isMfaRegistered, isMfaCapable, isPasswordlessCapable, methodsRegistered
  // methodsRegistered is an array of strings like:
  //   "microsoftAuthenticatorPush", "microsoftAuthenticatorPasswordless",
  //   "softwareOneTimePasscode", "fido2", "windowsHelloForBusiness",
  //   "sms", "voice", "email", "temporaryAccessPass", "hardwareOneTimePasscode"
  try {
    const regs = await graphGetAll(token,
      '/reports/authenticationMethods/userRegistrationDetails' +
      '?$select=id,isMfaRegistered,isMfaCapable,isPasswordlessCapable,methodsRegistered'
    );
    const total         = regs.length;
    const mfaRegistered = regs.filter(r => r.isMfaRegistered).length;
    const mfaCapable    = regs.filter(r => r.isMfaCapable).length;
    const passwordless  = regs.filter(r => r.isPasswordlessCapable).length;

    // Count occurrences of each registered method across all users
    const methodCounts = {};
    for (const reg of regs) {
      for (const method of (reg.methodsRegistered || [])) {
        methodCounts[method] = (methodCounts[method] || 0) + 1;
      }
    }

    insights.mfaRegistration = {
      total,
      mfaRegistered,
      mfaNotRegistered: total - mfaRegistered,
      mfaCapable,
      passwordless,
      mfaPercent: total > 0 ? Math.round((mfaRegistered / total) * 100) : 0,
    };
    insights.authMethods = methodCounts;
  } catch (err) {
    // AuditLog.Read.All required — graceful degradation when not granted
    insights.errors.push({ section: 'mfaRegistration', message: err.message });
  }

  // ── Guest vs member ratio (requires User.Read.All) ────────────────────────
  try {
    const users = await graphGetAll(token,
      '/users?$select=userType,accountEnabled'
    );
    const members  = users.filter(u => u.userType !== 'Guest' && u.accountEnabled !== false).length;
    const guests   = users.filter(u => u.userType === 'Guest').length;
    const disabled = users.filter(u => u.accountEnabled === false).length;
    const total    = users.length;
    insights.guestRatio = {
      total, members, guests, disabled,
      guestPercent: total > 0 ? Math.round((guests / total) * 100) : 0,
    };
  } catch (err) {
    insights.errors.push({ section: 'guestRatio', message: err.message });
  }

  // ── Privileged users with MFA (role assignments cross-referenced) ─────────
  try {
    const assignments = await graphGetAll(token,
      '/roleManagement/directory/roleAssignments?$select=principalId,roleDefinitionId'
    );
    const privilegedPrincipalIds = new Set(assignments.map(a => a.principalId));

    // Try to get MFA registration state for privileged users
    // If reports API failed above, fall back to just the count
    if (insights.mfaRegistration) {
      // We don't have per-user IDs from credentialUserRegistrationDetails without
      // extra permissions, so report the aggregate alongside privileged count
      insights.privilegedMfa = {
        privilegedCount: privilegedPrincipalIds.size,
        note: 'MFA registration data is aggregate — see MFA Registration panel for details'
      };
    } else {
      insights.privilegedMfa = { privilegedCount: privilegedPrincipalIds.size };
    }
  } catch (err) {
    insights.errors.push({ section: 'privilegedMfa', message: err.message });
  }

  // ── Device compliance breakdown (requires DeviceManagementConfiguration.Read.All) ──
  try {
    const devices = await graphGetAll(token,
      '/devices?$select=id,isCompliant,isManaged,trustType,operatingSystem,operatingSystemVersion'
    );
    const total       = devices.length;
    const compliant   = devices.filter(d => d.isCompliant === true).length;
    const nonCompliant= devices.filter(d => d.isCompliant === false).length;
    const managed     = devices.filter(d => d.isManaged === true).length;
    const unmanaged   = total - managed;

    // Corporate (joined) vs personal (registered)
    const corporate   = devices.filter(d => d.trustType === 'AzureAd' || d.trustType === 'ServerAd').length;
    const personal    = total - corporate;

    // OS breakdown
    const byOS = {};
    for (const d of devices) {
      const os = d.operatingSystem || 'Unknown';
      byOS[os] = (byOS[os] || 0) + 1;
    }

    insights.deviceCompliance = {
      total, compliant, nonCompliant,
      managed, unmanaged,
      compliancePercent: total > 0 ? Math.round((compliant / total) * 100) : 0,
      managedPercent: total > 0 ? Math.round((managed / total) * 100) : 0,
    };
    insights.deviceOwnership = {
      total, corporate, personal, byOS,
      corporatePercent: total > 0 ? Math.round((corporate / total) * 100) : 0,
    };
  } catch (err) {
    insights.errors.push({ section: 'deviceCompliance', message: err.message });
  }

  return insights;
}

module.exports = { fetchTenantOverview, fetchTenantInsights };
