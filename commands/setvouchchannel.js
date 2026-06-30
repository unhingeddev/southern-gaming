// commands/setvouchchannel.js
// Configure which channel new vouches/reviews get auto-posted to. Admin only.

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
    .setName('setvouchchannel')
    .setDescription('Set the channel where new vouches are posted.')
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
    Store.setVouchChannel(interaction.guildId, channel.id);
    await audit(interaction, 'Vouch Channel Set', `Vouches will post to <#${channel.id}>.`);

    return interaction.reply({
      embeds: [
        Embeds.success(
          'Vouch channel set',
          `New vouches will be posted to <#${channel.id}>.\n` +
            `Use \`/startvouches\` to begin automatic posting.`
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  },
};
