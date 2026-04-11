require('dotenv').config();
const app = require('./app');
const { initDatabase } = require('./database/init');
const { runAllDriftChecks } = require('./engine/sync');
const logger = require('./utils/logger');

const PORT = process.env.PORT || 3001;
const HOST = process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1';


async function start() {
  await initDatabase();
  logger.info('Database initialised');

  // Timezone logic removed: always use server local time or UTC

  app.listen(PORT, HOST, () => {
    logger.info({ port: PORT, host: HOST }, `TrustM365 API running on http://${HOST}:${PORT}`);
  });


  const cron = require('node-cron');
  // Always run scheduler every 5 minutes; per-tenant settings control actual checks
  cron.schedule('*/5 * * * *', async () => {
    logger.info('Running scheduled drift checks…');
    await runAllDriftChecks();
  });
  logger.info({ interval: 5 }, 'Per-tenant drift check scheduler enabled (every 5 min)');

  // Automated report scheduler removed as per requirements.
}

start().catch(err => { logger.error({ err }, 'Startup failed'); process.exit(1); });
