// automod/splitFilter.js
// Catches slurs/blocked words split across MULTIPLE messages — the "vertical"
// bypass where each letter/fragment is its own message (N / I / GG / Er / …).
// We keep a short rolling buffer of each user's recent SHORT messages and run
// the normal word filter on their concatenation. Long messages are ignored here
// (the per-message filter already handles those), which keeps false positives
// near-zero: only deliberate short fragments get stitched together.

import { checkWordFilter } from './wordFilter.js';

const WINDOW_MS = 45_000;      // only stitch fragments sent within 45s
const MAX_FRAGMENTS = 15;      // cap how many we keep per user
const FRAGMENT_MAX_LEN = 6;    // a "fragment" is a short message (<= 6 chars trimmed)

const buffers = new Map(); // "guild:user" -> [{ id, content, ts }]

/**
 * @returns {object|null} violation (with `_messageIds` of the fragments to delete)
 */
export function checkSplitWord(message) {
  const content = (message.content || '').trim();
  // Only track short fragments. Normal-length messages are left to the per-message
  // filter and never stitched, so we don't accidentally merge real sentences.
  if (content.length === 0 || content.length > FRAGMENT_MAX_LEN) return null;

  const key = `${message.guildId}:${message.author.id}`;
  const now = Date.now();
  let buf = (buffers.get(key) ?? []).filter((m) => now - m.ts < WINDOW_MS);
  buf.push({ id: message.id, content, ts: now });
  if (buf.length > MAX_FRAGMENTS) buf = buf.slice(-MAX_FRAGMENTS);
  buffers.set(key, buf);

  if (buf.length < 2) return null;

  // Stitch the fragments together (no separator) and run the word filter. The
  // matcher's own word-boundary checks mean the term must start at the beginning
  // of the stitched run, so unrelated short messages won't trip it.
  const combined = buf.map((m) => m.content).join('');
  const v = checkWordFilter({ content: combined, guildId: message.guildId });
  if (!v) return null;

  buffers.set(key, []); // reset so we fire once, not on every following fragment
  return {
    rule: `${v.rule} (split across messages)`,
    category: v.category,
    reason: 'A blocked term was split across multiple messages.',
    redact: v.redact,
    content: combined,
    _messageIds: buf.map((m) => m.id),
  };
}

// Periodic cleanup so the buffer map can't grow unbounded.
setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS;
  for (const [k, arr] of buffers) {
    const kept = arr.filter((m) => m.ts > cutoff);
    if (kept.length) buffers.set(k, kept);
    else buffers.delete(k);
  }
}, 60_000).unref();

export default { checkSplitWord };
