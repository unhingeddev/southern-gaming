// events/messageUpdate.js
// Re-run auto-mod on edited messages so users can't post clean text then edit in
// a violation. Handles partial (uncached) messages.

import { Events } from 'discord.js';
import { runAutoMod } from '../automod/automod.js';

export default {
  name: Events.MessageUpdate,
  once: false,
  async execute(_oldMessage, newMessage, ctx) {
    if (!newMessage) return;
    const message = newMessage.partial ? await newMessage.fetch().catch(() => null) : newMessage;
    if (message) await runAutoMod(message, ctx);
  },
};
