const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '../../..');
const sentinelRoot = path.join(root, 'data', 'sentinel');
const rulesDir = path.join(sentinelRoot, 'analytics-rules');
const kqlPath = path.join(sentinelRoot, 'kql', 'trustm365-queries.kql');
const workbookPath = path.join(sentinelRoot, 'workbooks', 'TrustM365-Drift-Monthly.workbook.json');
const backendSrc = path.join(root, 'backend', 'src');

const errors = [];
const warnings = [];
const infos = [];

function addError(msg) {
  errors.push(msg);
}

function addWarning(msg) {
  warnings.push(msg);
}

function addInfo(msg) {
  infos.push(msg);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    addError(`Invalid JSON at ${path.relative(root, filePath)}: ${err.message}`);
    return null;
  }
}

function walk(dir, ext = '.js') {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop();
    for (const ent of fs.readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, ent.name);
      if (ent.isDirectory()) stack.push(full);
      else if (ent.isFile() && full.endsWith(ext)) out.push(full);
    }
  }
  return out;
}

function isIsoDuration(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  const re = /^P(?=.)(?:\d+D)?(?:T(?=\d)(?:\d+H)?(?:\d+M)?(?:\d+S)?)?$/;
  return re.test(value.trim());
}

function extractEventTypes(text) {
  const out = new Set();
  const equals = /eventType_s\s*==\s*['"]([^'"]+)['"]/g;
  const inClause = /eventType_s\s+in\s*\(([^)]+)\)/g;

  let m;
  while ((m = equals.exec(text)) !== null) out.add(m[1]);

  while ((m = inClause.exec(text)) !== null) {
    const inside = m[1];
    const quoted = inside.match(/['"]([^'"]+)['"]/g) || [];
    for (const q of quoted) out.add(q.slice(1, -1));
  }

  return out;
}

function extractBackendEmittedEvents() {
  const jsFiles = walk(backendSrc, '.js');
  const out = new Set();
  const re = /emitSiemEvent\(\s*['"][^'"]+['"]\s*,\s*['"]([^'"]+)['"]/g;

  for (const file of jsFiles) {
    const raw = fs.readFileSync(file, 'utf8');
    let m;
    while ((m = re.exec(raw)) !== null) out.add(m[1]);
  }

  return out;
}

function validateRules() {
  if (!fs.existsSync(rulesDir)) {
    addError('Missing directory: data/sentinel/analytics-rules');
    return { eventTypes: new Set() };
  }

  const files = fs.readdirSync(rulesDir).filter(f => f.endsWith('.json'));
  if (files.length === 0) addError('No analytic rule templates found in data/sentinel/analytics-rules');

  const collectedEvents = new Set();

  for (const file of files) {
    const full = path.join(rulesDir, file);
    const json = readJson(full);
    if (!json) continue;

    const resource = Array.isArray(json.resources) ? json.resources[0] : null;
    if (!resource) {
      addError(`Rule ${file} has no resources[0] object`);
      continue;
    }

    if (resource.kind !== 'Scheduled') {
      addError(`Rule ${file} is not kind=Scheduled`);
    }

    const props = resource.properties || {};
    for (const key of ['queryFrequency', 'queryPeriod']) {
      if (!isIsoDuration(props[key])) {
        addError(`Rule ${file} has invalid or missing ${key}: ${props[key]}`);
      }
    }

    if (props.suppressionDuration && !isIsoDuration(props.suppressionDuration)) {
      addError(`Rule ${file} has invalid suppressionDuration: ${props.suppressionDuration}`);
    }

    const lookback = props?.incidentConfiguration?.groupingConfiguration?.lookbackDuration;
    if (lookback && !isIsoDuration(lookback)) {
      addError(`Rule ${file} has invalid lookbackDuration: ${lookback}`);
    }

    if (typeof props.query !== 'string' || props.query.trim().length === 0) {
      addError(`Rule ${file} has empty query`);
      continue;
    }

    if (!props.query.includes('{TablePrefix}')) {
      addWarning(`Rule ${file} query is not parameterized with {TablePrefix}`);
    }

    for (const evt of extractEventTypes(props.query)) collectedEvents.add(evt);
  }

  return { eventTypes: collectedEvents };
}

function validateKqlLibrary() {
  if (!fs.existsSync(kqlPath)) {
    addError('Missing file: data/sentinel/kql/trustm365-queries.kql');
    return { eventTypes: new Set() };
  }

  const raw = fs.readFileSync(kqlPath, 'utf8');
  const eventTypes = extractEventTypes(raw);

  if (/let\s+TablePrefix\s*=\s*['"]TrustM365['"]/.test(raw)) {
    addWarning('KQL library defaults TablePrefix to TrustM365; update for custom prefix when importing queries.');
  }

  return { eventTypes };
}

function validateWorkbook() {
  if (!fs.existsSync(workbookPath)) {
    addError('Missing file: data/sentinel/workbooks/TrustM365-Drift-Monthly.workbook.json');
    return { eventTypes: new Set() };
  }

  const workbook = readJson(workbookPath);
  if (!workbook) return { eventTypes: new Set() };

  if (!Array.isArray(workbook.items) || workbook.items.length === 0) {
    addError('Workbook has no items');
    return { eventTypes: new Set() };
  }

  if (!workbook.$schema) {
    addWarning('Workbook JSON has no $schema property. Import can still work, but schema validation is weaker.');
  }

  const eventTypes = new Set();
  let hasHardcodedDefaultTable = false;

  for (const item of workbook.items) {
    const query = item?.content?.query;
    if (typeof query !== 'string') continue;

    if (query.includes('TrustM365Drift_CL') || query.includes('TrustM365Restore_CL')) {
      hasHardcodedDefaultTable = true;
    }

    for (const evt of extractEventTypes(query)) eventTypes.add(evt);
  }

  if (hasHardcodedDefaultTable) {
    addWarning('Workbook queries are hard-coded to TrustM365* tables; custom table prefix requires manual query edits.');
  }

  return { eventTypes };
}

function validateDeployPrereqs() {
  const az = spawnSync('az', ['--version'], { encoding: 'utf8' });
  if (az.error || az.status !== 0) {
    addWarning('Azure CLI (az) is not available in PATH. sentinel:deploy will not run until installed/login configured.');
    return;
  }

  const firstLine = (az.stdout || '').split(/\r?\n/).find(Boolean) || 'azure-cli available';
  addInfo(`Azure CLI check: ${firstLine}`);
}

function run() {
  addInfo('Running Sentinel preflight checks (rules, KQL, workbook, backend parity, deploy prerequisites).');

  const rules = validateRules();
  const kql = validateKqlLibrary();
  const workbook = validateWorkbook();
  validateDeployPrereqs();

  const referenced = new Set([...rules.eventTypes, ...kql.eventTypes, ...workbook.eventTypes]);
  const emitted = extractBackendEmittedEvents();

  for (const evt of referenced) {
    if (!emitted.has(evt)) {
      addError(`Event type referenced by Sentinel assets but not emitted by backend: ${evt}`);
    }
  }

  const missingInAssets = [...emitted].filter(evt => {
    return evt.startsWith('drift.') || evt.startsWith('restore.') || evt.startsWith('sync.') || evt.startsWith('webhook.') || evt === 'api.request';
  }).filter(evt => !referenced.has(evt));

  if (missingInAssets.length > 0) {
    addInfo(`Backend emits additional events not currently referenced in rules/workbook/KQL: ${missingInAssets.join(', ')}`);
  }

  for (const msg of infos) console.log(`[sentinel:preflight][info] ${msg}`);
  for (const msg of warnings) console.warn(`[sentinel:preflight][warn] ${msg}`);
  for (const msg of errors) console.error(`[sentinel:preflight][error] ${msg}`);

  if (errors.length > 0) {
    console.error(`[sentinel:preflight] FAILED with ${errors.length} error(s) and ${warnings.length} warning(s).`);
    process.exitCode = 1;
    return;
  }

  console.log(`[sentinel:preflight] PASSED with ${warnings.length} warning(s).`);
}

run();
