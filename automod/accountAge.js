// automod/accountAge.js
// Account-age gate: flag (or kick) accounts younger than accountAgeDays on join.

import config from './config.js';
import { Store } from './db.js';
import { buildModEmbed, sendModLog } from './modLog.js';
import logger from '../utils/logger.js';

const T = config.defaults.thresholds;
const ACTION = (config.defaults.accountAgeAction ?? 'flag').toLowerCase();

export async function checkAccountAge(member, ctx) {
  if (!Store.isModuleEnabled(member.guild.id, 'accountAge', config.defaults.modules.accountAge)) return;

  const ageDays = (Date.now() - member.user.createdTimestamp) / 86_400_000;
  if (ageDays >= T.accountAgeDays) return;

  const createdUnix = Math.floor(member.user.createdTimestamp / 1000);
  let note = '';

  if (ACTION === 'kick' && member.kickable) {
    try {
      await member.kick(`Account younger than ${T.accountAgeDays} days (auto account-age gate).`);
      note = 'Member was kicked by the account-age gate.';
    } catch (err) {
      note = `Could not kick: ${err.message}`;
    }
  }

  const embed = buildModEmbed({
    action: 'flag',
    user: member.user,
    rule: 'Account-Age Gate',
    reason:
      `Account is **${ageDays.toFixed(1)} days** old (threshold ${T.accountAgeDays}d).\n` +
      `Created <t:${createdUnix}:R>.` +
      (ACTION === 'kick' ? '' : ' No automatic action taken (flagged for review).'),
    moderator: 'Auto-Mod',
    note: note || undefined,
  });
  await sendModLog(ctx.client, member.guild.id, embed);
  logger.info(`[automod][${member.guild.id}] Account-age gate flagged ${member.user.tag} (${ageDays.toFixed(1)}d).`);
}

export default { checkAccountAge };
