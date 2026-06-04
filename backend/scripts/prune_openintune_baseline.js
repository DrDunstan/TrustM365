const fs = require('fs');
const path = require('path');

const keepFiles = [
  'win-oib-es-defender-antivirus-d-av-configuration-v3-3.json',
  'win-oib-es-attack-surface-reduction-d-asr-rules-l2-v3-7.json',
  'win-oib-es-encryption-d-bitlocker-os-disk-v3-7.json',
  'win-oib-es-windows-firewall-d-firewall-configuration-v3-1.json',
  'win-oib-es-windows-laps-d-laps-configuration-24h2-v3-6.json',
  'win-oib-sc-device-security-d-local-security-policies-24h2-v3-6.json',
  'win-oib-sc-device-security-d-security-hardening-v3-7.json',
  'win-oib-sc-device-security-u-device-guard-credential-guard-and-hvci-v3-7.json',
  'win-oib-sc-microsoft-edge-d-security-v3-7.json',
  'win-oib-sc-windows-update-for-business-d-reports-and-telemetry-v3-0.json',
  'sources.json'
];

const srcDir = path.join(__dirname, '..', 'data', 'reference-templates', 'open-intune-baseline');
const archBase = path.join(__dirname, '..', 'data', 'reference-templates', 'archived');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const archDirName = `open-intune-baseline-${timestamp}`;
const archDir = path.join(archBase, archDirName);

const report = { timestamp: new Date().toISOString(), kept: [], archived: [], errors: [] };

try {
  if (!fs.existsSync(srcDir)) throw new Error(`Source dir not found: ${srcDir}`);
  const files = fs.readdirSync(srcDir).filter(f => f.toLowerCase().endsWith('.json') || f.toLowerCase().endsWith('.json'));
  for (const f of files) {
    if (keepFiles.includes(f)) {
      report.kept.push(f);
      continue;
    }
    try {
      fs.mkdirSync(archDir, { recursive: true });
      const from = path.join(srcDir, f);
      const to = path.join(archDir, f);
      fs.renameSync(from, to);
      report.archived.push(f);
      console.log('Archived', f);
    } catch (e) {
      report.errors.push({ file: f, error: String(e) });
      console.warn('Failed to archive', f, e && e.message);
    }
  }
} catch (e) {
  console.error('Prune failed', e && e.message);
  process.exit(2);
}

// Reload registry
let reloadResult = null;
(async () => {
  try {
    const resp = await fetch('http://127.0.0.1:3001/api/reference-templates/reload', { method: 'POST' });
    const json = await resp.json().catch(() => null);
    reloadResult = { status: resp.status, body: json };
    report.reload = reloadResult;
    console.log('Registry reload status', resp.status);
  } catch (e) {
    report.reload = { error: String(e) };
    console.warn('Registry reload failed', String(e));
  }

  // Write report
  try {
    const outDir = path.join(__dirname, '..', 'tmp');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'prune_openintune_baseline_report.json');
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
    console.log('Prune report written to', outPath);
    process.exit(0);
  } catch (e) {
    console.error('Failed to write report', e && e.message);
    process.exit(2);
  }
})();
