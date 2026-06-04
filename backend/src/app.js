const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const logger = require('./utils/logger');
const tenantsRouter      = require('./routes/tenants');
const areasRouter        = require('./routes/areas');
const templatesRouter    = require('./routes/securityTemplates');
const referenceTemplatesRouter = require('./routes/referenceTemplates');
const miscRouter         = require('./routes/misc');
const customCollectorsRouter = require('./routes/customCollectors');
const reportsRouter      = require('./routes/reports');
const webhooksRouter     = require('./routes/webhooks');
const appRegistrationsRouter = require('./routes/appRegistrations');
const { emitSiemEvent } = require('./services/logAnalytics');

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));

// CORS strategy:
//  development — only allow the Vite dev server (localhost:5173)
//  production  — frontend is served by nginx which proxies /api to this process.
//                All API requests arrive at 127.0.0.1 from nginx, not from a browser
//                origin, so CORS is not needed. We still allow the configured
//                FRONTEND_URL env var for any non-nginx hosted setups (e.g. Azure
//                where the frontend and backend run as separate App Services).
const isDev = process.env.NODE_ENV !== 'production';
const allowedOrigins = isDev
  ? ['http://localhost:5173', 'http://127.0.0.1:5173']
  : (process.env.FRONTEND_URL
      ? [process.env.FRONTEND_URL]
      : true);  // true = reflect request origin (safe because auth is API-key/session based)

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: '5mb' }));
app.use((req, res, next) => {
  const startedAt = Date.now();
  logger.info({ method: req.method, url: req.url }, 'Request');
  res.on('finish', () => {
    emitSiemEvent('api_logs', 'api.request', {
      method: req.method,
      url: req.originalUrl || req.url,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
      ip: req.ip,
    });
  });
  next();
});

app.use('/api/tenants',           tenantsRouter);
app.use('/api/areas',             areasRouter);
// Mount both legacy and new routes for compatibility. New preferred path: /api/security-templates
app.use('/api/security-templates', templatesRouter);
app.use('/api/templates',         templatesRouter);
app.use('/api/reference-templates', referenceTemplatesRouter);
app.use('/api/custom-collectors', customCollectorsRouter);
app.use('/api/app-registrations', appRegistrationsRouter);
app.use('/api/reports',           reportsRouter);
app.use('/api/webhooks',          webhooksRouter);
app.use('/api',                   miscRouter);   // handles /api/jobs/:id and /api/mssp/*

// ── Production: serve built frontend from frontend/dist/ ─────────────────────
// Used by Azure App Service (single-process) and any non-nginx deployment.
// Docker deployments use nginx to serve the frontend — this block is skipped.
if (process.env.NODE_ENV === 'production') {
  const path = require('path');
  const frontendDist = path.join(__dirname, '../../frontend/dist');
  const fs = require('fs');
  if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    // SPA catch-all — serve index.html for any non-API route so React Router works
    app.get('*', (req, res) => {
      res.sendFile(path.join(frontendDist, 'index.html'));
    });
  } else {
    app.use((req, res) => res.status(404).json({ error: 'Not found' }));
  }
} else {
  app.use((req, res) => res.status(404).json({ error: 'Not found' }));
}
app.use((err, req, res, next) => {
  logger.error({ err }, 'Unhandled error');
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

module.exports = app;
