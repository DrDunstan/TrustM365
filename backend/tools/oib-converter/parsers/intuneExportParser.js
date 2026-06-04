const fs = require('fs');

function normalize(raw) {
  return {
    name: raw.name || raw.displayName || raw.Title || 'Unnamed Policy',
    description: raw.description || raw.Description || '',
    profileType: raw.profileType || raw.profile_type || raw.ProfileType || 'Settings catalog',
    category: raw.category || raw.Category || '',
    policyType: raw.policyType || raw.policy_type || raw.PolicyType || '',
    platformSupported: raw.platformSupported || raw.platform || raw.PlatformSupported || '',
    created: raw.created || raw.Created || '',
    lastModified: raw.lastModified || raw.last_modified || raw.LastModified || '',
    settings: raw.settings || raw.Settings || raw.controls || []
  };
}

module.exports.parseFile = function(filePath) {
  const buf = fs.readFileSync(filePath);
  let content = null;
  try {
    if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
      // UTF-8 with BOM
      content = buf.toString('utf8', 3);
    } else if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) {
      // UTF-16 LE with BOM
      content = buf.toString('utf16le', 2);
    } else if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) {
      // UTF-16 BE with BOM — swap bytes and decode as utf16le
      const body = buf.slice(2);
      const swapped = Buffer.alloc(body.length);
      for (let i = 0; i < body.length; i += 2) {
        if (i + 1 < body.length) {
          swapped[i] = body[i + 1];
          swapped[i + 1] = body[i];
        } else {
          swapped[i] = body[i];
        }
      }
      content = swapped.toString('utf16le');
    } else {
      content = buf.toString('utf8');
    }
    const raw = JSON.parse(content);
    return normalize(raw);
  } catch (err) {
    throw new Error(`Failed to parse ${filePath} ${err && err.message ? err.message : ''}`);
  }
};
