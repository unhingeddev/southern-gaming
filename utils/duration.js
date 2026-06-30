// utils/duration.js
// Parse human-friendly durations like "30m", "2h", "1d 12h", "90s" into seconds,
// and format a number of seconds back into a compact "1d 2h 3m" string.

const UNIT_SECONDS = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
  w: 604800,
};

/**
 * Parse a duration string into seconds. Accepts one or more `<number><unit>`
 * tokens (whitespace optional), e.g. "30m", "2h", "1d12h", "1d 12h 30m".
 * Units: s, m, h, d, w. Returns null if nothing valid was found.
 * @param {string} input
 * @returns {number|null} total seconds, or null if unparseable
 */
export function parseDuration(input) {
  if (!input || typeof input !== 'string') return null;
  const re = /(\d+)\s*([smhdw])/gi;
  let total = 0;
  let matched = false;
  let m;
  while ((m = re.exec(input)) !== null) {
    matched = true;
    total += parseInt(m[1], 10) * UNIT_SECONDS[m[2].toLowerCase()];
  }
  return matched ? total : null;
}

/**
 * Format a number of seconds as a compact human string, e.g. 90 → "1m 30s".
 * Returns "0s" for non-positive input.
 * @param {number} seconds
 * @returns {string}
 */
export function formatDuration(seconds) {
  let s = Math.max(0, Math.floor(seconds));
  if (s === 0) return '0s';
  const parts = [];
  for (const [unit, size] of [['d', 86400], ['h', 3600], ['m', 60], ['s', 1]]) {
    if (s >= size) {
      parts.push(`${Math.floor(s / size)}${unit}`);
      s %= size;
    }
  }
  return parts.join(' ');
}
