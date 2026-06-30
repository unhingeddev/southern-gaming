// automod/antiSpam.js
// Message-flood detection: > spamMessages from one user within spamWindowSeconds.

import config from './config.js';

const T = config.defaults.thresholds;
const buckets = new Map();

export function checkSpam(message) {
  const key = `${message.guildId}:${message.author.id}`;
  const now = Date.now();
  const windowMs = T.spamWindowSeconds * 1000;
  const recent = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  buckets.set(key, recent);
  if (recent.length > T.spamMessages) {
    buckets.set(key, []);
    return {
      rule: 'Anti-Spam — message flood',
      category: 'spam',
      reason: `Sent ${recent.length} messages in under ${T.spamWindowSeconds}s.`,
      redact: false,
    };
  }
  return null;
}

setInterval(() => {
  const cutoff = Date.now() - T.spamWindowSeconds * 1000;
  for (const [key, arr] of buckets) {
    const kept = arr.filter((t) => t > cutoff);
    if (kept.length) buckets.set(key, kept);
    else buckets.delete(key);
  }
}, 60_000).unref();

export default { checkSpam };
