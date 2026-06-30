// deploy-commands.js
// Registers (or clears) slash commands with Discord's API.
//
// Per-guild registration is INSTANT (no waiting); global registration can take
// up to an hour to propagate. For a bot in just a couple of servers, per-guild
// is the better choice — so this script targets the test guild by default.
//
// Usage:
//   node deploy-commands.js                 # → test guild (DISCORD_GUILD_ID)
//   node deploy-commands.js --live          # → live guild (DISCORD_LIVE_GUILD_ID)
//   node deploy-commands.js --all           # → both test + live guilds
//   node deploy-commands.js --guild <id>    # → a specific guild
//   node deploy-commands.js --global        # → global (all servers, ~1h delay)
//   add --clear to any of the above to REMOVE commands from that target instead.
//
// npm shortcuts:  npm run deploy | deploy:live | deploy:all | clear:global

import { REST, Routes, Collection } from 'discord.js';
import config from './config/config.js';
import logger from './utils/logger.js';
import { loadCommands, collectCommandData } from './handlers/commandHandler.js';

const args = process.argv.slice(2);
const clear = args.includes('--clear');
const useGlobal = args.includes('--global');
const useAll = args.includes('--all');
const useLive = args.includes('--live');
const guildIdx = args.indexOf('--guild');
const explicitGuild = guildIdx !== -1 ? args[guildIdx + 1] : null;

/** Work out which guild IDs (if any) to target. Empty list + global=false is an error. */
function resolveGuildTargets() {
  if (useGlobal) return [];
  if (explicitGuild) return [explicitGuild];
  if (useAll) return [config.discord.guildId, config.discord.liveGuildId].filter(Boolean);
  if (useLive) return config.discord.liveGuildId ? [config.discord.liveGuildId] : [];
  // Default: the test guild, or fall back to global if it isn't configured.
  return config.discord.guildId ? [config.discord.guildId] : [];
}

async function run() {
  // Load command definitions via a throwaway client-like object.
  const fakeClient = { commands: new Collection() };
  await loadCommands(fakeClient);
  const body = clear ? [] : collectCommandData(fakeClient.commands);

  const rest = new REST({ version: '10' }).setToken(config.discord.token);
  const verb = clear ? 'Clearing' : 'Registering';
  const targets = resolveGuildTargets();

  try {
    if (useGlobal || (targets.length === 0 && !config.discord.guildId)) {
      logger.info(`${verb} ${body.length} command(s) globally…`);
      await rest.put(Routes.applicationCommands(config.discord.clientId), { body });
      logger.info('Global registration complete (may take up to 1 hour to appear).');
      return;
    }

    if (targets.length === 0) {
      logger.error('No target guild resolved. Set DISCORD_GUILD_ID / DISCORD_LIVE_GUILD_ID or pass --guild <id> / --global.');
      process.exit(1);
    }

    for (const guildId of targets) {
      logger.info(`${verb} ${body.length} command(s) to guild ${guildId}…`);
      await rest.put(Routes.applicationGuildCommands(config.discord.clientId, guildId), { body });
      logger.info(`Done for guild ${guildId} (changes are instant).`);
    }
  } catch (err) {
    logger.error('Command registration failed:', err.stack || err.message);
    process.exit(1);
  }
}

run();
