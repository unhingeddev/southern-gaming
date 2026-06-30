// utils/cooldowns.js
// Simple in-memory per-user, per-command cooldown tracker to prevent spam/abuse.
// In-memory is fine here: cooldowns are short-lived and need not survive restarts.

const buckets = new Map(); // key: `${commandName}:${userId}` -> expiry timestamp (ms)

/**
 * Check and apply a cooldown.
 * @param {string} commandName
 * @param {string} userId
 * @param {number} seconds Cooldown duration.
 * @returns {{ onCooldown: boolean, remaining: number }} remaining is seconds left.
 */
export function checkCooldown(commandName, userId, seconds) {
  const key = `${commandName}:${userId}`;
  const now = Date.now();
  const expiry = buckets.get(key);

  if (expiry && expiry > now) {
    return { onCooldown: true, remaining: Math.ceil((expiry - now) / 1000) };
  }

  buckets.set(key, now + seconds * 1000);
  return { onCooldown: false, remaining: 0 };
}

// Periodically sweep expired entries so the Map cannot grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [key, expiry] of buckets) {
    if (expiry <= now) buckets.delete(key);
  }
}, 60_000).unref();
