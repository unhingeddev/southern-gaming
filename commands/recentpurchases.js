// commands/recentpurchases.js
// Manually fetch and display the most recent purchases/orders on demand.
// Only non-sensitive fields are shown (no emails, IPs, or payment data).

import { SlashCommandBuilder } from 'discord.js';
import { Store } from '../database/db.js';
import { clientForGuild } from '../services/sellauth.js';
import Embeds from '../utils/embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('recentpurchases')
    .setDescription('Show the most recent purchases from the store.')
    .addIntegerOption((o) =>
      o
        .setName('count')
        .setDescription('How many to show (1-10)')
        .setMinValue(1)
        .setMaxValue(10)
    )
    .setDMPermission(false),

  async execute(interaction) {
    await interaction.deferReply();
    const count = interaction.options.getInteger('count') ?? 5;

    const sa = clientForGuild(Store, interaction.guildId);
    if (!sa) {
      return interaction.editReply({
        embeds: [Embeds.error('Not configured', 'An admin needs to run `/setapikey` first.')],
      });
    }

    try {
      const orders = await sa.getRecentPurchases(count);
      if (!orders.length) {
        return interaction.editReply({
          embeds: [Embeds.info('No purchases yet', 'There are no recent orders to show.')],
        });
      }
      return interaction.editReply({ embeds: orders.map((o) => Embeds.purchase(o)) });
    } catch (err) {
      return interaction.editReply({
        embeds: [Embeds.error('Could not fetch purchases', `SellAuth said: ${err.message}`)],
      });
    }
  },
};
