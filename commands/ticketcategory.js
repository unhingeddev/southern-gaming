// commands/ticketcategory.js
// Manage the ticket "types" that appear in a dropdown panel. Each category is one
// option in the select menu (label + optional description + emoji). Owner /
// Co-owner roles or admins only.

import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { Store } from '../database/db.js';
import Embeds from '../utils/embeds.js';
import { audit } from '../utils/audit.js';
import { canManageTickets } from '../utils/permissions.js';

const MAX_CATEGORIES = 25; // Discord select menus allow at most 25 options.

export default {
  data: new SlashCommandBuilder()
    .setName('ticketcategory')
    .setDescription('Manage ticket types shown in a dropdown panel.')
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Add a ticket type (dropdown option).')
        .addStringOption((o) => o.setName('label').setDescription('Option name, e.g. "Purchase Support"').setRequired(true).setMaxLength(80))
        .addStringOption((o) => o.setName('description').setDescription('Short description under the label').setMaxLength(100))
        .addStringOption((o) => o.setName('emoji').setDescription('Emoji for the option (e.g. 🛒)').setMaxLength(64))
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Remove a ticket type by its ID (see /ticketcategory list).')
        .addIntegerOption((o) => o.setName('id').setDescription('Category ID').setRequired(true))
    )
    .addSubcommand((s) => s.setName('list').setDescription('List configured ticket types.')),

  async execute(interaction) {
    if (!canManageTickets(interaction)) {
      return interaction.reply({
        embeds: [Embeds.error('Not allowed', 'Only the Owner/Co-owner roles (or admins) can manage tickets.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const cats = Store.getTicketCategories(interaction.guildId);
      return interaction.reply({
        embeds: [
          Embeds.info(
            'Ticket types',
            cats.length
              ? cats.map((c) => `\`${c.id}\` ${c.emoji ? c.emoji + ' ' : ''}**${c.label}**${c.description ? ` — ${c.description}` : ''}`).join('\n')
              : '_None yet. Add one with `/ticketcategory add`._'
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'add') {
      if (Store.getTicketCategories(interaction.guildId).length >= MAX_CATEGORIES) {
        return interaction.reply({
          embeds: [Embeds.error('Limit reached', `You can have at most ${MAX_CATEGORIES} ticket types.`)],
          flags: MessageFlags.Ephemeral,
        });
      }
      const label = interaction.options.getString('label', true).trim();
      const description = interaction.options.getString('description')?.trim() || null;
      const emoji = interaction.options.getString('emoji')?.trim() || null;

      const id = Store.addTicketCategory(interaction.guildId, label, description, emoji);
      await audit(interaction, 'Ticket Type Added', `\`${id}\` ${emoji ? emoji + ' ' : ''}**${label}**.`);
      return interaction.reply({
        embeds: [
          Embeds.success(
            'Ticket type added',
            `**${label}** added (ID \`${id}\`).\nRepost your panel with \`/ticketpanel\` (style: Dropdown) to include it.`
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    // remove
    const id = interaction.options.getInteger('id', true);
    const removed = Store.removeTicketCategory(id, interaction.guildId);
    return interaction.reply({
      embeds: [
        removed
          ? Embeds.success('Removed', `Ticket type \`${id}\` removed. Repost your panel to update it.`)
          : Embeds.warning('Not found', `No ticket type with ID \`${id}\`.`),
      ],
      flags: MessageFlags.Ephemeral,
    });
  },
};
