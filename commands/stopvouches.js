// commands/stopvouches.js
// Disable automatic posting of new vouches.

import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { Store } from '../database/db.js';
import Embeds from '../utils/embeds.js';
import { audit } from '../utils/audit.js';

export default {
  data: new SlashCommandBuilder()
    .setName('stopvouches')
    .setDescription('Stop automatically posting new vouches.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  async execute(interaction) {
    Store.setVouchesEnabled(interaction.guildId, false);
    await audit(interaction, 'Vouch Automation Stopped', 'Auto-posting of vouches disabled.');

    return interaction.reply({
      embeds: [Embeds.success('Vouch automation disabled', 'New vouches will no longer be posted automatically.')],
      flags: MessageFlags.Ephemeral,
    });
  },
};
