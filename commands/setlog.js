// commands/setlog.js
// Set the channel for a given log type (leave | ban | kick | embed). Manage Server.

import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } from 'discord.js';
import { Store } from '../database/db.js';
import Embeds from '../utils/embeds.js';
import { audit } from '../utils/audit.js';
import { LOG_TYPES } from '../utils/eventLog.js';

export default {
  data: new SlashCommandBuilder()
    .setName('setlog')
    .setDescription('Set a channel: leave/ban/kick/embed/join logs, or joinping (announcements ghost-ping).')
    .addStringOption((o) =>
      o.setName('type').setDescription('Which log to configure').setRequired(true)
        .addChoices(...LOG_TYPES.map((t) => ({ name: t, value: t })))
    )
    .addChannelOption((o) =>
      o.setName('channel').setDescription('Channel to post these logs in').setRequired(true)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  async execute(interaction) {
    const type = interaction.options.getString('type', true);
    const channel = interaction.options.getChannel('channel', true);
    Store.setEventLog(interaction.guildId, type, channel.id);
    await audit(interaction, 'Log Channel Set', `**${type}** logs → <#${channel.id}>.`);
    return interaction.reply({
      embeds: [Embeds.success('Log channel set', `**${type}** events will be logged to <#${channel.id}>.`)],
      flags: MessageFlags.Ephemeral,
    });
  },
};
