// config/config.js
// Centralised, validated configuration loaded from environment variables.
// Importing this module guarantees that required secrets are present before
// the rest of the app boots — failing fast with a clear message otherwise.

import 'dotenv/config';

// Silence the (harmless) ExperimentalWarning emitted by Node's built-in
// `node:sqlite` module. We still surface every other warning untouched.
const originalEmitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...args) => {
  const text = typeof warning === 'string' ? warning : warning?.message ?? '';
  const type = args[0]?.type ?? args[0];
  if (type === 'ExperimentalWarning' && /SQLite/i.test(text)) return;
  return originalEmitWarning(warning, ...args);
};

/**
 * Read a required environment variable, throwing a descriptive error if it is
 * missing. Keeps every "you forgot to set X" failure in one predictable place.
 * @param {string} key
 * @returns {string}
 */
function required(key) {
  const value = process.env[key];
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing required environment variable "${key}". ` +
        `Copy .env.example to .env and fill it in.`
    );
  }
  return value.trim();
}

/** Read an optional env var with a fallback default. */
function optional(key, fallback = '') {
  const value = process.env[key];
  return value && value.trim() !== '' ? value.trim() : fallback;
}

/** Parse an integer env var, falling back if unset/invalid. */
function int(key, fallback) {
  const parsed = parseInt(process.env[key] ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Parse a boolean env var ("true"/"1"/"yes"/"on" → true), falling back if unset. */
function bool(key, fallback) {
  const v = process.env[key];
  if (v == null || v.trim() === '') return fallback;
  return /^(1|true|yes|on)$/i.test(v.trim());
}

const config = {
  discord: {
    token: required('DISCORD_TOKEN'),
    clientId: required('DISCORD_CLIENT_ID'),
    clientSecret: optional('DISCORD_CLIENT_SECRET'),
    // Test guild — `npm run deploy` registers here for instant updates.
    guildId: optional('DISCORD_GUILD_ID'),
    // Live/production guild — `npm run deploy:live` targets this one.
    liveGuildId: optional('DISCORD_LIVE_GUILD_ID'),
  },

  sellauth: {
    apiBase: optional('SELLAUTH_API_BASE', 'https://api.sellauth.com/v1'),
    // Global fallback key/shop; per-guild values from the DB take precedence.
    apiKey: optional('SELLAUTH_API_KEY'),
    shopId: optional('SELLAUTH_SHOP_ID'),
  },

  security: {
    // Must be 64 hex chars (32 bytes) for AES-256-GCM. Validated in utils/crypto.js.
    encryptionKey: required('ENCRYPTION_KEY'),
  },

  bot: {
    pollIntervalSeconds: int('POLL_INTERVAL_SECONDS', 120),
    commandCooldownSeconds: int('COMMAND_COOLDOWN_SECONDS', 3),
    statusRotateSeconds: int('STATUS_ROTATE_SECONDS', 30),
    logLevel: optional('LOG_LEVEL', 'info'),
    // Auto-register slash commands to a server the moment the bot is added to it,
    // so adding the bot to more servers needs no manual deploy. Turn this OFF
    // (AUTO_REGISTER_ON_JOIN=false) if you register commands globally instead,
    // to avoid commands appearing twice.
    autoRegisterOnJoin: bool('AUTO_REGISTER_ON_JOIN', true),
  },
};

export default config;
