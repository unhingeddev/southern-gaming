// automod/zalgoFilter.js
// Detects zalgo / combining-character obfuscation.

import config from './config.js';
import { countCombining } from './normalize.js';

const T = config.defaults.thresholds;

export function checkZalgo(message) {
  const text = message.content ?? '';
  if (!text) return null;
  const combining = countCombining(text);
  if (combining < T.zalgoMinCombining) return null;
  const ratio = combining / Math.max(text.length, 1);
  if (ratio >= T.zalgoCombiningRatio) {
    return {
      rule: 'Obfuscation — zalgo / combining characters',
      category: 'zalgo',
      reason: `Message used ${combining} combining marks (zalgo obfuscation).`,
      redact: false,
    };
  }
  return null;
}

export default { checkZalgo };
