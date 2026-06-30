// automod/nicknameFilter.js
// Enforces the invite-link ban inside member nicknames / usernames. Invites in a
// display name are reset to a neutral nickname (needs Manage Nicknames + role
// hierarchy). Status/presence checking would need the GuildPresences intent.

import { PermissionFlagsBits } from 'discord.js';
import config from './config.js';
import { Store } from './db.js';
import { hasInvite } from './linkFilter.js';
import { buildModEmbed, sendModLog } from './modLog.js';
import logger from '../utils/logger.js';

const NEUTRAL = 'Nickname Moderated';

export async function enforceNickname(member, ctx) {
  if (member.user.bot) return;
  if (!Store.isModuleEnabled(member.guild.id, 'inviteFilter', config.defaults.modules.inviteFilter)) return;

  const display = member.nickname || member.user.username || '';
  if (!hasInvite(display)) return;

  const me = member.guild.members.me;
  let note = '';
  if (me?.permissions.has(PermissionFlagsBits.ManageNicknames) && member.manageable) {
    try {
      await member.setNickname(NEUTRAL, 'Invite link in nickname (auto-mod)');
    } catch (err) {
      note = `Could not reset nickname: ${err.message}`;
    }
  } else {
    note = 'Missing Manage Nicknames or role hierarchy — could not reset.';
  }

  const embed = buildModEmbed({
    action: 'flag',
    user: member.user,
    rule: 'Link Filter — invite link in nickname',
    reason: `Display name contained a Discord invite and was reset to "${NEUTRAL}".`,
    content: display,
    moderator: 'Auto-Mod',
    note: note || undefined,
  });
  await sendModLog(ctx.client, member.guild.id, embed);
  logger.info(`[automod][${member.guild.id}] Reset invite-containing nickname for ${member.user.tag}.`);
}

export default { enforceNickname };
