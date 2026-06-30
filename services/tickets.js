// services/tickets.js
// Core ticket actions shared by the button handlers and the /close command:
// opening a private ticket channel, closing it, and claiming it. Keeps all the
// permission/lookup logic in one place so the command/event files stay thin.

import {
  PermissionFlagsBits,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { Store } from '../database/db.js';
import Embeds, { COLORS } from '../utils/embeds.js';
import { audit } from '../utils/audit.js';
import { saveTranscript } from './transcripts.js';
import logger from '../utils/logger.js';

/** Build the Close + Claim button row shown inside a ticket. */
function ticketControls() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket-claim').setLabel('Claim').setStyle(ButtonStyle.Secondary).setEmoji('🙋'),
    new ButtonBuilder().setCustomId('ticket-close').setLabel('Close').setStyle(ButtonStyle.Danger).setEmoji('🔒')
  );
}

/** Can this member close/claim tickets? Support role or Manage Channels. */
function isSupport(interaction, settings) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) return true;
  if (settings?.support_role_id && interaction.member?.roles?.cache?.has(settings.support_role_id)) return true;
  return false;
}

/**
 * Resolve the chosen category from a dropdown select, then open a ticket.
 * @param {import('discord.js').StringSelectMenuInteraction} interaction
 */
export async function openTicketFromSelect(interaction) {
  const categoryId = interaction.values?.[0];
  const category = categoryId ? Store.getTicketCategory(categoryId, interaction.guildId) : null;
  return openTicket(interaction, category);
}

/**
 * Open a new ticket for the user who clicked the panel button / chose a dropdown
 * option.
 * @param {import('discord.js').ButtonInteraction|import('discord.js').StringSelectMenuInteraction} interaction
 * @param {object|null} [category] Optional ticket category { label, description }.
 */
export async function openTicket(interaction, category = null) {
  const settings = Store.getGuild(interaction.guildId);

  if (!settings?.support_role_id || !settings?.ticket_category_id) {
    return interaction.reply({
      embeds: [Embeds.error('Tickets not set up', 'An admin needs to run `/ticketconfig` first.')],
      flags: MessageFlags.Ephemeral,
    });
  }

  // One open ticket per user.
  const existing = Store.getOpenTicketByUser(interaction.guildId, interaction.user.id);
  if (existing) {
    return interaction.reply({
      embeds: [Embeds.warning('You already have a ticket', `See <#${existing.channel_id}>.`)],
      flags: MessageFlags.Ephemeral,
    });
  }

  // Verify the bot can actually create channels + manage permissions.
  const me = interaction.guild.members.me;
  if (!me.permissions.has(PermissionFlagsBits.ManageChannels) || !me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return interaction.reply({
      embeds: [
        Embeds.error('Missing permissions', 'I need **Manage Channels** and **Manage Roles** to create tickets.'),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const number = Store.nextTicketNumber(interaction.guildId);

  let channel;
  try {
    channel = await interaction.guild.channels.create({
      name: `ticket-${String(number).padStart(4, '0')}`,
      type: ChannelType.GuildText,
      parent: settings.ticket_category_id ?? null,
      topic:
        `Ticket #${number}${category?.label ? ` • ${category.label}` : ''} • ` +
        `opened by ${interaction.user.tag} (${interaction.user.id})`,
      permissionOverwrites: [
        { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        {
          id: interaction.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles,
          ],
        },
        {
          id: settings.support_role_id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles,
          ],
        },
        {
          id: me.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageChannels,
          ],
        },
      ],
    });
  } catch (err) {
    logger.error(`Ticket channel creation failed: ${err.message}`);
    return interaction.editReply({
      embeds: [Embeds.error('Could not create ticket', err.message)],
    });
  }

  Store.createTicket(interaction.guildId, channel.id, interaction.user.id, number, category?.label ?? null);

  const welcome = new EmbedBuilder()
    .setColor(COLORS.brand)
    .setTitle(`Support Ticket #${String(number).padStart(4, '0')}`)
    .setDescription(
      `Thanks <@${interaction.user.id}>! Support will be with you shortly.\n\n` +
        `Please describe your issue in as much detail as you can.`
    )
    .setTimestamp();
  if (category?.label) {
    welcome.addFields({ name: 'Type', value: category.label, inline: true });
  }

  await channel.send({
    content: `<@${interaction.user.id}> • <@&${settings.support_role_id}>`,
    embeds: [welcome],
    components: [ticketControls()],
  });

  await audit(interaction, 'Ticket Opened', `Ticket #${number} opened: <#${channel.id}>.`);

  return interaction.editReply({
    embeds: [Embeds.success('Ticket created', `Your ticket is ready: <#${channel.id}>.`)],
  });
}

/**
 * Close the ticket in the current channel. Works from the Close button or /close.
 * @param {import('discord.js').Interaction} interaction
 * @param {string} [reason]
 */
export async function closeTicket(interaction, reason = 'No reason provided') {
  const ticket = Store.getTicketByChannel(interaction.channelId);
  if (!ticket || ticket.status === 'closed') {
    return interaction.reply({
      embeds: [Embeds.error('Not a ticket', 'This command only works inside an open ticket channel.')],
      flags: MessageFlags.Ephemeral,
    });
  }

  const settings = Store.getGuild(interaction.guildId);
  // The opener or any support member may close.
  if (interaction.user.id !== ticket.opener_id && !isSupport(interaction, settings)) {
    return interaction.reply({
      embeds: [Embeds.error('Not allowed', 'Only the ticket opener or support staff can close this.')],
      flags: MessageFlags.Ephemeral,
    });
  }

  Store.closeTicketByChannel(interaction.channelId);

  await interaction.reply({
    embeds: [
      Embeds.warning('Ticket closing', `Closed by <@${interaction.user.id}>. This channel will be deleted in 5 seconds.`),
    ],
  });

  await audit(
    interaction,
    'Ticket Closed',
    `Ticket #${ticket.number} (opened by <@${ticket.opener_id}>) was closed.\n**Reason:** ${reason}`,
    COLORS.danger
  );

  const channel = interaction.channel;

  // Save a viewable HTML transcript before the channel is deleted.
  await saveTranscript(interaction.client, ticket, channel, {
    closedBy: interaction.user.id,
    reason,
  });

  setTimeout(() => {
    channel.delete(`Ticket #${ticket.number} closed by ${interaction.user.tag}`).catch((err) => {
      logger.warn(`Failed to delete ticket channel ${channel.id}: ${err.message}`);
    });
  }, 5000);
}

/**
 * Claim the current ticket (support staff only).
 * @param {import('discord.js').ButtonInteraction} interaction
 */
export async function claimTicket(interaction) {
  const ticket = Store.getTicketByChannel(interaction.channelId);
  if (!ticket || ticket.status === 'closed') {
    return interaction.reply({
      embeds: [Embeds.error('Not a ticket', 'This is not an open ticket channel.')],
      flags: MessageFlags.Ephemeral,
    });
  }

  const settings = Store.getGuild(interaction.guildId);
  if (!isSupport(interaction, settings)) {
    return interaction.reply({
      embeds: [Embeds.error('Not allowed', 'Only support staff can claim tickets.')],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (ticket.claimed_by) {
    return interaction.reply({
      embeds: [Embeds.warning('Already claimed', `This ticket is claimed by <@${ticket.claimed_by}>.`)],
      flags: MessageFlags.Ephemeral,
    });
  }

  Store.claimTicket(interaction.channelId, interaction.user.id);
  await audit(interaction, 'Ticket Claimed', `Ticket #${ticket.number} claimed by <@${interaction.user.id}>.`);

  return interaction.reply({
    embeds: [Embeds.success('Ticket claimed', `🙋 <@${interaction.user.id}> will be handling this ticket.`)],
  });
}
