// automod/linkFilter.js
// Link & embed control: blocks all links by default except an allowlist of
// verified GIF/CDN domains (+ per-guild additions); always blocks Discord
// invites anywhere (incl. nicknames); flags scam/phishing & NSFW patterns.

import config from './config.js';
import { Store } from './db.js';
import { normalizeForMatch } from './normalize.js';

const DEFAULTS = config.defaults;
const ALLOWED = (DEFAULTS.allowedLinkDomains ?? []).map((d) => d.toLowerCase());
const NSFW = (DEFAULTS.nsfwDomains ?? []).map((d) => d.toLowerCase());

const INVITE_RES = (DEFAULTS.invitePatterns ?? []).map((p) => new RegExp(p, 'i'));
const SCAM_RES = (DEFAULTS.scamPatterns ?? []).map((p) => new RegExp(p, 'i'));

const URL_RE = /\b((?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s]*)?)/gi;

// Common TLDs that mark a bare token as a real link (stops "e.g." / "main.py"
// false positives). A token is also a link if it has a scheme or a URL path.
const COMMON_TLDS = new Set([
  'com', 'net', 'org', 'io', 'gg', 'me', 'co', 'xyz', 'info', 'biz', 'tv', 'app',
  'dev', 'online', 'site', 'store', 'shop', 'link', 'click', 'fun', 'live', 'vip',
  'club', 'top', 'icu', 'cc', 'ws', 'ly', 'to', 'gd', 'ru', 'su', 'cn', 'de', 'uk',
  'fr', 'nl', 'eu', 'ca', 'us', 'in', 'br', 'jp', 'kr', 'es', 'it', 'pl',
  'se', 'no', 'fi', 'dk', 'ch', 'at', 'be', 'pt', 'cz', 'gr', 'tr', 'mx', 'ar',
  'za', 'ua', 'ro', 'hu', 'id', 'ph', 'vn', 'th', 'sg', 'hk', 'tw', 'gov', 'edu',
]);

function hostOf(token) {
  let t = token.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  t = t.split(/[/?#]/)[0];
  return t.toLowerCase();
}

function isAllowed(host, extraAllowed) {
  return [...ALLOWED, ...extraAllowed].some((d) => host === d || host.endsWith('.' + d));
}

export function hasInvite(text) {
  if (!text) return false;
  const norm = normalizeForMatch(text).replace(/\s+/g, '');
  const raw = String(text).replace(/\s+/g, '');
  return INVITE_RES.some((re) => re.test(raw) || re.test(norm));
}

export function checkInvites(message) {
  if (hasInvite(message.content)) {
    return {
      rule: 'Link Filter — Discord invite',
      category: 'invite',
      reason: 'Message contained a Discord invite link (not permitted).',
      redact: false,
    };
  }
  return null;
}

export function checkLinks(message) {
  const content = message.content;
  if (!content) return null;

  for (const re of SCAM_RES) {
    if (re.test(content)) {
      return {
        rule: 'Link Filter — scam / phishing pattern',
        category: 'scam',
        reason: 'Message matched a known scam / phishing pattern.',
        redact: false,
      };
    }
  }

  const extraAllowed = Store.listAllowDomains(message.guildId);
  const matches = content.match(URL_RE);
  if (!matches) return null;

  for (const token of matches) {
    const host = hostOf(token);
    if (!host.includes('.')) continue;

    const tld = host.split('.').pop();
    if (!/^[a-z]{2,}$/i.test(tld)) continue;
    const hasScheme = /^https?:\/\//i.test(token);
    const hasPath = /\/[^\s]/.test(token.replace(/^https?:\/\//i, ''));
    if (!hasScheme && !hasPath && !COMMON_TLDS.has(tld.toLowerCase())) continue;

    if (NSFW.some((d) => host === d || host.endsWith('.' + d))) {
      return {
        rule: 'Link Filter — NSFW link',
        category: 'nsfw',
        reason: 'Message contained an NSFW link.',
        redact: false,
      };
    }

    if (!isAllowed(host, extraAllowed)) {
      return {
        rule: 'Link Filter — link not allowed',
        category: 'link',
        reason: `Links are not permitted here (\`${host}\`). Only verified GIF/CDN sources are allowed.`,
        redact: false,
      };
    }
  }
  return null;
}

export default { hasInvite, checkInvites, checkLinks };
