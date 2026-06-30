// commands/viewlogs.js
// Show the configured per-event log channels. Manage Server.

import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { Store } from '../database/db.js';
import Embeds from '../utils/embeds.js';
import { LOG_TYPES } from '../utils/eventLog.js';

export default {
  data: new SlashCommandBuilder()
    .setName('viewlogs')
    .setDescription('Show the configured log channels.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  async execute(interaction) {
    const map = Store.getAllEventLogs(interaction.guildId);
    const lines = LOG_TYPES.map((t) => `**${t}:** ${map[t] ? `<#${map[t]}>` : '_not set_'}`).join('\n');
    return interaction.reply({
      embeds: [Embeds.info('Log channel configuration', lines)],
      flags: MessageFlags.Ephemeral,
    });
  },
};
