// commands/vouches.js
// Manually fetch and display the latest vouches/reviews on demand.

import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { Store } from '../database/db.js';
import { clientForGuild } from '../services/sellauth.js';
import Embeds from '../utils/embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('vouches')
    .setDescription('Show the latest vouches/reviews from the store.')
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
      const vouches = await sa.getVouches(count);
      if (!vouches.length) {
        return interaction.editReply({
          embeds: [Embeds.info('No vouches yet', 'There are no reviews to show right now.')],
        });
      }
      // One embed per vouch (max 10 embeds per message — within our 1-10 range).
      return interaction.editReply({ embeds: vouches.map((v) => Embeds.vouch(v)) });
    } catch (err) {
      return interaction.editReply({
        embeds: [
          Embeds.error('Could not fetch vouches', `SellAuth said: ${err.message}`),
        ],
      });
    }
  },
};
