// index.js
// Application entry point: boots the Discord client, loads commands & events,
// wires shared context, and handles graceful shutdown.

import { Client, GatewayIntentBits, Partials } from 'discord.js';
import config from './config/config.js';
import logger from './utils/logger.js';
import { loadCommands } from './handlers/commandHandler.js';
import { loadEvents } from './handlers/eventHandler.js';
import { Store, closeDatabase } from './database/db.js';
import { stopAutomation } from './services/automation.js';
import { stopStatusRotation } from './services/statusRotator.js';
import { stopTicketSweeper } from './services/ticketSweeper.js';
import { stopGiveawaySweeper } from './services/giveawaySweeper.js';
import { startStrikeDecay, stopStrikeDecay } from './automod/decay.js';
import { closeAutomodDatabase } from './automod/db.js';

// Base (non-privileged) intents the bot always uses.
// GuildModeration lets the bot receive ban events for the logging system.
const BASE_INTENTS = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.GuildModeration,
];

// Privileged intents (enable both in Developer Portal → Bot → Privileged Gateway Intents):
//   • GuildMembers   — auto-role + auto-mod join checks (anti-raid, account-age, nicknames)
//   • MessageContent — auto-mod content filters + availability responder
const { GuildMembers, MessageContent } = GatewayIntentBits;

// Login tiers, tried in order. If the portal rejects a privileged intent we drop
// to a smaller set so the bot still starts (with the matching features dormant)
// rather than crashing — this is what keeps the existing bot safe.
const TIERS = [
  { intents: [...BASE_INTENTS, GuildMembers, MessageContent], note: null },
  {
    intents: [...BASE_INTENTS, GuildMembers],
    note: 'MESSAGE CONTENT intent is OFF — auto-mod content filters & the availability responder are disabled until you enable it and restart.',
  },
  {
    intents: [...BASE_INTENTS],
    note: 'SERVER MEMBERS + MESSAGE CONTENT intents are OFF — auto-role and auto-mod are disabled until you enable them and restart.',
  },
];

// Mutable so the resilient-login fallback below can rebuild it with fewer intents.
let client;

/** Build a client with the given intents, load commands/events, and log in. */
async function startWith(intents) {
  client = new Client({
    intents,
    partials: [Partials.Channel, Partials.Message, Partials.GuildMember],
  });
  const ctx = { client, Store, config };
  await loadCommands(client);
  await loadEvents(client, ctx);
  await client.login(config.discord.token);
}

async function main() {
  logger.info('Starting Southern Gaming bot…');

  let started = false;
  let lastErr;
  for (const tier of TIERS) {
    try {
      await startWith(tier.intents);
      if (tier.note) logger.warn(tier.note);
      started = true;
      break;
    } catch (err) {
      lastErr = err;
      // Only fall back on a privileged-intent rejection; anything else is a real error.
      if (/disallowed intents|privileged intent/i.test(err?.message || '')) {
        try {
          client?.destroy();
        } catch {
          /* ignore */
        }
        continue;
      }
      throw err;
    }
  }
  if (!started) throw lastErr ?? new Error('Failed to start the client.');

  // Auto-mod strike decay (daily). Harmless even if the content intent is off.
  startStrikeDecay();
}

// ── Global safety nets ────────────────────────────────────────────────────────
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection:', reason?.stack || reason);
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception:', err.stack || err.message);
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
function shutdown(signal) {
  logger.info(`Received ${signal}, shutting down gracefully…`);
  stopAutomation();
  stopStatusRotation();
  stopTicketSweeper();
  stopGiveawaySweeper();
  stopStrikeDecay();
  closeDatabase();
  closeAutomodDatabase();
  client?.destroy();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

main().catch((err) => {
  logger.error('Fatal startup error:', err.stack || err.message);
  process.exit(1);
});
