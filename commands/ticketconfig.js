// commands/ticketconfig.js
// Configure the ticket system: which role is "support" (gets access to every
// ticket) and which category new ticket channels are created under. Admin only.

import { SlashCommandBuilder, ChannelType, MessageFlags } from 'discord.js';
import { Store } from '../database/db.js';
import Embeds from '../utils/embeds.js';
import { audit } from '../utils/audit.js';
import { canManageTickets } from '../utils/permissions.js';

export default {
  data: new SlashCommandBuilder()
    .setName('ticketconfig')
    .setDescription('Set the support role and category used for tickets.')
    .addRoleOption((o) =>
      o.setName('support_role').setDescription('Role that can see & manage all tickets').setRequired(true)
    )
    .addChannelOption((o) =>
      o
        .setName('category')
        .setDescription('Category new ticket channels are created under')
        .addChannelTypes(ChannelType.GuildCategory)
        .setRequired(true)
    )
    .setDMPermission(false),

  async execute(interaction) {
    // Owner / Co-owner roles (or admins) only.
    if (!canManageTickets(interaction)) {
      return interaction.reply({
        embeds: [Embeds.error('Not allowed', 'Only the Owner/Co-owner roles (or admins) can manage tickets.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const role = interaction.options.getRole('support_role', true);
    const category = interaction.options.getChannel('category', true);

    Store.setSupportRole(interaction.guildId, role.id);
    Store.setTicketCategory(interaction.guildId, category.id);

    await audit(
      interaction,
      'Ticket Config Updated',
      `Support role set to <@&${role.id}>, category set to **${category.name}**.`
    );

    return interaction.reply({
      embeds: [
        Embeds.success(
          'Ticket system configured',
          `**Support role:** <@&${role.id}>\n**Category:** ${category.name}\n\n` +
            `Now post a panel with \`/ticketpanel\`. Tip: set a log channel with ` +
            `\`/setlogchannel\` to record ticket open/close events.`
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  },
};
