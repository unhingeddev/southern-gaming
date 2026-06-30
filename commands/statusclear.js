// commands/statusclear.js
// Remove ALL rotating statuses at once. Owner-only (presence is global), with a
// button confirmation since it wipes the whole rotation. After clearing, the
// rotator falls back to its built-in default status.

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
import { isBotOwner } from '../utils/owner.js';
import { refreshStatusNow } from '../services/statusRotator.js';
import logger from '../utils/logger.js';

export default {
  cooldown: 5,

  data: new SlashCommandBuilder()
    .setName('statusclear')
    .setDescription('Remove ALL rotating statuses (owner only).')
    .setDMPermission(false),

  async execute(interaction) {
    // Owner-only gate (presence affects every server).
    if (!(await isBotOwner(interaction))) {
      return interaction.reply({
        embeds: [Embeds.error('Owner only', 'Only the bot owner can manage rotating statuses.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const total = Store.countStatuses();
    if (total === 0) {
      return interaction.reply({
        embeds: [Embeds.info('Nothing to clear', 'There are no rotating statuses set.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── Confirmation prompt ──────────────────────────────────────────────────
    const confirmId = `statusclear-confirm-${interaction.id}`;
    const cancelId = `statusclear-cancel-${interaction.id}`;

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(confirmId)
        .setLabel(`Clear all ${total}`)
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🗑️'),
      new ButtonBuilder().setCustomId(cancelId).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
    );

    await interaction.reply({
      embeds: [
        Embeds.warning(
          'Clear all statuses?',
          `This will remove **all ${total}** rotating status(es). ` +
            `The bot will fall back to its default status.\n\nThis cannot be undone.`
        ),
      ],
      components: [row],
      flags: MessageFlags.Ephemeral,
    });

    // Wait for the same owner to click within 30s.
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
        embeds: [Embeds.info('Cancelled', 'No confirmation received — nothing was cleared.')],
        components: [],
      });
    }

    if (confirmation.customId === cancelId) {
      return confirmation.update({
        embeds: [Embeds.info('Cancelled', 'No statuses were removed.')],
        components: [],
      });
    }

    // ── Perform the clear ────────────────────────────────────────────────────
    const removed = Store.clearStatuses();
    logger.info(`Cleared ${removed} status(es) by ${interaction.user.tag}.`);
    refreshStatusNow(interaction.client); // fall back to default immediately

    return confirmation.update({
      embeds: [
        Embeds.success(
          'Statuses cleared',
          `Removed **${removed}** status(es). The bot is now showing its default status.\n` +
            `Add new ones with \`/statusadd\`.`
        ),
      ],
      components: [],
    });
  },
};
