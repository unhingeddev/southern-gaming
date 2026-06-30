// handlers/commandHandler.js
// Dynamically loads every command module from /commands into a Collection on the
// client. Each command module must export { data, execute } where `data` is a
// SlashCommandBuilder and `execute(interaction, ctx)` runs the command.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Collection } from 'discord.js';
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
