// automod/antiCaps.js
// Flags messages that are mostly uppercase, above a minimum length.

import config from './config.js';

const T = config.defaults.thresholds;

export function checkCaps(message) {
  const text = message.content ?? '';
  const letters = text.replace(/[^a-zA-Z]/g, '');
  if (letters.length < T.capsMinLength) return null;
  const upper = (text.match(/[A-Z]/g) ?? []).length;
  const ratio = (upper / letters.length) * 100;
  if (ratio >= T.capsPercent) {
    return {
      rule: 'Anti-Caps — excessive uppercase',
      category: 'caps',
      reason: `Message was ${Math.round(ratio)}% uppercase (limit ${T.capsPercent}%).`,
      redact: false,
    };
  }
  return null;
}

export default { checkCaps };
