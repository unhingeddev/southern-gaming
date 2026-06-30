// commands/unban.js
// Lift a ban by user ID. Requires "Ban Members". Because a banned user isn't in
// the server (and often can't be picked from a user list), this takes a raw user
// ID string. Validates the ID, confirms a ban exists, then removes it. Audited.

import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import Embeds from '../utils/embeds.js';
import { audit } from '../utils/audit.js';
import { botHasPermission } from '../utils/moderation.js';
import logger from '../utils/logger.js';

const SNOWFLAKE = /^\d{17,20}$/;

export default {
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Remove a ban by user ID.')
    .addStringOption((o) =>
      o.setName('user_id').setDescription('The ID of the banned user').setRequired(true)
    )
    .addStringOption((o) =>
      o.setName('reason').setDescription('Reason for the unban').setMaxLength(400)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setDMPermission(false),

  async execute(interaction) {
    const userId = interaction.options.getString('user_id', true).trim();
    const reason = interaction.options.getString('reason')?.trim() || 'No reason provided';

    if (!SNOWFLAKE.test(userId)) {
      return interaction.reply({
        embeds: [Embeds.error('Invalid ID', 'Please provide a valid user ID (17–20 digits).')],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (!botHasPermission(interaction, PermissionFlagsBits.BanMembers)) {
      return interaction.reply({
        embeds: [Embeds.error('Missing permission', 'I need the **Ban Members** permission.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Confirm the user is actually banned before attempting to unban.
    const ban = await interaction.guild.bans.fetch(userId).catch(() => null);
    if (!ban) {
      return interaction.editReply({
        embeds: [Embeds.warning('Not banned', 'That user is not currently banned in this server.')],
      });
    }

    try {
      await interaction.guild.members.unban(userId, `${reason} • by ${interaction.user.tag} (${interaction.user.id})`);
    } catch (err) {
      logger.error(`Unban failed for ${userId}: ${err.message}`);
      return interaction.editReply({ embeds: [Embeds.error('Unban failed', err.message)] });
    }

    const tag = ban.user?.tag ?? userId;
    await audit(interaction, 'Member Unbanned', `**${tag}** (\`${userId}\`) was unbanned.\n**Reason:** ${reason}`);

    return interaction.editReply({
      embeds: [Embeds.success('User unbanned', `**${tag}** has been unbanned.\n**Reason:** ${reason}`)],
    });
  },
};
