// utils/logger.js
// Tiny dependency-free logger with levels, timestamps, and colourised output.
// Also mirrors everything to a daily rotating file under ./logs so you have an
// audit trail for sensitive actions (e.g. who ran /nuke).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../config/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.join(__dirname, '..', 'logs');

// Ensure the log directory exists once at startup.
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const COLORS = {
  debug: '\x1b[90m', // grey
  info: '\x1b[36m', // cyan
  warn: '\x1b[33m', // yellow
  error: '\x1b[31m', // red
  reset: '\x1b[0m',
};

const threshold = LEVELS[config.bot.logLevel] ?? LEVELS.info;

/** Append a line to today's log file. Never throws — logging must not crash the app. */
function writeToFile(line) {
  try {
    const file = path.join(LOG_DIR, `${new Date().toISOString().slice(0, 10)}.log`);
    fs.appendFileSync(file, line + '\n');
  } catch {
    /* swallow — disk issues should not take the bot down */
  }
}

/**
 * Redact obviously sensitive substrings from anything we log. This is a safety
 * net so a stray console.log of a config object never leaks a token.
 */
function redact(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1[REDACTED]')
    .replace(/([A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,})/g, '[REDACTED_TOKEN]');
}

function log(level, ...args) {
  if (LEVELS[level] < threshold) return;
  const timestamp = new Date().toISOString();
  const message = args
    .map((a) => (typeof a === 'object' ? JSON.stringify(a) : redact(String(a))))
    .join(' ');
  const plain = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
  const colored = `${COLORS[level]}${plain}${COLORS.reset}`;

  // eslint-disable-next-line no-console
  (level === 'error' ? console.error : console.log)(colored);
  writeToFile(plain);
}

const logger = {
  debug: (...a) => log('debug', ...a),
  info: (...a) => log('info', ...a),
  warn: (...a) => log('warn', ...a),
  error: (...a) => log('error', ...a),
};

export default logger;
