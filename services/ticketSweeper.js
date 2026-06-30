// services/ticketSweeper.js
// Periodic sweeper that powers delayed/auto ticket closing. Runs every minute and:
//   • closes any ticket whose scheduled close_at time has passed,
//   • cancels an inactivity close if the member became active again,
//   • flags inactive tickets for closure (with a 5-minute warning that pings the
//     opener) once they exceed the guild's inactivity window.
//
// Using a stored close_at timestamp + a sweeper (instead of setTimeout) means
// pending closes survive bot restarts.

import { Store } from '../database/db.js';
import Embeds, { COLORS } from '../utils/embeds.js';
import { saveTranscript } from './transcripts.js';
import logger from '../utils/logger.js';

const WARN_SECONDS = 5 * 60; // 5-minute grace period before a close
const SWEEP_MS = 60 * 1000;

let timer = null;
let running = false;

const nowSec = () => Math.floor(Date.now() / 1000);

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
  const why = ticket.close_kind === 'inactivity' ? 'inactivity' : 'bulk close';
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
                  'This ticket has been inactive and will be **closed in 5 minutes**.\n' +
                    'Send a message here if you still need help.'
                ),
              ],
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
 * Schedule ALL open tickets in a guild to close in 5 minutes, pinging each
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
              '⚠️ Ticket closing in 5 minutes',
              'Staff are closing all open tickets. This channel will be **closed in 5 minutes**.',
            ),
          ],
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
