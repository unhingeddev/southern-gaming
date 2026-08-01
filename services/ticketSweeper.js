// services/ticketSweeper.js
// Periodic sweeper that powers delayed/auto ticket closing. Runs every minute and:
//   • closes any ticket whose scheduled close_at time has passed,
//   • cancels an inactivity close if the member became active again,
//   • flags inactive tickets for closure (with a 15-minute warning that pings the
//     opener) once they exceed the guild's inactivity window.
//
// Using a stored close_at timestamp + a sweeper (instead of setTimeout) means
// pending closes survive bot restarts.

import { Store } from '../database/db.js';
import Embeds, { COLORS } from '../utils/embeds.js';
import { saveTranscript } from './transcripts.js';
import logger from '../utils/logger.js';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';

const WARN_SECONDS = 15 * 60; // 15-minute grace period before a close
const SWEEP_MS = 60 * 1000;
export const TICKET_CLOSE_CONFIRM = 'ticket-scheduled-close-confirm';
export const TICKET_CLOSE_KEEP = 'ticket-scheduled-close-keep';

let timer = null;
let running = false;

const nowSec = () => Math.floor(Date.now() / 1000);

function closeDecisionButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(TICKET_CLOSE_CONFIRM)
      .setLabel('Confirm Close')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(TICKET_CLOSE_KEEP)
      .setLabel('Keep Open')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success)
  );
}

function canDecide(interaction, ticket) {
  if (interaction.user.id === ticket.opener_id) return true;
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) return true;
  const settings = Store.getGuild(interaction.guildId);
  return Boolean(settings?.support_role_id && interaction.member?.roles?.cache?.has(settings.support_role_id));
}

/** Post a small log line to the guild's audit log channel, if one is set. */
async function logToGuild(client, guildId, embed) {
  try {
    const settings = Store.getGuild(guildId);
    if (!settings?.log_channel_id) return;
    const ch = await client.channels.fetch(settings.log_channel_id).catch(() => null);
    if (ch?.isTextBased?.()) await ch.send({ embeds: [embed] });
  } catch {
    /* ignore */
  }
}

/** Actually close + delete a ticket channel. */
async function performClose(client, ticket, channel) {
  Store.closeTicketByChannel(ticket.channel_id);
  const why = ticket.close_kind === 'inactivity'
    ? 'inactivity'
    : ticket.close_kind === 'manual'
      ? (ticket.close_reason || 'manual close')
      : 'bulk close';
  await channel
    .send({ embeds: [Embeds.warning('Ticket closing', `Closing now (${why}). This channel will be deleted.`)] })
    .catch(() => {});
  // Save a viewable HTML transcript before the channel is deleted.
  await saveTranscript(client, ticket, channel, { reason: `Auto-close (${why})` });
  await logToGuild(
    client,
    ticket.guild_id,
    Embeds.info('🎫 Ticket auto-closed', `Ticket #${ticket.number} (opener <@${ticket.opener_id}>) closed via **${why}**.`).setColor(
      COLORS.danger
    )
  );
  setTimeout(() => channel.delete(`Ticket auto-close: ${why}`).catch(() => {}), 3000);
  logger.info(`[${ticket.guild_id}] Auto-closed ticket #${ticket.number} (${why}).`);
}

/** Schedule one ticket for closure in 15 minutes using the persistent sweeper. */
export async function scheduleManualClose(interaction, reason = 'No reason provided') {
  const ticket = Store.getTicketByChannel(interaction.channelId);
  if (!ticket || ticket.status !== 'open') {
    return interaction.reply({
      embeds: [Embeds.error('Not a ticket', 'This command only works inside an open ticket channel.')],
      flags: MessageFlags.Ephemeral,
    });
  }
  if (!canDecide(interaction, ticket)) {
    return interaction.reply({
      embeds: [Embeds.error('Not allowed', 'Only the ticket opener or support staff can close this.')],
      flags: MessageFlags.Ephemeral,
    });
  }

  const closeAt = nowSec() + WARN_SECONDS;
  Store.scheduleTicketClose(ticket.channel_id, closeAt, 'manual', reason);
  return interaction.reply({
    content: `<@${ticket.opener_id}>`,
    embeds: [
      Embeds.warning(
        'Ticket closing in 15 minutes',
        `This ticket is scheduled to close <t:${closeAt}:R>.\n**Reason:** ${reason}\n\n` +
          'Choose **Confirm Close** or **Keep Open** below.'
      ),
    ],
    components: [closeDecisionButtons()],
    allowedMentions: { users: [ticket.opener_id] },
  });
}

/** Handle the persistent Confirm Close / Keep Open warning buttons. */
export async function handleScheduledCloseButton(interaction) {
  const ticket = Store.getTicketByChannel(interaction.channelId);
  if (!ticket || ticket.status !== 'open' || !ticket.close_at) {
    return interaction.reply({
      embeds: [Embeds.info('No close pending', 'This ticket is no longer scheduled to close.')],
      flags: MessageFlags.Ephemeral,
    });
  }
  if (!canDecide(interaction, ticket)) {
    return interaction.reply({
      embeds: [Embeds.error('Not allowed', 'Only the ticket opener or support staff can choose this.')],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (interaction.customId === TICKET_CLOSE_KEEP) {
    Store.cancelTicketClose(ticket.channel_id);
    Store.touchTicketActivity(ticket.channel_id);
    return interaction.update({
      content: `<@${ticket.opener_id}>`,
      embeds: [Embeds.success('Ticket kept open', `Kept open by <@${interaction.user.id}>. The inactivity timer has been reset.`)],
      components: [],
    });
  }

  await interaction.update({
    content: `<@${ticket.opener_id}>`,
    embeds: [Embeds.warning('Closing confirmed', `Confirmed by <@${interaction.user.id}>. Closing now…`)],
    components: [],
  });
  return performClose(interaction.client, ticket, interaction.channel);
}

/** One sweep across all open tickets. */
async function sweepOnce(client) {
  if (running) return;
  running = true;
  try {
    const now = nowSec();
    for (const t of Store.getOpenTickets()) {
      try {
        const channel = await client.channels.fetch(t.channel_id).catch(() => null);
        if (!channel) {
          // Channel was deleted manually — tidy up the orphaned row.
          Store.closeTicketByChannel(t.channel_id);
          continue;
        }

        if (t.close_at) {
          const warnAt = t.close_at - WARN_SECONDS;
          // Member spoke up after an inactivity warning → cancel the close.
          if (t.close_kind === 'inactivity' && t.last_activity && t.last_activity >= warnAt) {
            Store.cancelTicketClose(t.channel_id);
            await channel
              .send({ embeds: [Embeds.success('Auto-close cancelled', 'Activity detected — this ticket will stay open.')] })
              .catch(() => {});
            continue;
          }
          if (now >= t.close_at) await performClose(client, t, channel);
          continue;
        }

        // No close scheduled — check inactivity threshold.
        const settings = Store.getGuild(t.guild_id);
        const minutes = settings?.ticket_inactivity_minutes || 0;
        const last = t.last_activity || t.created_at || now;
        if (minutes > 0 && now - last >= minutes * 60) {
          Store.scheduleTicketClose(t.channel_id, now + WARN_SECONDS, 'inactivity');
          await channel
            .send({
              content: `<@${t.opener_id}>`,
              embeds: [
                Embeds.warning(
                  '⏳ Inactivity warning',
                  'This ticket has been inactive and will be **closed in 15 minutes**.\n' +
                    'Choose **Confirm Close** or **Keep Open** below. Sending a message also keeps it open.'
                ),
              ],
              components: [closeDecisionButtons()],
            })
            .catch(() => {});
          logger.info(`[${t.guild_id}] Ticket #${t.number} flagged for inactivity close.`);
        }
      } catch (err) {
        logger.warn(`Ticket sweep error for ${t.channel_id}: ${err.message}`);
      }
    }
  } finally {
    running = false;
  }
}

/**
 * Schedule ALL open tickets in a guild to close in 15 minutes, pinging each
 * opener. Returns the number of tickets scheduled.
 * @param {import('discord.js').Client} client
 * @param {string} guildId
 */
export async function scheduleBulkClose(client, guildId) {
  const closeAt = nowSec() + WARN_SECONDS;
  const open = Store.getOpenTickets().filter((t) => t.guild_id === guildId);
  for (const t of open) {
    Store.scheduleTicketClose(t.channel_id, closeAt, 'closeall');
    try {
      const channel = await client.channels.fetch(t.channel_id).catch(() => null);
      if (channel?.isTextBased?.()) {
        await channel.send({
          content: `<@${t.opener_id}>`,
          embeds: [
            Embeds.warning(
              '⚠️ Ticket closing in 15 minutes',
              'Staff are closing open tickets. This channel will be **closed in 15 minutes**.\n' +
                'Choose **Confirm Close** or **Keep Open** below.',
            ),
          ],
          components: [closeDecisionButtons()],
        });
      }
    } catch {
      /* ignore per-channel send errors */
    }
  }
  return open.length;
}

export function startTicketSweeper(client) {
  if (timer) return;
  timer = setInterval(() => sweepOnce(client), SWEEP_MS);
  timer.unref?.();
  logger.info('Ticket sweeper started (60s).');
}

export function stopTicketSweeper() {
  if (timer) {
    clearInterval(timer);
    timer = null;
    logger.info('Ticket sweeper stopped.');
  }
}
