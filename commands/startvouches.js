// commands/startvouches.js
// Enable automatic posting of new vouches. Requires a vouch channel + API key.

import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { Store } from '../database/db.js';
import Embeds from '../utils/embeds.js';
import { audit } from '../utils/audit.js';

export default {
  data: new SlashCommandBuilder()
    .setName('startvouches')
    .setDescription('Start automatically posting new vouches.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  async execute(interaction) {
    const settings = Store.getGuild(interaction.guildId);

    if (!settings?.vouch_channel_id) {
      return interaction.reply({
        embeds: [Embeds.error('No vouch channel', 'Set one first with `/setvouchchannel`.')],
        flags: MessageFlags.Ephemeral,
      });
    }
    if (!Store.getApiKey(interaction.guildId)) {
      return interaction.reply({
        embeds: [Embeds.error('No API key', 'Set one first with `/setapikey`.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    Store.setVouchesEnabled(interaction.guildId, true);
    await audit(interaction, 'Vouch Automation Started', 'Auto-posting of vouches enabled.');

    return interaction.reply({
      embeds: [
        Embeds.success(
          'Vouch automation enabled',
          `New vouches will be posted to <#${settings.vouch_channel_id}> as they arrive.`
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  },
};
