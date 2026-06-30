// utils/moderation.js
// Shared safety checks for moderation commands (/kick, /ban). Centralises the
// "can this person actually do this?" logic so every mod command enforces the
// same rules: no self-targeting, no targeting the owner/bot, and proper role
// hierarchy for both the executor and the bot.

import { PermissionFlagsBits } from 'discord.js';

/**
 * Validate that `interaction.user` may perform `action` on `targetMember`, and
 * that the bot is capable of it.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {import('discord.js').GuildMember} targetMember
 * @param {string} action e.g. 'kick' | 'ban'
 * @returns {{ ok: boolean, reason?: string }}
 */
export function checkHierarchy(interaction, targetMember, action) {
  const guild = interaction.guild;
  const me = guild.members.me;
  const executor = interaction.member;

  if (targetMember.id === interaction.user.id) {
    return { ok: false, reason: `You can't ${action} yourself.` };
  }
  if (targetMember.id === interaction.client.user.id) {
    return { ok: false, reason: `I can't ${action} myself.` };
  }
  if (targetMember.id === guild.ownerId) {
    return { ok: false, reason: `You can't ${action} the server owner.` };
  }

  // Executor must outrank the target (server owner bypasses this).
  if (
    interaction.user.id !== guild.ownerId &&
    targetMember.roles.highest.position >= executor.roles.highest.position
  ) {
    return { ok: false, reason: `You can't ${action} someone with an equal or higher role than you.` };
  }

  // The bot must outrank the target too.
  if (targetMember.roles.highest.position >= me.roles.highest.position) {
    return { ok: false, reason: `My highest role isn't above that user's — I can't ${action} them.` };
  }

  return { ok: true };
}

/**
 * Best-effort DM to a user letting them know they were actioned. Never throws —
 * users with closed DMs simply won't receive it.
 * @param {import('discord.js').User} user
 * @param {string} guildName
 * @param {string} action Past-tense verb, e.g. 'kicked' | 'banned'.
 * @param {string} reason
 */
export async function tryNotifyUser(user, guildName, action, reason) {
  try {
    await user.send(
      `You have been **${action}** from **${guildName}**.\n**Reason:** ${reason}`
    );
    return true;
  } catch {
    return false;
  }
}

/** Does the bot itself hold the given permission flag in this guild? */
export function botHasPermission(interaction, flag) {
  return interaction.guild.members.me.permissions.has(flag);
}

export { PermissionFlagsBits };
