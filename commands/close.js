// commands/close.js
// Close the ticket in the current channel. Usable by the ticket opener or any
// support member. Delegates to the shared ticket service.

import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { closeTicket } from '../services/tickets.js';
import { Store } from '../database/db.js';
import Embeds from '../utils/embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('close')
    .setDescription('Close the current ticket.')
    .addStringOption((o) => o.setName('reason').setDescription('Reason for closing').setMaxLength(400))
    .setDMPermission(false),

  async execute(interaction) {
    // Quick guard so non-ticket channels get a clean message.
    if (!Store.getTicketByChannel(interaction.channelId)) {
      return interaction.reply({
        embeds: [Embeds.error('Not a ticket', 'Use this inside a ticket channel.')],
        flags: MessageFlags.Ephemeral,
      });
    }
    const reason = interaction.options.getString('reason')?.trim() || 'No reason provided';
    return closeTicket(interaction, reason);
  },
};
