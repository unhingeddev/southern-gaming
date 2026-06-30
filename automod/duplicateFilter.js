// automod/duplicateFilter.js
// Cross-channel duplicate detection: same message across N+ channels in a window.

import config from './config.js';
import { normalizeForMatch } from './normalize.js';

const T = config.defaults.thresholds;
const seen = new Map();

export function checkDuplicate(message) {
  const content = message.content?.trim();
  if (!content || content.length < 5) return null;
  const hash = normalizeForMatch(content).replace(/\s+/g, ' ').trim();
  const key = `${message.guildId}:${message.author.id}:${hash}`;
  const now = Date.now();
  const windowMs = T.duplicateWindowSeconds * 1000;
  const rec = seen.get(key);
  if (rec && now - rec.ts < windowMs) {
    rec.channels.add(message.channelId);
    rec.ts = now;
    if (rec.channels.size >= T.duplicateChannels) {
      seen.delete(key);
      return {
        rule: 'Anti-Spam — duplicate across channels',
        category: 'duplicate',
        reason: `Posted the same message across ${T.duplicateChannels}+ channels.`,
        redact: false,
      };
    }
  } else {
    seen.set(key, { channels: new Set([message.channelId]), ts: now });
  }
  return null;
}

setInterval(() => {
  const cutoff = Date.now() - T.duplicateWindowSeconds * 1000;
  for (const [key, rec] of seen) if (rec.ts < cutoff) seen.delete(key);
}, 60_000).unref();

export default { checkDuplicate };
