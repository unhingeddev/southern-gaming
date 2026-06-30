// services/statusRotator.js
// Cycles the bot's presence through the list of statuses stored in the database.
// Each status can specify its OWN display duration (seconds); the scheduler
// re-arms itself after each status using that status's duration, so a status set
// to show for 10s and another for 60s rotate at their own pace. Statuses are
// re-read from the DB every tick, so anything added via /statusadd shows up on
// the next rotation without a restart.
//
// Supported placeholders in status text:
//   {servers} / {guilds} → number of servers the bot is in
//   {users}              → total cached members across servers
//   {ping}               → websocket latency in ms

import { ActivityType } from 'discord.js';
import { Store } from '../database/db.js';
import logger from '../utils/logger.js';
import config from '../config/config.js';

let timeout = null; // pending setTimeout handle for the next rotation
let index = 0;

// Map our stored type strings to discord.js ActivityType enum values.
const TYPE_MAP = {
  Playing: ActivityType.Playing,
  Listening: ActivityType.Listening,
  Watching: ActivityType.Watching,
  Competing: ActivityType.Competing,
  Custom: ActivityType.Custom,
};

const VALID_PRESENCE = new Set(['online', 'idle', 'dnd']);
const MIN_DURATION = 5; // floor so a typo can't spin the rotation too fast

/** Expand placeholders in a status string using live client stats. */
function render(text, client) {
  const servers = client.guilds.cache.size;
  const users = client.guilds.cache.reduce((sum, g) => sum + (g.memberCount || 0), 0);
  const ping = Math.max(0, Math.round(client.ws.ping));
  return String(text)
    .replaceAll('{servers}', String(servers))
    .replaceAll('{guilds}', String(servers))
    .replaceAll('{users}', String(users))
    .replaceAll('{ping}', String(ping));
}

/** Apply a single status row to the client's presence. */
function apply(client, row) {
  const type = TYPE_MAP[row.type] ?? ActivityType.Watching;
  const name = render(row.text, client);
  const status = VALID_PRESENCE.has(row.presence) ? row.presence : 'online';

  // Custom-type activities render as just the text (no "Playing" prefix) and
  // require the `state` field to be set.
  const activity =
    type === ActivityType.Custom
      ? { name: 'custom', type, state: name }
      : { name, type };

  client.user.setPresence({ activities: [activity], status });
}

/** Resolve a status's display duration (seconds), with sane fallbacks. */
function durationOf(row) {
  const fallback = Math.max(MIN_DURATION, config.bot.statusRotateSeconds);
  const d = Number(row?.duration);
  return Number.isFinite(d) && d >= MIN_DURATION ? d : fallback;
}

/**
 * Apply the next status and return how many seconds it should stay up before
 * the following rotation.
 * @returns {number} seconds until next rotation
 */
function tick(client) {
  const statuses = Store.getStatuses();
  if (!statuses.length) {
    // Fall back to a sensible default if the admin removed everything.
    const fallback = { text: '/help', type: 'Watching', presence: 'online' };
    apply(client, fallback);
    return durationOf(fallback);
  }
  if (index >= statuses.length) index = 0;
  const current = statuses[index];
  apply(client, current);
  index = (index + 1) % statuses.length;
  return durationOf(current);
}

/** Run one tick and schedule the next based on the shown status's duration. */
function loop(client) {
  let seconds;
  try {
    seconds = tick(client);
  } catch (err) {
    logger.warn(`Status rotation error: ${err.message}`);
    seconds = Math.max(MIN_DURATION, config.bot.statusRotateSeconds);
  }
  timeout = setTimeout(() => loop(client), seconds * 1000);
  timeout.unref?.();
}

/**
 * Start rotating statuses. Seeds a couple of defaults on first run so the bot
 * always has something to show. Safe to call once after the client is ready.
 * @param {import('discord.js').Client} client
 */
export function startStatusRotation(client) {
  if (timeout) return;

  // Seed defaults only if the table is empty (first ever boot).
  if (Store.countStatuses() === 0) {
    Store.addStatus('/help', 'Watching', 'online', 30, 'system');
    Store.addStatus('{servers} servers', 'Watching', 'online', 30, 'system');
    logger.info('Seeded default rotating statuses.');
  }

  logger.info('Status rotator starting (per-status durations).');
  loop(client); // apply immediately and self-schedule
}

/**
 * Immediately refresh presence (e.g. right after /statusadd): cancel the pending
 * timer, show the next status now, and re-arm from here.
 */
export function refreshStatusNow(client) {
  if (timeout) {
    clearTimeout(timeout);
    timeout = null;
  }
  loop(client);
}

/** Stop the rotator (used on shutdown). */
export function stopStatusRotation() {
  if (timeout) {
    clearTimeout(timeout);
    timeout = null;
    logger.info('Status rotator stopped.');
  }
}
