// handlers/commandHandler.js
// Dynamically loads every command module from /commands into a Collection on the
// client. Each command module must export { data, execute } where `data` is a
// SlashCommandBuilder and `execute(interaction, ctx)` runs the command.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Collection, REST, Routes } from 'discord.js';
import config from '../config/config.js';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMMANDS_DIR = path.join(__dirname, '..', 'commands');

/**
 * Load all commands into client.commands.
 * @param {import('discord.js').Client} client
 * @returns {Promise<Collection>}
 */
export async function loadCommands(client) {
  client.commands = new Collection();

  const files = fs.readdirSync(COMMANDS_DIR).filter((f) => f.endsWith('.js'));
  for (const file of files) {
    const fileUrl = pathToFileURL(path.join(COMMANDS_DIR, file)).href;
    // Cache-bust so /reload picks up edits without restarting the process.
    const mod = await import(`${fileUrl}?t=${Date.now()}`);
    const command = mod.default ?? mod;

    if (!command?.data || typeof command.execute !== 'function') {
      logger.warn(`Skipping invalid command file: ${file}`);
      continue;
    }
    client.commands.set(command.data.name, command);
    logger.debug(`Loaded command: /${command.data.name}`);
  }

  logger.info(`Loaded ${client.commands.size} commands.`);
  return client.commands;
}

/** Return the raw JSON payloads for registering with Discord. */
export function collectCommandData(commands) {
  return [...commands.values()].map((c) => c.data.toJSON());
}

/**
 * Register this client's commands to a single guild (instant, unlike global).
 * Throws on failure so callers can decide how loud to be.
 * @param {import('discord.js').Client} client
 * @param {string} guildId
 * @returns {Promise<number>} number of commands registered
 */
export async function registerGuildCommands(client, guildId) {
  const body = collectCommandData(client.commands);
  const rest = new REST({ version: '10' }).setToken(config.discord.token);
  await rest.put(Routes.applicationGuildCommands(config.discord.clientId, guildId), { body });
  return body.length;
}

/**
 * Register commands to EVERY guild the bot is currently in. Runs on startup so
 * slash commands always show up without a manual deploy. Per-guild = instant.
 * A 403/Missing Access for a guild usually means the bot was invited without the
 * `applications.commands` scope there — re-invite with that scope to fix it.
 * @param {import('discord.js').Client} client
 */
export async function syncAllGuildCommands(client) {
  let ok = 0;
  for (const [guildId, guild] of client.guilds.cache) {
    try {
      const n = await registerGuildCommands(client, guildId);
      ok++;
      logger.info(`Registered ${n} command(s) to "${guild.name}" (${guildId}).`);
    } catch (err) {
      logger.warn(
        `Could not register commands to ${guildId}: ${err.message}. ` +
          `If this is "Missing Access", re-invite the bot using the applications.commands scope.`
      );
    }
  }
  logger.info(`Command sync complete: ${ok}/${client.guilds.cache.size} guild(s).`);
}
