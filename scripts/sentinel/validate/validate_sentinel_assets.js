const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../../..');
const requiredFiles = [
  'data/sentinel/kql/trustm365-queries.kql',
  'data/sentinel/analytics-rules/TrustM365-Drift-Repeated-Incident.json',
  'data/sentinel/analytics-rules/TrustM365-Restore-Failure-Incident.json',
  'data/sentinel/workbooks/TrustM365-Drift-Monthly.workbook.json',
  'data/sentinel/deployment/README.md'
];

function fail(msg) {
  console.error(`[sentinel:validate] ${msg}`);
  process.exitCode = 1;
}

function validateJson(filePath) {
  const fullPath = path.join(root, filePath);
  const raw = fs.readFileSync(fullPath, 'utf8');
  try {
    JSON.parse(raw);
  } catch (err) {
    fail(`Invalid JSON in ${filePath}: ${err.message}`);
  }
}

for (const filePath of requiredFiles) {
  const fullPath = path.join(root, filePath);
  if (!fs.existsSync(fullPath)) {
    fail(`Missing required file: ${filePath}`);
  }
}

validateJson('data/sentinel/analytics-rules/TrustM365-Drift-Repeated-Incident.json');
validateJson('data/sentinel/analytics-rules/TrustM365-Restore-Failure-Incident.json');
validateJson('data/sentinel/workbooks/TrustM365-Drift-Monthly.workbook.json');

if (!process.exitCode) {
  console.log('[sentinel:validate] OK - Sentinel content pack assets look valid.');
}
