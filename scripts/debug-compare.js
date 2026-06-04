const comparator = require('../backend/src/referenceTemplates/comparator');
const fs = require('fs');
const path = require('path');

const cases = [
  { tpl: 'win-oib-es-encryption-d-bitlocker-os-disk-v3-7.json', sample: 'collector-bitlocker-sample.json' },
  { tpl: 'win-oib-es-defender-antivirus-d-av-configuration-v3-3.json', sample: 'collector-defender-av-sample.json' },
  { tpl: 'win-oib-es-attack-surface-reduction-d-asr-rules-audit-mode-v3-1.json', sample: 'collector-asr-sample.json' }
];

(async () => {
  for (const c of cases) {
    console.log('----', c.tpl, 'vs', c.sample);
    const tplPath = path.resolve(__dirname, '..', 'backend', 'data', 'reference-templates', 'open-intune-baseline', c.tpl);
    const samplePath = path.resolve(__dirname, '..', 'docs', 'samples', c.sample);
    const tpl = JSON.parse(fs.readFileSync(tplPath, 'utf8'));
    const sample = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
    const items = await comparator.compareTemplateResources(tpl, sample);
    console.log(JSON.stringify(items, null, 2));
  }
})();
