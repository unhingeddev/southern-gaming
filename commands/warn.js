// commands/warn.js  (auto-mod system)
// /warn <user> <reason> — manual strike, runs the same escalation pipeline.

import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import Embeds from '../utils/embeds.js';
import { canModerate } from '../automod/permissions.js';
import { applyStrike } from '../automod/strikeSystem.js';

export default {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Issue a manual warning/strike to a member.')
    .setDMPermission(false)
    .addUserOption((o) => o.setName('user').setDescription('Member to warn').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(true).setMaxLength(500)),

  async execute(interaction) {
    if (!canModerate(interaction)) {
      return interaction.reply({
        embeds: [Embeds.error('No permission', 'You need to be **Owner / Co-Owner / Staff** (or a server admin) to use this.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const user = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason', true).trim();

    if (user.bot) return interaction.reply({ embeds: [Embeds.error('Invalid target', 'You cannot warn a bot.')], flags: MessageFlags.Ephemeral });
    if (user.id === interaction.user.id) return interaction.reply({ embeds: [Embeds.error('Invalid target', 'You cannot warn yourself.')], flags: MessageFlags.Ephemeral });

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    const result = await applyStrike(interaction.client, {
      guild: interaction.guild,
      member,
      user,
      rule: 'Manual warning',
      reason,
      redact: false,
      channelId: interaction.channelId,
      moderator: interaction.user.tag,
      moderatorId: interaction.user.id,
    });

    const verb = result.action === 'ban' ? 'banned' : result.action === 'timeout' ? 'timed out' : 'warned';
    return interaction.editReply({
      embeds: [
        Embeds.success(
          'Warning issued',
          `**${user.tag}** has been **${verb}** — now at **strike ${result.count}/4**.\n**Reason:** ${reason}` +
            (result.dmOk ? '' : '\n_(Could not DM the user.)_')
        ),
      ],
    });
  },
};
