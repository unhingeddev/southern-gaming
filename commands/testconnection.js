// commands/testconnection.js
// Verify the configured SellAuth credentials by making a lightweight API call.

import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { Store } from '../database/db.js';
import { clientForGuild } from '../services/sellauth.js';
import Embeds from '../utils/embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('testconnection')
    .setDescription('Test the connection to the SellAuth API.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const sa = clientForGuild(Store, interaction.guildId);
    if (!sa) {
      return interaction.editReply({
        embeds: [
          Embeds.error(
            'No API key set',
            'Set one first with `/setapikey`, then try again.'
          ),
        ],
      });
    }

    const result = await sa.testConnection();
    if (result.ok) {
      return interaction.editReply({
        embeds: [
          Embeds.success(
            'Connection successful',
            'The bot can reach SellAuth and your credentials are valid. ✅'
          ),
        ],
      });
    }

    return interaction.editReply({
      embeds: [
        Embeds.error(
          'Connection failed',
          `Could not authenticate with SellAuth.\n` +
            `**Reason:** ${result.message}${result.status ? ` (HTTP ${result.status})` : ''}\n\n` +
            `Double-check your API key and Shop ID with \`/setapikey\`.`
        ),
      ],
    });
  },
};
