// commands/startpurchases.js
// Enable automatic posting of recent purchases. Requires a channel + API key.

import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { Store } from '../database/db.js';
import Embeds from '../utils/embeds.js';
import { audit } from '../utils/audit.js';

export default {
  data: new SlashCommandBuilder()
    .setName('startpurchases')
    .setDescription('Start automatically posting recent purchases.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  async execute(interaction) {
    const settings = Store.getGuild(interaction.guildId);

    if (!settings?.purchase_channel_id) {
      return interaction.reply({
        embeds: [Embeds.error('No purchase channel', 'Set one first with `/setpurchasechannel`.')],
        flags: MessageFlags.Ephemeral,
      });
    }
    if (!Store.getApiKey(interaction.guildId)) {
      return interaction.reply({
        embeds: [Embeds.error('No API key', 'Set one first with `/setapikey`.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    Store.setPurchasesEnabled(interaction.guildId, true);
    await audit(interaction, 'Purchase Automation Started', 'Auto-posting of purchases enabled.');

    return interaction.reply({
      embeds: [
        Embeds.success(
          'Purchase automation enabled',
          `Recent purchases will be posted to <#${settings.purchase_channel_id}> as they arrive.`
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  },
};
