// commands/setuptickets.js
// One-shot ticket setup: seeds the default ticket categories (Support, Cheat
// Purchases, Service Purchases, Reseller Inquiries) and posts a ready-made
// dropdown panel. Uses the same `ticket-select` flow as /ticketpanel, so opening
// works exactly like the manually-built panels. Owner/Co-owner roles or admins.

import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import { Store } from '../database/db.js';
import Embeds, { COLORS } from '../utils/embeds.js';
import { audit } from '../utils/audit.js';
import { canManageTickets } from '../utils/permissions.js';
import logger from '../utils/logger.js';

// Default ticket types (the dropdown options).
const DEFAULT_CATEGORIES = [
  { label: 'Support', emoji: '🛠️', description: 'Support' },
  { label: 'Cheat Purchases', emoji: '🛒', description: 'Cheat Purchases' },
  { label: 'Service Purchases', emoji: '🛒', description: 'Service Purchases' },
  { label: 'Reseller Inquiries', emoji: '🤝', description: 'Resellers are wanted!!' },
];

const DEFAULT_TITLE = '🎟️ Open a Ticket';
const DEFAULT_DESCRIPTION = [
  'Need help? Select the category that best fits your inquiry and our team will assist you as soon as possible.',
  '',
  '🛠️ **Support** — Experiencing an issue with a product or service? Open a support ticket for troubleshooting, bug reports, technical assistance, or general questions.',
  '',
  '🛒 **Purchases** — Questions about an order, payment issue, refund request, license activation, or pre-sale inquiry? Our purchases team is here to help.',
  '',
  '🤝 **Reseller Inquiries** — Interested in becoming a reseller or already partnered with us? Reach out for partnership opportunities, bulk pricing, reseller account support, or program-related questions.',
  '',
  'Please provide as much detail as possible (order ID, product name, screenshots, etc.) so we can resolve your inquiry quickly. Average response time: within 24 hours.',
].join('\n');

export default {
  data: new SlashCommandBuilder()
    .setName('setuptickets')
    .setDescription('Seed the default ticket categories and post the ticket panel.')
    .setDMPermission(false)
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('Channel to post the panel in (defaults to here)')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    )
    .addBooleanOption((o) => o.setName('post').setDescription('Also post the panel now (default: true)')),

  async execute(interaction) {
    if (!canManageTickets(interaction)) {
      return interaction.reply({
        embeds: [Embeds.error('Not allowed', 'Only the Owner/Co-owner roles (or admins) can manage tickets.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── Seed defaults (skip any whose label already exists, case-insensitive) ──
    const existing = Store.getTicketCategories(interaction.guildId);
    const existingLabels = new Set(existing.map((c) => c.label.toLowerCase()));
    const added = [];
    for (const d of DEFAULT_CATEGORIES) {
      if (existingLabels.has(d.label.toLowerCase())) continue;
      Store.addTicketCategory(interaction.guildId, d.label, d.description, d.emoji);
      added.push(d.label);
    }

    const post = interaction.options.getBoolean('post') ?? true;
    const target = interaction.options.getChannel('channel') ?? interaction.channel;
    let postedNote = '';

    if (post) {
      const me = interaction.guild.members.me;
      const perms = target.permissionsFor(me);
      if (!perms?.has(PermissionFlagsBits.SendMessages) || !perms?.has(PermissionFlagsBits.EmbedLinks)) {
        postedNote = `\n⚠️ Couldn't post the panel — I need **Send Messages** + **Embed Links** in <#${target.id}>.`;
      } else {
        const cats = Store.getTicketCategories(interaction.guildId).slice(0, 25);
        const menu = new StringSelectMenuBuilder()
          .setCustomId('ticket-select')
          .setPlaceholder('Select a ticket type…')
          .addOptions(
            cats.map((c) => {
              const opt = { label: c.label.slice(0, 100), value: String(c.id) };
              if (c.description) opt.description = c.description.slice(0, 100);
              if (c.emoji) opt.emoji = c.emoji;
              return opt;
            })
          );
        const embed = new EmbedBuilder().setColor(COLORS.brand).setTitle(DEFAULT_TITLE).setDescription(DEFAULT_DESCRIPTION);
        try {
          await target.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] });
          postedNote = `\nPanel posted in <#${target.id}>.`;
        } catch (err) {
          logger.error(`setuptickets: failed to post panel: ${err.message}`);
          postedNote = `\n⚠️ Failed to post panel: ${err.message}`;
        }
      }
    }

    await audit(interaction, 'Default Tickets Set Up', `Added: ${added.length ? added.join(', ') : 'none (all already existed)'}.`);

    return interaction.reply({
      embeds: [
        Embeds.success(
          'Default tickets ready',
          (added.length
            ? `Added: ${added.map((l) => `**${l}**`).join(', ')}.`
            : 'All default categories already existed.') + postedNote
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  },
};
