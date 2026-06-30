// commands/stoppurchases.js
// Disable automatic posting of recent purchases.

import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { Store } from '../database/db.js';
import Embeds from '../utils/embeds.js';
import { audit } from '../utils/audit.js';

export default {
  data: new SlashCommandBuilder()
    .setName('stoppurchases')
    .setDescription('Stop automatically posting recent purchases.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  async execute(interaction) {
    Store.setPurchasesEnabled(interaction.guildId, false);
    await audit(interaction, 'Purchase Automation Stopped', 'Auto-posting of purchases disabled.');

    return interaction.reply({
      embeds: [Embeds.success('Purchase automation disabled', 'Recent purchases will no longer be posted automatically.')],
      flags: MessageFlags.Ephemeral,
    });
  },
};
