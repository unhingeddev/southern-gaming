// events/messageCreate.js
// Runs the auto-moderation pipeline and the availability auto-responder, then
// tracks activity inside ticket channels (so inactivity auto-close knows when a
// ticket was last used). Auto-mod & availability self-guard and never throw.

import { Events } from 'discord.js';
import { Store } from '../database/db.js';
import Embeds from '../utils/embeds.js';
import { runAutoMod } from '../automod/automod.js';
import { maybeRespondAvailability } from '../services/availability.js';

export default {
  name: Events.MessageCreate,
  once: false,
  async execute(message, ctx) {
    // 1) Auto-moderation (handles its own eligibility checks + error handling).
    await runAutoMod(message, ctx);

    // 2) Availability auto-responder (when the owner is pinged).
    await maybeRespondAvailability(message, ctx);

    // 3) Ticket activity tracking (existing behaviour).
    if (message.author?.bot || !message.guildId) return;

    const ticket = Store.getTicketByChannel(message.channelId);
    if (!ticket || ticket.status !== 'open') return;

    Store.touchTicketActivity(message.channelId);

    if (ticket.close_at && ticket.close_kind === 'inactivity') {
      Store.cancelTicketClose(message.channelId);
      await message.channel
        .send({ embeds: [Embeds.success('Auto-close cancelled', 'Activity detected — this ticket will stay open.')] })
        .catch(() => {});
    }
  },
};
