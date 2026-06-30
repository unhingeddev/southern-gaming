// commands/removelog.js
// Stop sending a given log type. Manage Server.

import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { Store } from '../database/db.js';
import Embeds from '../utils/embeds.js';
import { audit } from '../utils/audit.js';
import { LOG_TYPES } from '../utils/eventLog.js';

export default {
  data: new SlashCommandBuilder()
    .setName('removelog')
    .setDescription('Stop a log/feature (leave/ban/kick/embed/join/joinping).')
    .addStringOption((o) =>
      o.setName('type').setDescription('Which log to remove').setRequired(true)
        .addChoices(...LOG_TYPES.map((t) => ({ name: t, value: t })))
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  async execute(interaction) {
    const type = interaction.options.getString('type', true);
    const removed = Store.removeEventLog(interaction.guildId, type);
    if (removed) await audit(interaction, 'Log Channel Removed', `**${type}** logging disabled.`);
    return interaction.reply({
      embeds: [
        removed
          ? Embeds.success('Log removed', `**${type}** events will no longer be logged.`)
          : Embeds.warning('Not set', `No **${type}** log channel was configured.`),
      ],
      flags: MessageFlags.Ephemeral,
    });
  },
};
