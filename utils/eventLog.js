// utils/eventLog.js
// Sends an embed to a guild's configured per-event log channel (leave/ban/kick/
// embed). No-ops silently when that log type isn't configured.

import { Store } from '../database/db.js';
import logger from './logger.js';

// 'join'       → join-log embed channel
// 'joinping'   → announcements channel where new members are ghost-pinged on join
// 'transcript' → where ticket transcripts (HTML conversation logs) are posted
export const LOG_TYPES = ['leave', 'ban', 'kick', 'embed', 'join', 'joinping', 'transcript'];

/**
 * @param {import('discord.js').Client} client
 * @param {string} guildId
 * @param {'leave'|'ban'|'kick'|'embed'|'join'|'joinping'} type
 * @param {import('discord.js').EmbedBuilder} embed
 */
export async function sendEventLog(client, guildId, type, embed) {
  try {
    const channelId = Store.getEventLog(guildId, type);
    if (!channelId) return;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased?.()) return;
    await channel.send({ embeds: [embed] });
  } catch (err) {
    logger.warn(`Event log (${type}) failed for guild ${guildId}: ${err.message}`);
  }
}
