// commands/nuke.js
// Channel cleanup ("nuke"): clears ALL messages in a channel. Administrator only,
// with a button confirmation to prevent accidents, and full audit logging.
//
// Implementation: we *clone* the channel (preserving name, topic, permissions,
// position, slowmode, etc.) and delete the original. This wipes every message
// instantly — including messages older than 14 days, which Discord's bulk-delete
// API refuses to touch. The trade-off is a new channel ID, which is expected for
// a "nuke" and is the standard approach.

import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ComponentType,
} from 'discord.js';
import Embeds, { COLORS } from '../utils/embeds.js';
import { audit } from '../utils/audit.js';
import logger from '../utils/logger.js';

export default {
  // Slightly longer cooldown for a destructive command.
  cooldown: 10,

  data: new SlashCommandBuilder()
    .setName('nuke')
    .setDescription('Delete ALL messages in a channel by recreating it (admin only).')
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('Channel to nuke (defaults to the current channel)')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  async execute(interaction) {
    // Defence-in-depth: re-check Administrator even though Discord gates it.
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({
        embeds: [Embeds.error('Permission denied', 'You need **Administrator** to use this.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const target =
      interaction.options.getChannel('channel') ?? interaction.channel;

    if (!target || (target.type !== ChannelType.GuildText && target.type !== ChannelType.GuildAnnouncement)) {
      return interaction.reply({
        embeds: [Embeds.error('Invalid channel', 'Please choose a server text channel.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    // Ensure the bot itself can manage the channel.
    const me = interaction.guild.members.me;
    if (!target.permissionsFor(me)?.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.reply({
        embeds: [
          Embeds.error(
            'Missing permissions',
            'I need the **Manage Channels** permission to nuke a channel.'
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── Confirmation prompt ──────────────────────────────────────────────────
    const confirmId = `nuke-confirm-${interaction.id}`;
    const cancelId = `nuke-cancel-${interaction.id}`;

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(confirmId)
        .setLabel('Yes, nuke it')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('💥'),
      new ButtonBuilder()
        .setCustomId(cancelId)
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary)
    );

    await interaction.reply({
      embeds: [
        Embeds.warning(
          'Confirm channel nuke',
          `This will **permanently delete every message** in <#${target.id}> by ` +
            `recreating the channel.\n\nThis cannot be undone. Are you sure?`
        ),
      ],
      components: [row],
      flags: MessageFlags.Ephemeral,
    });

    // Wait for the same admin to click within 30 seconds.
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
        embeds: [Embeds.info('Nuke cancelled', 'No confirmation received — nothing was deleted.')],
        components: [],
      });
    }

    if (confirmation.customId === cancelId) {
      return confirmation.update({
        embeds: [Embeds.info('Nuke cancelled', 'No messages were deleted.')],
        components: [],
      });
    }

    // ── Perform the nuke ─────────────────────────────────────────────────────
    await confirmation.update({
      embeds: [Embeds.warning('Nuking…', 'Recreating the channel, one moment.')],
      components: [],
    });

    try {
      const position = target.position;
      const newChannel = await target.clone({
        reason: `Nuked by ${interaction.user.tag} (${interaction.user.id})`,
      });
      await newChannel.setPosition(position).catch(() => {});
      await target.delete(`Nuked by ${interaction.user.tag}`);

      // Audit (to file + configured log channel).
      await audit(
        interaction,
        'Channel Nuked',
        `Channel **#${target.name}** was nuked and recreated as <#${newChannel.id}>.`,
        COLORS.danger
      );

      // Confirmation banner posted into the fresh channel.
      await newChannel
        .send({
          embeds: [
            Embeds.success(
              'Channel nuked',
              `All messages were cleared by <@${interaction.user.id}>.`
            ),
          ],
        })
        .catch(() => {});

      // The original interaction's ephemeral reply lived in the deleted channel,
      // so editing it may fail — that's fine, the new channel shows the result.
      logger.info(
        `Channel ${target.id} nuked by ${interaction.user.tag}; new channel ${newChannel.id}.`
      );
    } catch (err) {
      logger.error(`Nuke failed for channel ${target.id}: ${err.message}`);
      // Try to inform the admin; the channel may already be gone.
      await interaction.followUp({
        embeds: [Embeds.error('Nuke failed', `Something went wrong: ${err.message}`)],
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
    }
  },
};
