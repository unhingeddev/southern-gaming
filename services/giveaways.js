// services/giveaways.js
// Core giveaway logic: render the giveaway message + "Enter" button, handle entry
// button clicks, draw winners, and end/reroll giveaways. The timed ending is
// driven by services/giveawaySweeper.js, which calls endGiveaway() once end_at
// passes — so giveaways finish correctly even across bot restarts.

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import { Store } from '../database/db.js';
import Embeds, { COLORS } from '../utils/embeds.js';
import logger from '../utils/logger.js';

export const ENTER_PREFIX = 'giveaway-enter:';

/** customId for a giveaway's Enter button. */
export function enterButtonId(giveawayId) {
  return `${ENTER_PREFIX}${giveawayId}`;
}

/** Jump link to the giveaway message. */
function messageLink(g) {
  if (!g.message_id) return null;
  return `https://discord.com/channels/${g.guild_id}/${g.channel_id}/${g.message_id}`;
}

/**
 * Build the message payload (embed + Enter button) for a RUNNING giveaway.
 * @param {object} g          Giveaway row.
 * @param {number} entryCount Current number of entries.
 */
export function buildRunningMessage(g, entryCount) {
  const lines = [
    `Click **🎉 Enter** below to join!`,
    '',
    `**Winners:** ${g.winners_count}`,
    `**Entries:** ${entryCount}`,
    `**Ends:** <t:${g.end_at}:R> (<t:${g.end_at}:f>)`,
    `**Hosted by:** <@${g.host_id}>`,
  ];
  if (g.required_role_id) lines.push(`**Requirement:** must have <@&${g.required_role_id}>`);

  const embed = new EmbedBuilder()
    .setColor(COLORS.brand)
    .setTitle('🎉 GIVEAWAY 🎉')
    .setDescription(`## ${g.prize}\n\n${lines.join('\n')}`)
    .setFooter({ text: `Giveaway #${g.id}` })
    .setTimestamp(g.end_at * 1000);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(enterButtonId(g.id))
      .setLabel('Enter')
      .setEmoji('🎉')
      .setStyle(ButtonStyle.Primary)
  );

  return { embeds: [embed], components: [row] };
}

/**
 * Build the message payload for an ENDED giveaway (button removed).
 * @param {object} g          Giveaway row.
 * @param {string[]} winnerIds
 * @param {number} entryCount
 */
export function buildEndedMessage(g, winnerIds, entryCount) {
  const winnersText = winnerIds.length
    ? winnerIds.map((id) => `<@${id}>`).join(', ')
    : '_No valid entries — no winner._';

  const embed = new EmbedBuilder()
    .setColor(winnerIds.length ? COLORS.success : COLORS.neutral)
    .setTitle('🎉 GIVEAWAY ENDED 🎉')
    .setDescription(
      [
        `## ${g.prize}`,
        '',
        `**Winner${winnerIds.length === 1 ? '' : 's'}:** ${winnersText}`,
        `**Entries:** ${entryCount}`,
        `**Ended:** <t:${Math.floor(Date.now() / 1000)}:R>`,
        `**Hosted by:** <@${g.host_id}>`,
      ].join('\n')
    )
    .setFooter({ text: `Giveaway #${g.id}` })
    .setTimestamp();

  return { embeds: [embed], components: [] };
}

/** Pick `count` unique random user IDs from `pool`, skipping any in `exclude`. */
export function drawWinners(pool, count, exclude = []) {
  const skip = new Set(exclude);
  const candidates = pool.filter((id) => !skip.has(id));
  // Fisher–Yates shuffle, then take the first `count`.
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  return candidates.slice(0, Math.max(0, count));
}

/** Re-render the running giveaway message to reflect the latest entry count. */
async function refreshRunningMessage(client, g) {
  try {
    if (!g.message_id) return;
    const channel = await client.channels.fetch(g.channel_id).catch(() => null);
    if (!channel?.isTextBased?.()) return;
    const message = await channel.messages.fetch(g.message_id).catch(() => null);
    if (!message) return;
    await message.edit(buildRunningMessage(g, Store.countGiveawayEntries(g.id)));
  } catch (err) {
    logger.warn(`Failed to refresh giveaway #${g.id} message: ${err.message}`);
  }
}

/**
 * Handle a click on a giveaway's Enter button. Toggles entry: first click joins,
 * a second click leaves. Enforces an optional required role. Always replies
 * ephemerally so the public message stays clean.
 * @param {import('discord.js').ButtonInteraction} interaction
 */
export async function handleEnter(interaction) {
  const giveawayId = Number(interaction.customId.slice(ENTER_PREFIX.length));
  const g = Store.getGiveaway(giveawayId);

  if (!g || g.ended) {
    return interaction.reply({
      embeds: [Embeds.warning('Giveaway closed', 'This giveaway has already ended.')],
      flags: MessageFlags.Ephemeral,
    });
  }

  // Optional role gate.
  if (g.required_role_id && !interaction.member?.roles?.cache?.has(g.required_role_id)) {
    return interaction.reply({
      embeds: [Embeds.error('Not eligible', `You need the <@&${g.required_role_id}> role to enter this giveaway.`)],
      flags: MessageFlags.Ephemeral,
    });
  }

  let replyEmbed;
  if (Store.hasGiveawayEntry(giveawayId, interaction.user.id)) {
    Store.removeGiveawayEntry(giveawayId, interaction.user.id);
    replyEmbed = Embeds.info('Left the giveaway', `You're no longer entered in **${g.prize}**.`);
  } else {
    Store.addGiveawayEntry(giveawayId, interaction.user.id);
    replyEmbed = Embeds.success('Entered!', `You're in the running for **${g.prize}**. Good luck! 🍀`);
  }

  await interaction.reply({ embeds: [replyEmbed], flags: MessageFlags.Ephemeral });
  await refreshRunningMessage(interaction.client, g);
}

/**
 * End a giveaway: draw winners, mark it ended, edit the original message, and
 * announce the result in-channel. Safe to call once — re-checks the ended flag to
 * avoid a double draw if the sweeper and a manual /giveaway end race.
 * @returns {Promise<string[]>} the winner user IDs (possibly empty)
 */
export async function endGiveaway(client, giveawayId) {
  const g = Store.getGiveaway(giveawayId);
  if (!g || g.ended) return [];

  const entries = Store.getGiveawayEntries(g.id);
  const winners = drawWinners(entries, g.winners_count);
  // Claim it immediately so a concurrent sweep won't draw again.
  Store.markGiveawayEnded(g.id, winners);

  const channel = await client.channels.fetch(g.channel_id).catch(() => null);
  if (channel?.isTextBased?.()) {
    const message = g.message_id ? await channel.messages.fetch(g.message_id).catch(() => null) : null;
    if (message) await message.edit(buildEndedMessage(g, winners, entries.length)).catch(() => {});

    const link = messageLink(g);
    if (winners.length) {
      await channel
        .send({
          content: winners.map((id) => `<@${id}>`).join(' '),
          embeds: [
            Embeds.success(
              '🎉 Giveaway ended!',
              `Congratulations — you won **${g.prize}**!${link ? `\n[Jump to giveaway](${link})` : ''}`
            ),
          ],
        })
        .catch(() => {});
    } else {
      await channel
        .send({
          embeds: [Embeds.info('Giveaway ended', `No valid entries for **${g.prize}** — no winner could be drawn.`)],
        })
        .catch(() => {});
    }
  }

  logger.info(`[${g.guild_id}] Giveaway #${g.id} ended (${winners.length} winner(s), ${entries.length} entries).`);
  return winners;
}

/**
 * Reroll a finished giveaway: draw fresh winners, excluding the previous ones.
 * @returns {Promise<string[]>} the new winner IDs
 */
export async function rerollGiveaway(client, giveawayId, count = 1) {
  const g = Store.getGiveaway(giveawayId);
  if (!g) return [];

  const previous = g.winner_ids ? JSON.parse(g.winner_ids) : [];
  const entries = Store.getGiveawayEntries(g.id);
  const newWinners = drawWinners(entries, count, previous);
  if (!newWinners.length) return [];

  // Record the rerolled winners alongside the originals.
  Store.setGiveawayWinners(g.id, [...previous, ...newWinners]);

  const channel = await client.channels.fetch(g.channel_id).catch(() => null);
  if (channel?.isTextBased?.()) {
    const link = messageLink(g);
    await channel
      .send({
        content: newWinners.map((id) => `<@${id}>`).join(' '),
        embeds: [
          Embeds.success(
            '🎉 Giveaway reroll!',
            `New winner${newWinners.length === 1 ? '' : 's'} for **${g.prize}**!${link ? `\n[Jump to giveaway](${link})` : ''}`
          ),
        ],
      })
      .catch(() => {});
  }

  logger.info(`[${g.guild_id}] Giveaway #${g.id} rerolled (${newWinners.length} new winner(s)).`);
  return newWinners;
}

/** Whether a member may manage giveaways (Manage Server, or admin). */
export function canManageGiveaways(interaction) {
  return Boolean(
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ||
      interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
  );
}
