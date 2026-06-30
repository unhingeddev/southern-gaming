// commands/ticketautoclose.js
// Configure the inactivity auto-close window for tickets. When a ticket sees no
// human messages for this many minutes, the bot pings the opener with a 5-minute
// warning and then closes it (unless they reply). Set to 0 to disable.
// Owner/Co-owner/admins only.

import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { Store } from '../database/db.js';
import Embeds from '../utils/embeds.js';
import { audit } from '../utils/audit.js';
import { canManageTickets } from '../utils/permissions.js';

export default {
  data: new SlashCommandBuilder()
    .setName('ticketautoclose')
    .setDescription('Auto-close inactive tickets after N minutes (0 = off).')
    .addIntegerOption((o) =>
      o
        .setName('minutes')
        .setDescription('Minutes of inactivity before auto-close (0 disables; e.g. 1440 = 24h)')
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(43200)
    )
    .setDMPermission(false),

  async execute(interaction) {
    if (!canManageTickets(interaction)) {
      return interaction.reply({
        embeds: [Embeds.error('Not allowed', 'Only the Owner/Co-owner roles (or admins) can do this.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const minutes = interaction.options.getInteger('minutes', true);
    Store.setTicketInactivity(interaction.guildId, minutes);
    await audit(
      interaction,
      'Ticket Auto-close Updated',
      minutes > 0 ? `Inactive tickets close after **${minutes} min**.` : 'Inactivity auto-close **disabled**.'
    );

    return interaction.reply({
      embeds: [
        minutes > 0
          ? Embeds.success(
              'Auto-close enabled',
              `Tickets with no activity for **${formatMinutes(minutes)}** will get a 5-minute warning (pinging the opener), then close.`
            )
          : Embeds.success('Auto-close disabled', 'Tickets will no longer auto-close from inactivity.'),
      ],
      flags: MessageFlags.Ephemeral,
    });
  },
};

/** Human-readable minutes (e.g. 1440 → "24h"). */
function formatMinutes(m) {
  if (m % 1440 === 0) return `${m / 1440}d`;
  if (m % 60 === 0) return `${m / 60}h`;
  return `${m}m`;
}
