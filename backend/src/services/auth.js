const msal = require('@azure/msal-node');
const clientCache = new Map();

function getClient(tenantId, clientId, clientSecret) {
  const key = `${tenantId}:${clientId}`;
  if (!clientCache.has(key)) {
    clientCache.set(key, new msal.ConfidentialClientApplication({
      auth: { clientId, clientSecret, authority: `https://login.microsoftonline.com/${tenantId}` }
    }));
  }
  return clientCache.get(key);
}

async function getAccessToken(tenantId, clientId, clientSecret) {
  const result = await getClient(tenantId, clientId, clientSecret)
    .acquireTokenByClientCredential({ scopes: ['https://graph.microsoft.com/.default'] });
  if (!result?.accessToken) throw new Error('Failed to acquire access token from Microsoft');
  return result.accessToken;
}

function evictClient(tenantId, clientId) {
  clientCache.delete(`${tenantId}:${clientId}`);
}

module.exports = { getAccessToken, evictClient };
