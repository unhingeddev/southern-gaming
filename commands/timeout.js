// commands/timeout.js
// Temporarily time out (mute) a member using Discord's built-in communication
// timeout. Requires "Moderate Members", enforces role hierarchy, and audits.
// Choosing "Remove timeout" clears an active timeout.

import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import Embeds from '../utils/embeds.js';
import { audit } from '../utils/audit.js';
import { checkHierarchy, tryNotifyUser, botHasPermission } from '../utils/moderation.js';
import logger from '../utils/logger.js';

// Preset durations (label → seconds). 0 means "remove timeout".
// Discord caps timeouts at 28 days.
const DURATIONS = {
  '60s': 60,
  '5m': 5 * 60,
  '10m': 10 * 60,
  '30m': 30 * 60,
  '1h': 60 * 60,
  '6h': 6 * 60 * 60,
  '12h': 12 * 60 * 60,
  '1d': 24 * 60 * 60,
  '3d': 3 * 24 * 60 * 60,
  '1w': 7 * 24 * 60 * 60,
};

export default {
  data: new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Time out (mute) a member for a set duration, or clear it.')
    .addUserOption((o) =>
      o.setName('user').setDescription('The member to time out').setRequired(true)
    )
    .addStringOption((o) =>
      o
        .setName('duration')
        .setDescription('How long to time them out for')
        .setRequired(true)
        .addChoices(
          { name: '60 seconds', value: '60s' },
          { name: '5 minutes', value: '5m' },
          { name: '10 minutes', value: '10m' },
          { name: '30 minutes', value: '30m' },
          { name: '1 hour', value: '1h' },
          { name: '6 hours', value: '6h' },
          { name: '12 hours', value: '12h' },
          { name: '1 day', value: '1d' },
          { name: '3 days', value: '3d' },
          { name: '1 week', value: '1w' },
          { name: 'Remove timeout', value: '0' }
        )
    )
    .addStringOption((o) =>
      o.setName('reason').setDescription('Reason for the timeout').setMaxLength(400)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false),

  async execute(interaction) {
    const user = interaction.options.getUser('user', true);
    const durationKey = interaction.options.getString('duration', true);
    const reason = interaction.options.getString('reason')?.trim() || 'No reason provided';
    const isRemoval = durationKey === '0';
    const seconds = DURATIONS[durationKey] ?? 0;

    if (!botHasPermission(interaction, PermissionFlagsBits.ModerateMembers)) {
      return interaction.reply({
        embeds: [Embeds.error('Missing permission', 'I need the **Timeout Members** permission.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) {
      return interaction.reply({
        embeds: [Embeds.error('Not found', 'That user is not a member of this server.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    // Role hierarchy / self-target / owner checks.
    const check = checkHierarchy(interaction, member, isRemoval ? 'untime' : 'time out');
    if (!check.ok) {
      return interaction.reply({
        embeds: [Embeds.error('Cannot time out', check.reason)],
        flags: MessageFlags.Ephemeral,
      });
    }
    if (!member.moderatable) {
      return interaction.reply({
        embeds: [Embeds.error('Cannot time out', 'I am not able to time out that member.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    // Handle removal separately.
    if (isRemoval) {
      if (!member.isCommunicationDisabled()) {
        return interaction.reply({
          embeds: [Embeds.info('Not timed out', `**${user.tag}** is not currently timed out.`)],
          flags: MessageFlags.Ephemeral,
        });
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        await member.timeout(null, `Timeout removed by ${interaction.user.tag}`);
      } catch (err) {
        logger.error(`Timeout removal failed for ${user.id}: ${err.message}`);
        return interaction.editReply({ embeds: [Embeds.error('Failed', err.message)] });
      }
      await audit(interaction, 'Timeout Removed', `**${user.tag}** (\`${user.id}\`) had their timeout cleared.`);
      return interaction.editReply({
        embeds: [Embeds.success('Timeout removed', `**${user.tag}** can chat again.`)],
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const label = labelFor(durationKey);
    const dmed = await tryNotifyUser(user, interaction.guild.name, 'timed out', `${reason} (Duration: ${label})`);

    try {
      await member.timeout(seconds * 1000, `${reason} • by ${interaction.user.tag} (${interaction.user.id})`);
    } catch (err) {
      logger.error(`Timeout failed for ${user.id}: ${err.message}`);
      return interaction.editReply({ embeds: [Embeds.error('Timeout failed', err.message)] });
    }

    // Discord renders <t:unix:R> as a live "in X minutes" relative timestamp.
    const expiresUnix = Math.floor((Date.now() + seconds * 1000) / 1000);
    await audit(
      interaction,
      'Member Timed Out',
      `**${user.tag}** (\`${user.id}\`) was timed out for **${label}**.\n**Reason:** ${reason}`
    );

    return interaction.editReply({
      embeds: [
        Embeds.success(
          'Member timed out',
          `**${user.tag}** has been timed out for **${label}** ` +
            `(expires <t:${expiresUnix}:R>).\n**Reason:** ${reason}` +
            (dmed ? '' : '\n_(Could not DM the user.)_')
        ),
      ],
    });
  },
};

/** Friendly label for a duration key. */
function labelFor(key) {
  const map = {
    '60s': '60 seconds',
    '5m': '5 minutes',
    '10m': '10 minutes',
    '30m': '30 minutes',
    '1h': '1 hour',
    '6h': '6 hours',
    '12h': '12 hours',
    '1d': '1 day',
    '3d': '3 days',
    '1w': '1 week',
  };
  return map[key] ?? key;
}
