const fs = require('fs');
const path = require('path');

const from = path.resolve(__dirname, '..', 'data', 'reference-templates', 'archived');
const to = path.resolve(__dirname, '..', 'data', 'reference-templates-archived');

if (!fs.existsSync(from)) {
  console.log('No archived folder at', from);
  process.exit(0);
}

try {
  if (fs.existsSync(to)) {
    console.log('Destination exists, merging contents into', to);
    const entries = fs.readdirSync(from);
    for (const e of entries) {
      const src = path.join(from, e);
      const dst = path.join(to, e);
      fs.renameSync(src, dst);
    }
    fs.rmdirSync(from);
    console.log('Merged contents and removed', from);
  } else {
    fs.renameSync(from, to);
    console.log('Moved', from, '->', to);
  }
} catch (e) {
  console.error('Move failed', e && e.message);
  process.exit(2);
}

(async () => {
  try {
    const r = await fetch('http://127.0.0.1:3001/api/reference-templates/reload', { method: 'POST' });
    console.log('Reload status', r.status);
    try {
      const json = await r.json();
      console.log('Loaded templates count', Array.isArray(json) ? json.length : 0);
    } catch (e) {
      console.log('Reload responded with non-JSON');
    }
  } catch (e) {
    console.error('Reload failed', e && e.message);
  }
})();
