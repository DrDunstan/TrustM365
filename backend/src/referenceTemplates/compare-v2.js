const comparator = require('./comparator');

function normalizePolicyType(value) {
  if (!value) return '';
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function policyTypeTokens(value) {
  const normalized = normalizePolicyType(value);
  if (!normalized) return [];
  return normalized.split(/\s+/).filter(Boolean);
}

function resourceMatchesPolicyType(resource, normalizedPolicyType, tokens) {
  if (!resource || !normalizedPolicyType) return true;
  const fields = [
    resource.policy_type,
    resource.policyType,
    resource.profile_type,
    resource.profileType,
    resource.templateType,
    resource.type,
    resource.displayName,
    resource.name,
  ];
  const haystack = normalizePolicyType(fields.filter(Boolean).join(' '));
  if (!haystack) return false;
  if (haystack.includes(normalizedPolicyType)) return true;
  return tokens.length > 0 && tokens.every(t => haystack.includes(t));
}

function filterResourcesByPolicyType(currentResources, policyType) {
  const normalizedPolicyType = normalizePolicyType(policyType);
  if (!normalizedPolicyType || !currentResources || typeof currentResources !== 'object') {
    return { filtered: currentResources || {}, candidateCount: Object.keys(currentResources || {}).length };
  }

  const tokens = policyTypeTokens(policyType);
  const out = {};
  for (const [resourceId, resource] of Object.entries(currentResources)) {
    if (resourceMatchesPolicyType(resource, normalizedPolicyType, tokens)) {
      out[resourceId] = resource;
    }
  }

  return { filtered: out, candidateCount: Object.keys(out).length };
}

async function compareTemplateResourcesV2(template, currentResources, options = {}) {
  const policyType = options.policyType || '';
  const strictPolicyType = Boolean(options.strictPolicyType);
  const fallbackToLegacy = options.fallbackToLegacy !== false;

  const totalResources = Object.keys(currentResources || {}).length;
  const { filtered, candidateCount } = filterResourcesByPolicyType(currentResources, policyType);

  // Soft-filter behavior: if no policy-type candidates exist, fall back to legacy comparison.
  const useFallback = candidateCount === 0 && fallbackToLegacy && !strictPolicyType;
  const resourcesToCompare = useFallback ? (currentResources || {}) : filtered;

  const items = await comparator.compareTemplateResources(template, resourcesToCompare) || [];
  return {
    items,
    compareMeta: {
      version: 'v2',
      policyType: policyType || null,
      strictPolicyType,
      candidateCount,
      totalResources,
      usedFallbackToLegacy: useFallback,
      filteringApplied: Boolean(policyType),
    },
  };
}

module.exports = {
  compareTemplateResourcesV2,
  normalizePolicyType,
};
