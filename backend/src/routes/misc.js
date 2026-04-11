const express = require('express');
const path    = require('path');
const fs      = require('fs');
const multer  = require('multer');
const router  = express.Router();
const { getDb } = require('../database/init');
const logger  = require('../utils/logger');

// ── Health check — used by Docker HEALTHCHECK and Azure App Service ───────────
router.get('/health', (req, res) => {
  try {
    const db = getDb();
    // Quick DB sanity check
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok', version: '1.0.0', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'error', error: err.message });
  }
});

// ── Job polling ──────────────────────────────────────────────────────────────
router.get('/jobs/:id', (req, res) => {
  const { getJob } = require('../engine/sync');
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// ── Logo upload setup ────────────────────────────────────────────────────────
// Logos stored at data/uploads/logo.<ext> — same persistent volume as the DB.
// Only PNG, JPEG, SVG, and WebP are accepted. Max 2 MB.
const UPLOADS_DIR = path.join(process.cwd(), 'data', 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const logoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename:    (_req, file,  cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    cb(null, `logo${ext}`);          // always overwrites the previous logo
  },
});

const logoUpload = multer({
  storage: logoStorage,
  limits: { fileSize: 2 * 1024 * 1024 },  // 2 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];
    cb(null, allowed.includes(file.mimetype));
  },
});

// Serve uploaded logos as static files
router.use('/mssp/uploads', express.static(UPLOADS_DIR));

// ── GET /api/mssp/settings ────────────────────────────────────────────────────
router.get('/mssp/settings', (req, res) => {
  const db = getDb();
  const settings = db.prepare('SELECT * FROM mssp_settings WHERE id = ?').get('singleton');
  // Remove timezone from settings response
  if (settings) delete settings.timezone;
  res.json(settings || {
    company_name: '', logo_path: null, logo_url: null, brand_hue: null,
    baseline_label_template: '', tagline: '', report_theme: 'light', report_accent: ''
  });
});

// ── PATCH /api/mssp/settings — update text fields ────────────────────────────
router.patch('/mssp/settings', (req, res) => {
  const db = getDb();
  const { company_name, baseline_label_template, brand_hue, tagline, report_accent } = req.body;
  db.prepare(`
    UPDATE mssp_settings
    SET company_name=?, baseline_label_template=?, brand_hue=?,
        tagline=?, report_accent=?,
        updated_at=datetime('now')
    WHERE id='singleton'
  `).run(
    company_name            || '',
    baseline_label_template || '',
    brand_hue               || null,
    tagline                 || '',
    report_accent           || ''
  );
  res.json({ message: 'Settings saved' });
});

// ── POST /api/mssp/logo — upload a custom logo ───────────────────────────────
router.post('/mssp/logo', logoUpload.single('logo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No valid image file uploaded (PNG, JPEG, SVG, WebP — max 2 MB)' });

  const db = getDb();
  const logoUrl = `/api/mssp/uploads/${req.file.filename}`;
  db.prepare("UPDATE mssp_settings SET logo_url=?, updated_at=datetime('now') WHERE id='singleton'")
    .run(logoUrl);

  logger.info({ filename: req.file.filename }, 'Custom logo uploaded');
  res.json({ message: 'Logo uploaded', logo_url: logoUrl });
});

// ── DELETE /api/mssp/logo — remove custom logo (revert to TrustM365 default) ─
router.delete('/mssp/logo', (req, res) => {
  const db = getDb();

  // Delete the file if it exists
  const logoFiles = ['logo.png', 'logo.jpg', 'logo.jpeg', 'logo.svg', 'logo.webp'];
  for (const f of logoFiles) {
    const fp = path.join(UPLOADS_DIR, f);
    if (fs.existsSync(fp)) { try { fs.unlinkSync(fp) } catch {} }
  }

  db.prepare("UPDATE mssp_settings SET logo_url=NULL, updated_at=datetime('now') WHERE id='singleton'").run();
  res.json({ message: 'Logo removed' });
});

// ── POST /api/mssp/reset — reset all branding to TrustM365 defaults ──────────
router.post('/mssp/reset', (req, res) => {
  const db = getDb();

  // Remove logo file
  const logoFiles = ['logo.png', 'logo.jpg', 'logo.jpeg', 'logo.svg', 'logo.webp'];
  for (const f of logoFiles) {
    const fp = path.join(UPLOADS_DIR, f);
    if (fs.existsSync(fp)) { try { fs.unlinkSync(fp) } catch {} }
  }

  db.prepare(`
    UPDATE mssp_settings
    SET company_name='', logo_url=NULL, brand_hue=NULL, baseline_label_template='',
        tagline='', report_theme='dark', report_accent='',
        updated_at=datetime('now')
    WHERE id='singleton'
  `).run();

  logger.info('MSSP branding reset to TrustM365 defaults');
  res.json({ message: 'Reset to defaults' });
});

module.exports = router;
