// events/guildMemberAdd.js
// Auto-role system: when a member joins, assign every configured auto-role that
// the bot is actually able to grant (skipping roles above the bot or managed
// roles). Requires the privileged "Server Members Intent" to fire.

import { Events, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { Store } from '../database/db.js';
import logger from '../utils/logger.js';
import { onMemberJoin } from '../automod/joinChecks.js';
import { sendEventLog } from '../utils/eventLog.js';
import { COLORS } from '../utils/embeds.js';

// How long (ms) the announcement ghost-ping stays before auto-deleting.
const JOINPING_DELETE_MS = 5000;

/** Join log + auto-deleting announcement ping. Self-guarded; never throws. */
async function joinLogAndPing(member) {
  // 1) Join log embed → the 'join' log channel (set via /setlog join #channel).
  try {
    const embed = new EmbedBuilder()
      .setColor(COLORS.success)
      .setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL() })
      .setDescription(`📥 <@${member.id}> (**${member.user.tag}**) joined the server.`)
      .addFields(
        { name: 'Account created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
        { name: 'Member #', value: `${member.guild.memberCount}`, inline: true }
      )
      .setFooter({ text: `ID: ${member.id}` })
      .setTimestamp();
    await sendEventLog(member.client, member.guild.id, 'join', embed);
  } catch (err) {
    logger.warn(`[${member.guild.id}] Join log failed: ${err.message}`);
  }

  // 2) Auto-deleting ghost-ping in the announcements channel (set via /setlog joinping #anc).
  try {
    const channelId = Store.getEventLog(member.guild.id, 'joinping');
    if (!channelId) return;
    const channel = await member.client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased?.()) return;
    const msg = await channel
      .send({ content: `📢 <@${member.id}>`, allowedMentions: { users: [member.id] } })
      .catch(() => null);
    if (msg) setTimeout(() => msg.delete().catch(() => {}), JOINPING_DELETE_MS);
  } catch (err) {
    logger.warn(`[${member.guild.id}] Join announcement ping failed: ${err.message}`);
  }
}

export default {
  name: Events.GuildMemberAdd,
  once: false,
  /**
   * @param {import('discord.js').GuildMember} member
   * @param {object} ctx
   */
  async execute(member, ctx) {
    if (member.user.bot) return; // don't auto-role other bots

    // Auto-mod join checks (anti-raid, account-age gate, nickname invites).
    // Self-guarded; runs regardless of whether auto-roles are configured.
    await onMemberJoin(member, ctx);

    // Join log + auto-deleting announcement ping (also independent of auto-roles).
    await joinLogAndPing(member);

    const roleIds = Store.getAutoroles(member.guild.id);
    if (!roleIds.length) return;

    const me = member.guild.members.me;
    if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
      logger.warn(`[${member.guild.id}] Auto-role skipped: missing Manage Roles permission.`);
      return;
    }

    // Keep only roles that still exist and that the bot can assign.
    const assignable = [];
    for (const id of roleIds) {
      const role = member.guild.roles.cache.get(id);
      if (!role) continue;
      if (role.managed) continue; // integration-managed roles can't be assigned
      if (role.position >= me.roles.highest.position) {
        logger.warn(`[${member.guild.id}] Auto-role "${role.name}" is above my role — skipping.`);
        continue;
      }
      assignable.push(role);
    }
    if (!assignable.length) return;

    try {
      await member.roles.add(assignable, 'Auto-role on join');
      logger.info(
        `[${member.guild.id}] Gave ${member.user.tag} auto-role(s): ${assignable.map((r) => r.name).join(', ')}.`
      );
    } catch (err) {
      logger.error(`[${member.guild.id}] Failed to auto-role ${member.user.tag}: ${err.message}`);
    }
  },
};
