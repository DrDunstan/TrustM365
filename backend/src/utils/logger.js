const pino = require('pino');
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: ['secret', 'clientSecret', 'token', 'password', 'key'],
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
    : undefined
});
module.exports = logger;
