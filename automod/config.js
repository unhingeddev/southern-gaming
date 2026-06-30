// automod/config.js
// Lightweight config for the auto-mod subsystem. Loads automod/config.json and
// (optionally) LOG_CHANNEL_ID from the environment. It deliberately does NOT
// re-validate the bot token / client id — the host bot's config/config.js owns
// that. This keeps the auto-mod module self-contained and decoupled.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaults = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));

const config = {
  // Everything from config.json (gate, modules, thresholds, pattern lists…).
  defaults,
  bot: {
    // Env var wins; otherwise the value baked into config.json.
    defaultLogChannelId: (process.env.LOG_CHANNEL_ID || defaults.defaultLogChannelId || '').trim(),
  },
};

export default config;
