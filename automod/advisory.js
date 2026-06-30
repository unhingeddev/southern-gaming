// automod/advisory.js
// Advisory ("soft") terms (e.g. "fn" → Fortnite/Fn key): instead of deleting +
// striking, post a friendly, rate-limited, self-deleting reminder. No punishment.

import config from './config.js';
import { findMatch } from './normalize.js';
import logger from '../utils/logger.js';

const TERMS = config.defaults.advisoryTerms ?? {};
const TERM_LIST = Object.keys(TERMS);

const COOLDOWN_MS = 60_000;
const lastNudge = new Map();

export function checkAdvisory(message) {
  if (!message.content || TERM_LIST.length === 0) return null;
  const term = findMatch(message.content, TERM_LIST);
  if (!term) return null;
  return { term, suggestion: TERMS[term] ?? '' };
}

export async function sendAdvisory(message, term, suggestion) {
  const key = `${message.guildId}:${message.author.id}`;
  const now = Date.now();
  if (now - (lastNudge.get(key) ?? 0) < COOLDOWN_MS) return;
  lastNudge.set(key, now);

  const hint = suggestion ? ` — did you mean **${suggestion}**?` : '';
  const text =
    `Heads up <@${message.author.id}>: \`${term}\` trips the filter${hint} ` +
    `Mind typing the full word next time? (No warning given — just a friendly nudge. 🙂)`;

  try {
    const reply = await message.reply({
      content: text,
      allowedMentions: { repliedUser: true, users: [message.author.id] },
    });
    setTimeout(() => reply.delete().catch(() => {}), 15_000).unref?.();
  } catch (err) {
    logger.debug(`[automod][${message.guildId}] advisory nudge failed: ${err.message}`);
  }
}

setInterval(() => {
  const cutoff = Date.now() - COOLDOWN_MS;
  for (const [k, t] of lastNudge) if (t < cutoff) lastNudge.delete(k);
}, 300_000).unref();

export default { checkAdvisory, sendAdvisory };
