// automod/strikeSystem.js
// The 4-strike escalation engine, embed DMs, and the test-mode (dry-run) warning.
//   Strike 1 → warn + DM · 2 → + timeout · 3 → + longer timeout · 4 → ban.

import { EmbedBuilder } from 'discord.js';
import config from './config.js';
import { Store } from './db.js';
import { buildModEmbed, sendModLog } from './modLog.js';
import { COLORS } from '../utils/embeds.js';
import logger from '../utils/logger.js';

const TIMEOUTS = config.defaults.timeouts;
const ORANGE = COLORS.timeout ?? 0xe67e22;

function durationLabel(seconds) {
  if (seconds % 86400 === 0) return `${seconds / 86400} day(s)`;
  if (seconds % 3600 === 0) return `${seconds / 3600} hour(s)`;
  if (seconds % 60 === 0) return `${seconds / 60} minute(s)`;
  return `${seconds} second(s)`;
}

async function tryDM(user, embed) {
  try {
    await user.send({ embeds: [embed] });
    return true;
  } catch {
    return false;
  }
}

function nextStepText(count) {
  const decay = config.defaults.strikeDecayDays;
  if (count <= 1) return `Strike 2 → timeout · Strike 3 → longer timeout · Strike 4 → ban.\nStrikes decay after ${decay} days of good behaviour.`;
  if (count === 2) return 'Strike 3 → longer timeout · Strike 4 → ban.';
  if (count === 3) return 'One more strike (4/4) results in a **ban**.';
  return '';
}

function buildDmEmbed({ action, guildName, rule, reason, strikeCount, timeoutSeconds, testMode, deleteFailed }) {
  const color = action === 'ban' ? COLORS.danger : action === 'timeout' ? ORANGE : COLORS.warning;
  const embed = new EmbedBuilder().setColor(color).setTimestamp().setFooter({ text: guildName });

  if (testMode) {
    const removed = deleteFailed
      ? 'broke a rule (I could not remove it — I am missing the Manage Messages permission)'
      : 'broke a rule and was removed';
    embed
      .setTitle('⚠️ Heads-up — message removed')
      .setDescription(`Your message in **${guildName}** ${removed}. The server is in **test mode**, so **no strike** was applied this time.`);
  } else if (action === 'ban') {
    embed.setTitle('🔨 You have been banned').setDescription(`You reached **strike ${strikeCount}/4** in **${guildName}**.`);
  } else if (action === 'timeout') {
    embed.setTitle('⏳ You have been timed out').setDescription(`You are at **strike ${strikeCount}/4** in **${guildName}** and muted for **${durationLabel(timeoutSeconds)}**.`);
  } else {
    embed.setTitle('⚠️ Warning').setDescription(`You are at **strike ${strikeCount}/4** in **${guildName}**.`);
  }

  if (rule) embed.addFields({ name: 'Rule', value: String(rule).slice(0, 1024) });
  if (reason) embed.addFields({ name: 'Reason', value: String(reason).slice(0, 1024) });
  if (!testMode && action !== 'ban') embed.addFields({ name: 'What happens next', value: nextStepText(strikeCount) });

  return embed;
}

function actionFor(count) {
  if (count >= 4) return { action: 'ban', timeoutSeconds: 0 };
  if (count === 3) return { action: 'timeout', timeoutSeconds: TIMEOUTS.strike3Seconds };
  if (count === 2) return { action: 'timeout', timeoutSeconds: TIMEOUTS.strike2Seconds };
  return { action: 'warn', timeoutSeconds: 0 };
}

/** Apply a strike and run the full escalation pipeline. */
export async function applyStrike(client, o) {
  const guildId = o.guild.id;
  const count = Store.addStrike(guildId, o.user.id);
  const { action, timeoutSeconds } = actionFor(count);

  const dmEmbed = buildDmEmbed({
    action,
    guildName: o.guild.name,
    rule: o.rule,
    reason: o.reason,
    strikeCount: count,
    timeoutSeconds,
  });
  const dmOk = await tryDM(o.user, dmEmbed);

  let enforceNote = '';
  try {
    if (action === 'ban') {
      if (o.member ? o.member.bannable : true) {
        await o.guild.members.ban(o.user.id, { reason: `Strike ${count}/4 — ${o.rule ?? 'auto-mod'}`, deleteMessageSeconds: 0 });
      } else {
        enforceNote = 'Could not ban (missing permission or role hierarchy).';
      }
    } else if (action === 'timeout') {
      if (o.member?.moderatable) {
        await o.member.timeout(timeoutSeconds * 1000, `Strike ${count}/4 — ${o.rule ?? 'auto-mod'}`);
      } else {
        enforceNote = 'Could not timeout (missing permission or role hierarchy).';
      }
    }
  } catch (err) {
    enforceNote = `Enforcement failed: ${err.message}`;
    logger.error(`[automod][${guildId}] Strike enforcement failed for ${o.user.tag}: ${err.message}`);
  }

  Store.addHistory({
    guildId,
    userId: o.user.id,
    rule: o.rule,
    reason: o.reason,
    action,
    moderatorId: o.moderator === 'Auto-Mod' ? null : o.moderatorId ?? null,
    strikeCount: count,
  });

  const actionDetail =
    action === 'ban'
      ? `Banned (strike ${count}/4).`
      : action === 'timeout'
        ? `Timed out for ${durationLabel(timeoutSeconds)} (strike ${count}/4).`
        : `Warning issued (strike ${count}/4).`;

  const notes = [];
  if (!dmOk) notes.push('Could not DM the user (DMs closed).');
  if (o.deleteFailed) notes.push('Could not delete the offending message (missing Manage Messages).');
  if (enforceNote) notes.push(enforceNote);

  const embed = buildModEmbed({
    action,
    user: o.user,
    rule: o.rule,
    reason: `${actionDetail}${o.reason ? `\n${o.reason}` : ''}`,
    content: o.content,
    redact: o.redact,
    strikeCount: count,
    channelId: o.channelId,
    moderator: o.moderator ?? 'Auto-Mod',
    note: notes.length ? notes.join(' ') : undefined,
  });
  await sendModLog(client, guildId, embed);

  return { count, action, dmOk };
}

/** Test-mode handler: DM a heads-up + log a TEST entry, but apply NO strike. */
export async function sendTestWarning(client, o) {
  const guildId = o.guild.id;
  const current = Store.getStrikes(guildId, o.user.id).count;
  const wouldBe = current + 1;
  const { action, timeoutSeconds } = actionFor(wouldBe);

  const dmEmbed = buildDmEmbed({
    action,
    guildName: o.guild.name,
    rule: o.rule,
    reason: o.reason,
    strikeCount: wouldBe,
    timeoutSeconds,
    testMode: true,
    deleteFailed: o.deleteFailed,
  });
  const dmOk = await tryDM(o.user, dmEmbed);

  const wouldText =
    action === 'ban'
      ? `banned (would be strike ${wouldBe}/4)`
      : action === 'timeout'
        ? `timed out for ${durationLabel(timeoutSeconds)} (would be strike ${wouldBe}/4)`
        : `warned (would be strike ${wouldBe}/4)`;

  const notes = ['TEST MODE — message deleted, no strike/timeout/ban applied.'];
  if (o.deleteFailed) notes.push('Could not delete the message (missing Manage Messages).');
  if (!dmOk) notes.push('Could not DM the user (DMs closed).');

  const embed = buildModEmbed({
    action: 'info',
    user: o.user,
    rule: o.rule,
    reason: `**TEST MODE** — message ${o.deleteFailed ? 'flagged (delete failed)' : 'deleted'}, **no strike** applied (would have been **${wouldText}**).`,
    content: o.content,
    redact: o.redact,
    channelId: o.channelId,
    moderator: 'Auto-Mod (TEST)',
    note: notes.join(' '),
  });
  await sendModLog(client, guildId, embed);

  return { dmOk, wouldBe, action };
}

export default { applyStrike, sendTestWarning };
