// commands/kick.js
// Kick a member from the server. Requires the "Kick Members" permission, enforces
// role hierarchy, DMs the user (best effort), and writes to the audit log.

import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import Embeds from '../utils/embeds.js';
import { audit } from '../utils/audit.js';
import { checkHierarchy, tryNotifyUser, botHasPermission } from '../utils/moderation.js';
import { sendEventLog } from '../utils/eventLog.js';
import { COLORS } from '../utils/embeds.js';
import logger from '../utils/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member from the server.')
    .addUserOption((o) =>
      o.setName('user').setDescription('The member to kick').setRequired(true)
    )
    .addStringOption((o) =>
      o.setName('reason').setDescription('Reason for the kick').setMaxLength(400)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .setDMPermission(false),

  async execute(interaction) {
    const user = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason')?.trim() || 'No reason provided';

    // The bot needs the permission itself.
    if (!botHasPermission(interaction, PermissionFlagsBits.KickMembers)) {
      return interaction.reply({
        embeds: [Embeds.error('Missing permission', 'I need the **Kick Members** permission.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    // Target must currently be in the server.
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) {
      return interaction.reply({
        embeds: [Embeds.error('Not found', 'That user is not a member of this server.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    // Role hierarchy / self-target / owner checks.
    const check = checkHierarchy(interaction, member, 'kick');
    if (!check.ok) {
      return interaction.reply({
        embeds: [Embeds.error('Cannot kick', check.reason)],
        flags: MessageFlags.Ephemeral,
      });
    }
    if (!member.kickable) {
      return interaction.reply({
        embeds: [Embeds.error('Cannot kick', 'I am not able to kick that member.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Notify the user before removing them (they can't be DMed after leaving).
    const dmed = await tryNotifyUser(user, interaction.guild.name, 'kicked', reason);

    try {
      await member.kick(`${reason} • by ${interaction.user.tag} (${interaction.user.id})`);
    } catch (err) {
      logger.error(`Kick failed for ${user.id}: ${err.message}`);
      return interaction.editReply({
        embeds: [Embeds.error('Kick failed', err.message)],
      });
    }

    await audit(
      interaction,
      'Member Kicked',
      `**${user.tag}** (\`${user.id}\`) was kicked.\n**Reason:** ${reason}`
    );

    // Post to the "kick" event-log channel if configured.
    await sendEventLog(
      interaction.client,
      interaction.guildId,
      'kick',
      Embeds.warning('Member kicked', `**${user.tag}** (\`${user.id}\`)`)
        .setColor(COLORS.warning)
        .addFields(
          { name: 'Reason', value: reason, inline: false },
          { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true }
        )
    );

    return interaction.editReply({
      embeds: [
        Embeds.success(
          'Member kicked',
          `**${user.tag}** has been kicked.\n**Reason:** ${reason}` +
            (dmed ? '' : '\n_(Could not DM the user.)_')
        ),
      ],
    });
  },
};
