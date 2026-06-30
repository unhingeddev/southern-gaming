// automod/antiMentionSpam.js
// Mass-mention / @everyone / @here abuse detection.

import config from './config.js';

const T = config.defaults.thresholds;

export function checkMentions(message) {
  if (message.mentions?.everyone) {
    return {
      rule: 'Anti-Mention — @everyone / @here abuse',
      category: 'mention',
      reason: 'Used @everyone / @here.',
      redact: false,
    };
  }
  const users = message.mentions?.users?.size ?? 0;
  const roles = message.mentions?.roles?.size ?? 0;
  const total = users + roles;
  if (total > T.mentionLimit) {
    return {
      rule: 'Anti-Mention — mass mentions',
      category: 'mention',
      reason: `Mentioned ${total} users/roles (limit ${T.mentionLimit}).`,
      redact: false,
    };
  }
  return null;
}

export default { checkMentions };
