// automod/wordFilter.js
// Word & content filter: blocked slurs/hate-speech (redacted in logs), an
// admin-managed per-guild blocklist, and editable solicitation / "e-horny"
// phrase patterns. Matching goes through normalize.js (leetspeak, zero-width,
// zalgo, repeats, separator padding all handled).

import config from './config.js';
import { Store } from './db.js';
import { findMatch } from './normalize.js';

const DEFAULTS = config.defaults;
const DEFAULT_SLURS = DEFAULTS.blocklist?.slurs ?? [];
const DEFAULT_GENERAL = DEFAULTS.blocklist?.general ?? [];
const SOLICITATION = DEFAULTS.solicitationPatterns ?? [];

const CACHE_TTL = 30_000;
const guildCache = new Map();

function guildTerms(guildId) {
  const cached = guildCache.get(guildId);
  if (cached && Date.now() - cached.at < CACHE_TTL) return cached;
  const rows = Store.listBlockwords(guildId);
  const entry = {
    at: Date.now(),
    slurs: rows.filter((r) => r.category === 'slur').map((r) => r.word),
    general: rows.filter((r) => r.category !== 'slur').map((r) => r.word),
  };
  guildCache.set(guildId, entry);
  return entry;
}

export function invalidateGuildCache(guildId) {
  guildCache.delete(guildId);
}

export function checkWordFilter(message) {
  const content = message.content;
  if (!content) return null;
  const { slurs, general } = guildTerms(message.guildId);

  const slurHit = findMatch(content, [...DEFAULT_SLURS, ...slurs]);
  if (slurHit) {
    return {
      rule: 'Word Filter — prohibited slur / hate speech',
      category: 'slur',
      reason: 'Message contained a prohibited slur or hate-speech term.',
      redact: true,
    };
  }

  const generalHit = findMatch(content, [...DEFAULT_GENERAL, ...general]);
  if (generalHit) {
    return {
      rule: 'Word Filter — blocked term',
      category: 'blocklist',
      reason: `Message contained a blocked term ("${generalHit}").`,
      redact: false,
    };
  }
  return null;
}

export function checkSolicitation(message) {
  const content = message.content;
  if (!content) return null;
  const hit = findMatch(content, SOLICITATION);
  if (hit) {
    return {
      rule: 'Content Filter — solicitation / suggestive',
      category: 'solicitation',
      reason: 'Message matched a solicitation / suggestive-content pattern.',
      redact: false,
    };
  }
  return null;
}

export default { checkWordFilter, checkSolicitation, invalidateGuildCache };
