// utils/audit.js
// Helper to mirror important actions (config changes, /nuke, automation toggles)
// into a guild's configured log channel, plus the file logger. This gives admins
// a clear, attributable trail of "who did what, when".

import { Store } from '../database/db.js';
import Embeds from './embeds.js';
import logger from './logger.js';

/**
 * @param {import('discord.js').Interaction} interaction
 * @param {string} action  Short action label, e.g. "Channel Nuked".
 * @param {string} details Human-readable detail line.
 * @param {number} [color]
 */
export async function audit(interaction, action, details, color) {
  const userTag = `${interaction.user.tag} (${interaction.user.id})`;
  logger.info(`AUDIT [${interaction.guildId}] ${action} by ${userTag} — ${details}`);

  try {
    const settings = Store.getGuild(interaction.guildId);
    if (!settings?.log_channel_id) return;
    const channel = await interaction.client.channels.fetch(settings.log_channel_id).catch(() => null);
    if (!channel?.isTextBased?.()) return;

    const embed = Embeds.info(`📋 ${action}`, details).addFields(
      { name: 'Executed by', value: `<@${interaction.user.id}>`, inline: true },
      { name: 'Channel', value: `<#${interaction.channelId}>`, inline: true }
    );
    // Only override the default (brand) colour when one is explicitly passed —
    // setColor(undefined) throws a validation error ("Received one or more errors").
    if (color !== undefined && color !== null) embed.setColor(color);
    await channel.send({ embeds: [embed] });
  } catch (err) {
    logger.warn(`Failed to write audit log: ${err.message}`);
  }
}
