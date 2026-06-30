// commands/paymentmethods.js
// /paymentmethods — post the payment-methods embed publicly in the channel.
// Set the values first with /setpayments.

import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { buildPaymentsEmbed, hasAnyPayment } from '../services/payments.js';
import Embeds from '../utils/embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('paymentmethods')
    .setDescription('Show the accepted payment methods.')
    .setDMPermission(false),

  async execute(interaction) {
    if (!hasAnyPayment(interaction.guildId)) {
      return interaction.reply({
        embeds: [Embeds.warning('Not set up yet', 'No payment methods configured. A staff member can set them with `/setpayments`.')],
        flags: MessageFlags.Ephemeral,
      });
    }
    // Public post so the customer can see it.
    return interaction.reply({ embeds: [buildPaymentsEmbed(interaction.guildId)] });
  },
};
