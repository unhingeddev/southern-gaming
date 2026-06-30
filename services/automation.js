// services/automation.js
// Background poller that periodically checks SellAuth for new vouches and
// purchases, then posts any *new* ones into the configured channels. Duplicate
// prevention is handled via the posted_items table in the database.

import { Store } from '../database/db.js';
import { clientForGuild, SellAuthError } from './sellauth.js';
import Embeds from '../utils/embeds.js';
import logger from '../utils/logger.js';
import config from '../config/config.js';

let timer = null;
let running = false; // guards against overlapping polls if one run is slow

/**
 * Post any new items of a given kind for a single guild.
 * @param {import('discord.js').Client} client
 * @param {object} guild Row from guild_settings.
 * @param {'vouch'|'purchase'} kind
 */
async function processGuildKind(client, guild, kind) {
  const enabled = kind === 'vouch' ? guild.vouches_enabled : guild.purchases_enabled;
  const channelId = kind === 'vouch' ? guild.vouch_channel_id : guild.purchase_channel_id;
  if (!enabled || !channelId) return;

  const sa = clientForGuild(Store, guild.guild_id);
  if (!sa) {
    logger.debug(`[${guild.guild_id}] ${kind}: no API key configured, skipping.`);
    return;
  }

  // Resolve the target channel; if it's gone, skip quietly.
  let channel;
  try {
    channel = await client.channels.fetch(channelId);
  } catch {
    logger.warn(`[${guild.guild_id}] ${kind} channel ${channelId} not found.`);
    return;
  }
  if (!channel?.isTextBased?.()) return;

  // Fetch latest items.
  let items;
  try {
    items = kind === 'vouch' ? await sa.getVouches(10) : await sa.getRecentPurchases(10);
  } catch (err) {
    const msg = err instanceof SellAuthError ? err.message : String(err);
    logger.warn(`[${guild.guild_id}] ${kind} fetch failed: ${msg}`);
    return; // graceful — try again next cycle
  }

  // Post oldest-first so the channel reads chronologically. Only new IDs.
  for (const item of items.reverse()) {
    if (Store.hasPosted(guild.guild_id, kind, item.id)) continue;
    try {
      const embed = kind === 'vouch' ? Embeds.vouch(item) : Embeds.purchase(item);
      await channel.send({ embeds: [embed] });
      Store.markPosted(guild.guild_id, kind, item.id);
      logger.info(`[${guild.guild_id}] Posted ${kind} ${item.id}.`);
    } catch (err) {
      logger.error(`[${guild.guild_id}] Failed to post ${kind} ${item.id}: ${err.message}`);
      // Don't mark as posted so we can retry next cycle.
    }
  }
}

/** One full polling cycle across all configured guilds. */
async function pollOnce(client) {
  if (running) {
    logger.debug('Automation poll already running; skipping overlap.');
    return;
  }
  running = true;
  try {
    const guilds = Store.getAllGuilds();
    for (const guild of guilds) {
      await processGuildKind(client, guild, 'vouch');
      await processGuildKind(client, guild, 'purchase');
    }
  } catch (err) {
    logger.error('Automation poll cycle error:', err.message);
  } finally {
    running = false;
  }
}

/**
 * Start the automation poller. Safe to call once after the client is ready.
 * @param {import('discord.js').Client} client
 */
export function startAutomation(client) {
  if (timer) return; // already started
  const intervalMs = Math.max(30, config.bot.pollIntervalSeconds) * 1000;
  logger.info(`Automation poller starting (every ${intervalMs / 1000}s).`);

  // Seed dedupe on first run so we don't spam the channel with the entire backlog.
  seedExistingItems(client).finally(() => {
    timer = setInterval(() => pollOnce(client), intervalMs);
    timer.unref?.();
  });
}

/**
 * On first boot for a guild that has automation enabled, mark all *current*
 * items as already-posted so only genuinely new items get announced going
 * forward. Without this, enabling automation would dump the whole history.
 */
async function seedExistingItems(client) {
  const guilds = Store.getAllGuilds();
  for (const guild of guilds) {
    const sa = clientForGuild(Store, guild.guild_id);
    if (!sa) continue;
    try {
      if (guild.vouches_enabled && guild.vouch_channel_id) {
        for (const v of await sa.getVouches(10)) {
          if (!Store.hasPosted(guild.guild_id, 'vouch', v.id))
            Store.markPosted(guild.guild_id, 'vouch', v.id);
        }
      }
      if (guild.purchases_enabled && guild.purchase_channel_id) {
        for (const p of await sa.getRecentPurchases(10)) {
          if (!Store.hasPosted(guild.guild_id, 'purchase', p.id))
            Store.markPosted(guild.guild_id, 'purchase', p.id);
        }
      }
    } catch {
      /* ignore seeding errors; normal polling will handle it */
    }
  }
}

/** Stop the poller (used on shutdown). */
export function stopAutomation() {
  if (timer) {
    clearInterval(timer);
    timer = null;
    logger.info('Automation poller stopped.');
  }
}
