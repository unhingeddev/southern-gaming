// commands/setpayments.js
// /setpayments [paypal] [cashapp] [crypto] — configure the methods shown by
// /paymentmethods. Provide only the fields you want to change; use "none" to
// clear one. Staff/admin only. With no options, shows the current values.

import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { canModerate } from '../automod/permissions.js';
import { setPayments, getPayments, buildPaymentsEmbed } from '../services/payments.js';
import Embeds from '../utils/embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('setpayments')
    .setDescription('Set the payment methods shown by /paymentmethods.')
    .setDMPermission(false)
    .addStringOption((o) => o.setName('paypal').setDescription('PayPal email (or "none" to clear)').setMaxLength(200))
    .addStringOption((o) => o.setName('cashapp').setDescription('CashApp $tag (or "none" to clear)').setMaxLength(200))
    .addStringOption((o) => o.setName('crypto').setDescription('Crypto address(es) (or "none" to clear)').setMaxLength(500)),

  async execute(interaction) {
    if (!canModerate(interaction)) {
      return interaction.reply({
        embeds: [Embeds.error('No permission', 'You need to be **Owner / Co-Owner / Staff** (or a server admin) to use this.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const updates = {
      paypal: interaction.options.getString('paypal') ?? undefined,
      cashapp: interaction.options.getString('cashapp') ?? undefined,
      crypto: interaction.options.getString('crypto') ?? undefined,
    };

    const provided = Object.values(updates).some((v) => v !== undefined);
    if (!provided) {
      // Nothing to change → show current config as a preview.
      const cur = getPayments(interaction.guildId);
      const summary = `**PayPal:** ${cur.paypal || '_not set_'}\n**CashApp:** ${cur.cashapp || '_not set_'}\n**Crypto:** ${cur.crypto || '_not set_'}`;
      return interaction.reply({
        embeds: [Embeds.info('Current payment methods', summary + '\n\nPass `paypal`, `cashapp`, and/or `crypto` to update them.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    setPayments(interaction.guildId, updates);
    return interaction.reply({
      embeds: [
        Embeds.success('Payment methods updated', 'Here is how `/paymentmethods` will now look:'),
        buildPaymentsEmbed(interaction.guildId),
      ],
      flags: MessageFlags.Ephemeral,
    });
  },
};
