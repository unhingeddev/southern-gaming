// automod/antiRaid.js
// Anti-raid: when raidJoinCount members join within raidWindowSeconds, raise the
// guild's verification level to HIGH for a cooldown, then auto-restore.

import { GuildVerificationLevel, PermissionFlagsBits } from 'discord.js';
import config from './config.js';
import { Store } from './db.js';
import { buildModEmbed, sendModLog } from './modLog.js';
import logger from '../utils/logger.js';

const T = config.defaults.thresholds;
const LOCKDOWN_MS = Math.max(T.raidWindowSeconds * 10, 600) * 1000;

const joins = new Map();
const timers = new Map();

export async function trackJoin(member, ctx) {
  const guild = member.guild;
  if (!Store.isModuleEnabled(guild.id, 'antiRaid', config.defaults.modules.antiRaid)) return;

  const now = Date.now();
  const windowMs = T.raidWindowSeconds * 1000;
  const recent = (joins.get(guild.id) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  joins.set(guild.id, recent);

  if (recent.length < T.raidJoinCount) return;
  if (Store.getRaidState(guild.id).active) return;

  joins.set(guild.id, []);
  await enableRaidMode(guild, recent.length, ctx);
}

async function enableRaidMode(guild, count, ctx) {
  const me = guild.members.me;
  const canManage = me?.permissions.has(PermissionFlagsBits.ManageGuild);
  const prev = guild.verificationLevel;

  let note = '';
  if (canManage) {
    try {
      if (prev < GuildVerificationLevel.High) {
        await guild.setVerificationLevel(GuildVerificationLevel.High, 'Anti-raid: join spike detected');
      }
    } catch (err) {
      note = `Could not raise verification level: ${err.message}`;
    }
  } else {
    note = 'Missing **Manage Server** — could not raise verification level automatically.';
  }

  const until = Math.floor((Date.now() + LOCKDOWN_MS) / 1000);
  Store.setRaidMode(guild.id, true, until, prev);

  const embed = buildModEmbed({
    action: 'raid',
    rule: 'Anti-Raid — join spike',
    reason:
      `**${count}** members joined within ${T.raidWindowSeconds}s.\n` +
      `Verification raised to **High** (verified-only) until <t:${until}:R>.`,
    moderator: 'Auto-Mod',
    note: note || undefined,
  });
  await sendModLog(ctx.client, guild.id, embed);
  logger.warn(`[automod][${guild.id}] RAID MODE engaged (${count} joins / ${T.raidWindowSeconds}s).`);

  clearTimeout(timers.get(guild.id));
  timers.set(guild.id, setTimeout(() => disableRaidMode(guild, ctx).catch(() => {}), LOCKDOWN_MS).unref?.());
}

export async function disableRaidMode(guild, ctx) {
  const state = Store.getRaidState(guild.id);
  if (!state.active) return;

  const me = guild.members.me;
  let note = '';
  if (me?.permissions.has(PermissionFlagsBits.ManageGuild) && state.prevVerification != null) {
    try {
      await guild.setVerificationLevel(state.prevVerification, 'Anti-raid: lockdown ended');
    } catch (err) {
      note = `Could not restore verification level: ${err.message}`;
    }
  }
  Store.setRaidMode(guild.id, false, null, null);

  const embed = buildModEmbed({
    action: 'info',
    rule: 'Anti-Raid — lockdown lifted',
    reason: 'Join spike subsided. Verification level restored.',
    moderator: 'Auto-Mod',
    note: note || undefined,
  });
  await sendModLog(ctx.client, guild.id, embed);
  logger.info(`[automod][${guild.id}] Raid mode lifted.`);
}

export default { trackJoin, disableRaidMode };
