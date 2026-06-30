// handlers/eventHandler.js
// Dynamically wires up every event module from /events. Each module exports
// { name, once?, execute }. `execute` receives the event args followed by the
// shared context object (so events can reach the client, Store, etc.).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVENTS_DIR = path.join(__dirname, '..', 'events');

/**
 * @param {import('discord.js').Client} client
 * @param {object} ctx Shared context passed to every event handler.
 */
export async function loadEvents(client, ctx) {
  const files = fs.readdirSync(EVENTS_DIR).filter((f) => f.endsWith('.js'));
  for (const file of files) {
    const fileUrl = pathToFileURL(path.join(EVENTS_DIR, file)).href;
    const mod = await import(fileUrl);
    const event = mod.default ?? mod;

    if (!event?.name || typeof event.execute !== 'function') {
      logger.warn(`Skipping invalid event file: ${file}`);
      continue;
    }

    const handler = (...args) => event.execute(...args, ctx);
    if (event.once) client.once(event.name, handler);
    else client.on(event.name, handler);

    logger.debug(`Registered event: ${event.name}`);
  }
  logger.info(`Loaded ${files.length} events.`);
}
