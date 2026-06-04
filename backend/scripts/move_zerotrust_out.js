const fs = require('fs');
const path = require('path');

const from = path.resolve(__dirname, '..', 'data', 'reference-templates', 'zerotrust');
if (!fs.existsSync(from)) {
  console.log('No zerotrust folder at', from);
  process.exit(0);
}

const ts = new Date().toISOString().replace(/[:.]/g, '-');
const to = path.resolve(__dirname, '..', 'data', 'reference-templates-archived', `zerotrust-${ts}`);

try {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.renameSync(from, to);
  console.log('Moved', from, '->', to);
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
      console.log('Total templates after reload', Array.isArray(json) ? json.length : 0);
    } catch (e) {
      console.log('Reload returned non-JSON');
    }
  } catch (e) {
    console.error('Reload failed', e && e.message);
  }
})();
