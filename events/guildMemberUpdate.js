// events/guildMemberUpdate.js
// Re-check nicknames when a member changes theirs (catches invite links added
// after joining). Auto-mod only — does not touch other member-update logic.

import { Events } from 'discord.js';
import logger from '../utils/logger.js';
import { enforceNickname } from '../automod/nicknameFilter.js';

export default {
  name: Events.GuildMemberUpdate,
  once: false,
  async execute(oldMember, newMember, ctx) {
    if (!newMember || newMember.user.bot) return;
    if (oldMember?.nickname === newMember.nickname) return;
    try {
      await enforceNickname(newMember, ctx);
    } catch (err) {
      logger.error(`[automod][${newMember.guild?.id}] guildMemberUpdate error: ${err.message}`);
    }
  },
};
