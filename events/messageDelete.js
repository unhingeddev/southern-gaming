import { Events } from 'discord.js';
import { Store } from '../database/db.js';
import { postSticky } from '../services/stickies.js';

export default {
  name: Events.MessageDelete,
  once: false,
  async execute(message) {
    const row = Store.getSticky(message.channelId);
    if (row?.message_id === message.id && message.channel?.isTextBased?.()) {
      Store.setStickyMessageId(message.channelId, null);
      setTimeout(() => void postSticky(message.channel).catch(() => {}), row.delay_seconds * 1000);
    }
  },
};
