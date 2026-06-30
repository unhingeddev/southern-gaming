// commands/ticketpanel.js
// Post a fully-customizable ticket panel. Opens a modal (just like /embed) so you
// design the panel's title, multi-paragraph description, color, footer, and the
// action label — then posts it with either:
//   • a single "Open Ticket" button, or
//   • a dropdown of ticket types (configure those with /ticketcategory).

import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  EmbedBuilder,
} from 'discord.js';
import { Store } from '../database/db.js';
import Embeds, { COLORS } from '../utils/embeds.js';
import { audit } from '../utils/audit.js';
import { canManageTickets } from '../utils/permissions.js';
import logger from '../utils/logger.js';

const MODAL_PREFIX = 'ticket-panel-modal:';

export default {
  data: new SlashCommandBuilder()
    .setName('ticketpanel')
    .setDescription('Post a customizable ticket panel (button or dropdown).')
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('Channel to post the panel in (defaults to here)')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(false)
    )
    .addStringOption((o) =>
      o
        .setName('style')
        .setDescription('Single button or a dropdown of ticket types (default: button)')
        .addChoices(
          { name: 'Button', value: 'button' },
          { name: 'Dropdown (multi-type)', value: 'dropdown' }
        )
    )
    .setDMPermission(false),

  /** Show the panel-builder modal. */
  async execute(interaction) {
    if (!canManageTickets(interaction)) {
      return interaction.reply({
        embeds: [Embeds.error('Not allowed', 'Only the Owner/Co-owner roles (or admins) can manage tickets.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const target = interaction.options.getChannel('channel') ?? interaction.channel;
    const style = interaction.options.getString('style') ?? 'button';

    const me = interaction.guild.members.me;
    const perms = target.permissionsFor(me);
    if (!perms?.has(PermissionFlagsBits.SendMessages) || !perms?.has(PermissionFlagsBits.EmbedLinks)) {
      return interaction.reply({
        embeds: [Embeds.error('Missing permissions', `I need **Send Messages** and **Embed Links** in <#${target.id}>.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    // A dropdown panel needs at least one ticket type configured.
    if (style === 'dropdown' && Store.getTicketCategories(interaction.guildId).length === 0) {
      return interaction.reply({
        embeds: [
          Embeds.error(
            'No ticket types yet',
            'Add some first with `/ticketcategory add`, then post a dropdown panel.'
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    const modal = new ModalBuilder()
      .setCustomId(`${MODAL_PREFIX}${target.id}:${style}`)
      .setTitle('Create a ticket panel');

    const titleInput = new TextInputBuilder()
      .setCustomId('title')
      .setLabel('Title')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(256)
      .setPlaceholder('🎫 Support Tickets')
      .setRequired(false);

    const descInput = new TextInputBuilder()
      .setCustomId('description')
      .setLabel('Description — press Enter for new paragraphs')
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(4000)
      .setPlaceholder('Need help? Use the menu below to open a ticket.\n\nOur team will respond ASAP.')
      .setRequired(true);

    const colorInput = new TextInputBuilder()
      .setCustomId('color')
      .setLabel('Color hex (optional, e.g. #5865F2)')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(7)
      .setRequired(false);

    const footerInput = new TextInputBuilder()
      .setCustomId('footer')
      .setLabel('Footer text (optional)')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(2048)
      .setRequired(false);

    // The 5th field doubles as the button label OR the dropdown placeholder.
    const actionInput = new TextInputBuilder()
      .setCustomId('action')
      .setLabel(style === 'dropdown' ? 'Dropdown placeholder (optional)' : 'Button label (optional)')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(80)
      .setPlaceholder(style === 'dropdown' ? 'Select a ticket type…' : '🎫 Open Ticket')
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder().addComponents(titleInput),
      new ActionRowBuilder().addComponents(descInput),
      new ActionRowBuilder().addComponents(colorInput),
      new ActionRowBuilder().addComponents(footerInput),
      new ActionRowBuilder().addComponents(actionInput)
    );

    await interaction.showModal(modal);
  },

  /** Handle the modal submission: build + post the panel. */
  async modal(interaction) {
    // customId = "ticket-panel-modal:<channelId>:<style>"
    const rest = interaction.customId.slice(MODAL_PREFIX.length);
    const lastColon = rest.lastIndexOf(':');
    const channelId = rest.slice(0, lastColon);
    const style = rest.slice(lastColon + 1);

    const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased?.()) {
      return interaction.reply({
        embeds: [Embeds.error('Channel unavailable', 'That channel no longer exists or I cannot see it.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const title = interaction.fields.getTextInputValue('title').trim();
    const description = interaction.fields.getTextInputValue('description').replaceAll('\\n', '\n').trim();
    const colorRaw = interaction.fields.getTextInputValue('color').trim();
    const footer = interaction.fields.getTextInputValue('footer').trim();
    const action = interaction.fields.getTextInputValue('action').trim();

    const embed = new EmbedBuilder().setDescription(description.slice(0, 4096)).setColor(parseColor(colorRaw));
    if (title) embed.setTitle(title.slice(0, 256));
    if (footer) embed.setFooter({ text: footer.slice(0, 2048) });

    // Build the action row: dropdown of types, or a single button.
    let row;
    if (style === 'dropdown') {
      const cats = Store.getTicketCategories(interaction.guildId);
      if (!cats.length) {
        return interaction.reply({
          embeds: [Embeds.error('No ticket types', 'Add some with `/ticketcategory add` first.')],
          flags: MessageFlags.Ephemeral,
        });
      }
      const menu = new StringSelectMenuBuilder()
        .setCustomId('ticket-select')
        .setPlaceholder((action || 'Select a ticket type…').slice(0, 150))
        .addOptions(
          cats.map((c) => {
            const opt = { label: c.label.slice(0, 100), value: String(c.id) };
            if (c.description) opt.description = c.description.slice(0, 100);
            if (c.emoji) opt.emoji = c.emoji;
            return opt;
          })
        );
      row = new ActionRowBuilder().addComponents(menu);
    } else {
      row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('ticket-open')
          .setLabel((action || '🎫 Open Ticket').slice(0, 80))
          .setStyle(ButtonStyle.Primary)
      );
    }

    try {
      await channel.send({ embeds: [embed], components: [row] });
    } catch (err) {
      logger.error(`Failed to post ticket panel to ${channelId}: ${err.message}`);
      return interaction.reply({
        embeds: [Embeds.error('Send failed', `Could not post the panel: ${err.message}`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    await audit(interaction, 'Ticket Panel Posted', `A ${style} ticket panel was posted in <#${channelId}>.`);

    return interaction.reply({
      embeds: [Embeds.success('Panel posted', `Your ${style} ticket panel is live in <#${channelId}>.`)],
      flags: MessageFlags.Ephemeral,
    });
  },
};

/** Parse "#RRGGBB"/"RRGGBB" into an int, defaulting to brand color. */
function parseColor(raw) {
  if (!raw) return COLORS.brand;
  const hex = raw.replace(/^#/, '');
  const n = parseInt(hex, 16);
  return /^[0-9a-fA-F]{6}$/.test(hex) && Number.isFinite(n) ? n : COLORS.brand;
}
