// commands/setlogchannel.js
// Configure the audit-log channel where sensitive actions are recorded. Admin only.

import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
} from 'discord.js';
import { Store } from '../database/db.js';
import Embeds from '../utils/embeds.js';
import { audit } from '../utils/audit.js';

export default {
  data: new SlashCommandBuilder()
    .setName('setlogchannel')
    .setDescription('Set the channel where bot audit logs are posted.')
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('Target text channel')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  async execute(interaction) {
    const channel = interaction.options.getChannel('channel', true);
    Store.setLogChannel(interaction.guildId, channel.id);
    // This audit call will now also land in the newly-set channel.
    await audit(interaction, 'Log Channel Set', `Audit logs will post to <#${channel.id}>.`);

    return interaction.reply({
      embeds: [
        Embeds.success('Log channel set', `Audit logs will now be posted to <#${channel.id}>.`),
      ],
      flags: MessageFlags.Ephemeral,
    });
  },
};
