// automod/automod.js
// The auto-moderation pipeline. Runs every ENABLED detection module in priority
// order; first violation wins. Offending message is captured, deleted SILENTLY,
// then the strike system runs. In test mode it deletes + DMs only (no strike),
// and bypasses staff immunity so admins can test on themselves.

import { PermissionFlagsBits } from 'discord.js';
import config from './config.js';
import { Store } from './db.js';
import logger from '../utils/logger.js';
import { isImmune } from './permissions.js';
import { applyStrike, sendTestWarning } from './strikeSystem.js';

import { checkWordFilter, checkSolicitation } from './wordFilter.js';
import { checkSplitWord } from './splitFilter.js';
import { checkInvites, checkLinks } from './linkFilter.js';
import { checkMentions } from './antiMentionSpam.js';
import { checkCaps } from './antiCaps.js';
import { checkZalgo } from './zalgoFilter.js';
import { checkDuplicate } from './duplicateFilter.js';
import { checkSpam } from './antiSpam.js';
import { checkAdvisory, sendAdvisory } from './advisory.js';

const MODS = config.defaults.modules;

const CHECKS = [
  { module: 'wordFilter', fn: checkWordFilter, def: MODS.wordFilter },
  // Same toggle as the word filter — catches slurs split across multiple messages.
  { module: 'wordFilter', fn: checkSplitWord, def: MODS.wordFilter },
  { module: 'solicitation', fn: checkSolicitation, def: MODS.solicitation },
  { module: 'inviteFilter', fn: checkInvites, def: MODS.inviteFilter },
  { module: 'linkFilter', fn: checkLinks, def: MODS.linkFilter },
  { module: 'antiMention', fn: checkMentions, def: MODS.antiMention },
  { module: 'antiCaps', fn: checkCaps, def: MODS.antiCaps },
  { module: 'zalgo', fn: checkZalgo, def: MODS.zalgo },
  { module: 'duplicate', fn: checkDuplicate, def: MODS.duplicate },
  { module: 'antiSpam', fn: checkSpam, def: MODS.antiSpam },
];

// Deduped (checkWordFilter + checkSplitWord share the 'wordFilter' toggle).
export const TOGGLEABLE = [...new Set([...CHECKS.map((c) => c.module), 'antiRaid', 'accountAge', 'advisory'])];

export async function runAutoMod(message, ctx) {
  if (!message.guild) return;
  if (message.author?.bot || message.webhookId) return;
  if (message.system) return;

  const member = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
  const immune = !!(member && isImmune(member));
  const testMode = Store.getTestMode(message.guildId);

  // Punitive checks; first violation wins. Test mode also runs them for immune
  // members so staff can test detection on themselves.
  let violation = null;
  if (!immune || testMode) {
    for (const { module, fn, def } of CHECKS) {
      if (!Store.isModuleEnabled(message.guildId, module, def)) continue;
      try {
        const v = await fn(message, ctx);
        if (v) {
          violation = v;
          break;
        }
      } catch (err) {
        logger.error(`[automod][${message.guildId}] check "${module}" errored: ${err.message}`);
      }
    }
  }

  // No punishable violation → maybe a non-punitive advisory nudge (everyone).
  if (!violation) {
    if (Store.isModuleEnabled(message.guildId, 'advisory', config.defaults.modules.advisory)) {
      try {
        const adv = checkAdvisory(message);
        if (adv) await sendAdvisory(message, adv.term, adv.suggestion);
      } catch (err) {
        logger.error(`[automod][${message.guildId}] advisory errored: ${err.message}`);
      }
    }
    return;
  }

  const captured = message.content ?? '';

  // Delete silently — happens in BOTH normal and test mode.
  let deleteFailed = false;
  const me = message.guild.members.me;
  const canManage = message.channel?.permissionsFor?.(me)?.has(PermissionFlagsBits.ManageMessages);
  try {
    if (canManage && message.deletable) await message.delete();
    else deleteFailed = true;
  } catch (err) {
    deleteFailed = true;
    logger.warn(`[automod][${message.guildId}] Could not delete message ${message.id}: ${err.message}`);
  }

  // Split-across-messages: also delete the earlier fragment messages (best-effort).
  if (violation._messageIds?.length && message.channel) {
    const ids = violation._messageIds.filter((id) => id !== message.id);
    if (ids.length) await message.channel.bulkDelete(ids).catch(() => {});
  }

  // Test mode: message deleted + DM heads-up, but NO strike / timeout / ban.
  if (testMode) {
    try {
      await sendTestWarning(ctx.client, {
        guild: message.guild,
        user: message.author,
        rule: violation.rule,
        reason: violation.reason,
        redact: violation.redact,
        content: violation.content ?? captured,
        channelId: message.channelId,
        deleteFailed,
      });
    } catch (err) {
      logger.error(`[automod][${message.guildId}] sendTestWarning failed: ${err.stack || err.message}`);
    }
    return;
  }

  // Normal: strike + escalate + log.
  try {
    await applyStrike(ctx.client, {
      guild: message.guild,
      member,
      user: message.author,
      rule: violation.rule,
      reason: violation.reason,
      redact: violation.redact,
      content: violation.content ?? captured,
      channelId: message.channelId,
      moderator: 'Auto-Mod',
      deleteFailed,
    });
  } catch (err) {
    logger.error(`[automod][${message.guildId}] applyStrike failed: ${err.stack || err.message}`);
  }
}

export default { runAutoMod, TOGGLEABLE };
