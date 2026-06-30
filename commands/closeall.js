// commands/closeall.js
// Close ALL open tickets in the server. Owner/Co-owner/admins only. Asks for
// confirmation, then gives each ticket a 5-minute warning (pinging the opener)
// before the sweeper closes them.

import {
  SlashCommandBuilder,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} from 'discord.js';
import { Store } from '../database/db.js';
import Embeds from '../utils/embeds.js';
import { audit } from '../utils/audit.js';
import { canManageTickets } from '../utils/permissions.js';
import { scheduleBulkClose } from '../services/ticketSweeper.js';

export default {
  cooldown: 10,

  data: new SlashCommandBuilder()
    .setName('closeall')
    .setDescription('Close ALL open tickets (5-minute warning, owner/admin only).')
    .setDMPermission(false),

  async execute(interaction) {
    if (!canManageTickets(interaction)) {
      return interaction.reply({
        embeds: [Embeds.error('Not allowed', 'Only the Owner/Co-owner roles (or admins) can do this.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const open = Store.getOpenTickets().filter((t) => t.guild_id === interaction.guildId);
    if (open.length === 0) {
      return interaction.reply({
        embeds: [Embeds.info('No open tickets', 'There are no open tickets to close.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const confirmId = `closeall-confirm-${interaction.id}`;
    const cancelId = `closeall-cancel-${interaction.id}`;
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(confirmId).setLabel(`Close all ${open.length}`).setStyle(ButtonStyle.Danger).setEmoji('🔒'),
      new ButtonBuilder().setCustomId(cancelId).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
    );

    await interaction.reply({
      embeds: [
        Embeds.warning(
          'Close all tickets?',
          `This will close **${open.length}** open ticket(s). Each opener gets a **5-minute warning** ` +
            `ping, then the ticket is closed and deleted.`
        ),
      ],
      components: [row],
      flags: MessageFlags.Ephemeral,
    });

    let confirmation;
    try {
      const reply = await interaction.fetchReply();
      confirmation = await reply.awaitMessageComponent({
        componentType: ComponentType.Button,
        time: 30_000,
        filter: (i) => i.user.id === interaction.user.id,
      });
    } catch {
      return interaction.editReply({
        embeds: [Embeds.info('Cancelled', 'No confirmation received — nothing was closed.')],
        components: [],
      });
    }

    if (confirmation.customId === cancelId) {
      return confirmation.update({
        embeds: [Embeds.info('Cancelled', 'No tickets were closed.')],
        components: [],
      });
    }

    await confirmation.update({
      embeds: [Embeds.warning('Scheduling…', 'Posting 5-minute warnings in each ticket.')],
      components: [],
    });

    const count = await scheduleBulkClose(interaction.client, interaction.guildId);
    await audit(interaction, 'Close All Tickets', `Scheduled **${count}** ticket(s) to close in 5 minutes.`);

    return interaction.editReply({
      embeds: [
        Embeds.success(
          'Tickets scheduled to close',
          `**${count}** ticket(s) will close in **5 minutes**. Each opener has been pinged with a warning.`
        ),
      ],
    });
  },
};
