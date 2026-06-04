const fs = require('fs');
const path = require('path');

const templates = [
  {
    url: 'https://raw.githubusercontent.com/SkipToTheEndpoint/OpenIntuneBaseline/main/WINDOWS/IntuneManagement/SettingsCatalog/Win%20-%20OIB%20-%20ES%20-%20Encryption%20-%20D%20-%20BitLocker%20%28OS%20Disk%29%20-%20v3.7.json',
    filename: 'Win - OIB - ES - Encryption - D - BitLocker (OS Disk) - v3.7.json'
  },
  {
    url: 'https://raw.githubusercontent.com/SkipToTheEndpoint/OpenIntuneBaseline/main/WINDOWS/IntuneManagement/SettingsCatalog/Win%20-%20OIB%20-%20ES%20-%20Defender%20Antivirus%20-%20D%20-%20AV%20Configuration%20-%20v3.3.json',
    filename: 'Win - OIB - ES - Defender Antivirus - D - AV Configuration - v3.3.json'
  },
  {
    url: 'https://raw.githubusercontent.com/SkipToTheEndpoint/OpenIntuneBaseline/main/WINDOWS/IntuneManagement/SettingsCatalog/Win%20-%20OIB%20-%20ES%20-%20Attack%20Surface%20Reduction%20-%20D%20-%20ASR%20Rules%20%28L2%29%20-%20v3.7.json',
    filename: 'Win - OIB - ES - Attack Surface Reduction - D - ASR Rules (L2) - v3.7.json'
  }
];

(async () => {
  for (const t of templates) {
    try {
      console.log('Fetching', t.url);
      const res = await fetch(t.url);
      if (!res.ok) {
        console.error('Failed to fetch', t.url, res.status);
        continue;
      }
      const text = await res.text();
      const outDir = path.resolve(__dirname, '..', 'backend', 'data', 'reference-templates', 'upstream');
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      const outPath = path.join(outDir, t.filename);
      fs.writeFileSync(outPath, text, 'utf8');
      console.log('Saved', outPath);
    } catch (err) {
      console.error('Error fetching', t.url, err && err.message);
    }
  }
})();
