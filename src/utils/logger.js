/**
 * Simple logger utility with timestamps and log levels
 */

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL?.toUpperCase()] ?? LOG_LEVELS.INFO;

function formatTimestamp() {
  return new Date().toISOString();
}

function formatMessage(level, message, data = null) {
  const timestamp = formatTimestamp();
  const dataStr = data ? ` | ${JSON.stringify(data)}` : '';
  return `[${timestamp}] [${level}] ${message}${dataStr}`;
}

const logger = {
  debug(message, data = null) {
    if (currentLevel <= LOG_LEVELS.DEBUG) {
      console.log(formatMessage('DEBUG', message, data));
    }
  },

  info(message, data = null) {
    if (currentLevel <= LOG_LEVELS.INFO) {
      console.log(formatMessage('INFO', message, data));
    }
  },

  warn(message, data = null) {
    if (currentLevel <= LOG_LEVELS.WARN) {
      console.warn(formatMessage('WARN', message, data));
    }
  },

  error(message, data = null) {
    if (currentLevel <= LOG_LEVELS.ERROR) {
      console.error(formatMessage('ERROR', message, data));
    }
  },

  // Log pipeline step with counts
  step(stepName, count, details = null) {
    this.info(`[PIPELINE] ${stepName}: ${count}`, details);
  },
};

module.exports = logger;
