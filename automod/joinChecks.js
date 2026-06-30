// automod/joinChecks.js
// Single entry point the host bot's guildMemberAdd hook calls: anti-raid join
// tracking, account-age gate, and nickname invite enforcement.

import { trackJoin } from './antiRaid.js';
import { checkAccountAge } from './accountAge.js';
import { enforceNickname } from './nicknameFilter.js';
import logger from '../utils/logger.js';

export async function onMemberJoin(member, ctx) {
  if (member.user?.bot) return;
  try {
    await trackJoin(member, ctx);
    await checkAccountAge(member, ctx);
    await enforceNickname(member, ctx);
  } catch (err) {
    logger.error(`[automod][${member.guild?.id}] join checks error: ${err.message}`);
  }
}

export default { onMemberJoin };
