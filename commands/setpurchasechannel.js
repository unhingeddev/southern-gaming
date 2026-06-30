// commands/setpurchasechannel.js
// Configure which channel recent purchases get auto-posted to. Admin only.

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
    .setName('setpurchasechannel')
    .setDescription('Set the channel where recent purchases are posted.')
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
    Store.setPurchaseChannel(interaction.guildId, channel.id);
    await audit(interaction, 'Purchase Channel Set', `Purchases will post to <#${channel.id}>.`);

    return interaction.reply({
      embeds: [
        Embeds.success(
          'Purchase channel set',
          `Recent purchases will be posted to <#${channel.id}>.\n` +
            `Use \`/startpurchases\` to begin automatic posting.`
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  },
};
