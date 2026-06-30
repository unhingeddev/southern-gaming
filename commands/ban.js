// commands/ban.js
// Ban a user from the server. Requires the "Ban Members" permission, enforces
// role hierarchy (when the target is a member), supports banning by ID for users
// not currently in the server, can purge recent messages, DMs the user (best
// effort), and writes to the audit log.

import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import Embeds from '../utils/embeds.js';
import { audit } from '../utils/audit.js';
import { checkHierarchy, tryNotifyUser, botHasPermission } from '../utils/moderation.js';
import logger from '../utils/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a user from the server.')
    .addUserOption((o) =>
      o.setName('user').setDescription('The user to ban (works by ID even if not in the server)').setRequired(true)
    )
    .addStringOption((o) =>
      o.setName('reason').setDescription('Reason for the ban').setMaxLength(400)
    )
    .addIntegerOption((o) =>
      o
        .setName('delete_days')
        .setDescription("Delete this many days of the user's recent messages (0-7)")
        .setMinValue(0)
        .setMaxValue(7)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setDMPermission(false),

  async execute(interaction) {
    const user = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason')?.trim() || 'No reason provided';
    const deleteDays = interaction.options.getInteger('delete_days') ?? 0;

    // The bot needs the permission itself.
    if (!botHasPermission(interaction, PermissionFlagsBits.BanMembers)) {
      return interaction.reply({
        embeds: [Embeds.error('Missing permission', 'I need the **Ban Members** permission.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    // Guard against double-banning.
    const existing = await interaction.guild.bans.fetch(user.id).catch(() => null);
    if (existing) {
      return interaction.reply({
        embeds: [Embeds.warning('Already banned', `**${user.tag}** is already banned.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    // If the target is currently a member, enforce hierarchy + bannable checks.
    // If not a member, we allow a ban-by-ID (no role comparison possible).
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (member) {
      const check = checkHierarchy(interaction, member, 'ban');
      if (!check.ok) {
        return interaction.reply({
          embeds: [Embeds.error('Cannot ban', check.reason)],
          flags: MessageFlags.Ephemeral,
        });
      }
      if (!member.bannable) {
        return interaction.reply({
          embeds: [Embeds.error('Cannot ban', 'I am not able to ban that member.')],
          flags: MessageFlags.Ephemeral,
        });
      }
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Notify the user before banning (only possible if they're still reachable).
    const dmed = member ? await tryNotifyUser(user, interaction.guild.name, 'banned', reason) : false;

    try {
      await interaction.guild.members.ban(user.id, {
        reason: `${reason} • by ${interaction.user.tag} (${interaction.user.id})`,
        deleteMessageSeconds: deleteDays * 24 * 60 * 60,
      });
    } catch (err) {
      logger.error(`Ban failed for ${user.id}: ${err.message}`);
      return interaction.editReply({
        embeds: [Embeds.error('Ban failed', err.message)],
      });
    }

    await audit(
      interaction,
      'Member Banned',
      `**${user.tag}** (\`${user.id}\`) was banned.\n**Reason:** ${reason}` +
        (deleteDays ? `\n**Purged:** ${deleteDays} day(s) of messages` : '')
    );

    return interaction.editReply({
      embeds: [
        Embeds.success(
          'Member banned',
          `**${user.tag}** has been banned.\n**Reason:** ${reason}` +
            (deleteDays ? `\n🧹 Deleted ${deleteDays} day(s) of their messages.` : '') +
            (member && !dmed ? '\n_(Could not DM the user.)_' : '')
        ),
      ],
    });
  },
};
