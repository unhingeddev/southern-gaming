// src/modules/normalize.js
// Text normalisation + bypass-resistant matching. This is the core that lets the
// word filter defeat leetspeak (@→a, 3→e…), zero-width-character injection,
// zalgo/combining marks, repeated letters (niiigger), and separator padding
// (n.i.g.g.e.r / "n i g g e r").
//
// All special-character ranges are written as \u escapes (pure ASCII source) so
// there are no invisible bytes in this file to get mangled by editors/tooling.

// Zero-width & direction-control characters used to break up words invisibly.
const ZERO_WIDTH = /[­᠎​-‏‪-‮⁠-⁤﻿]/g;

// Combining diacritical marks (the building blocks of "zalgo" text).
const COMBINING =
  /[̀-ͯ҃-҉ؐ-ًؚ-ٰٟۖ-ۜัิ-ฺ็-๎᪰-᫿᷀-᷿⃐-⃿︠-︯]/g;

// Common leetspeak / homoglyph substitutions → their plain letter.
const LEET_MAP = {
  '@': 'a', '4': 'a', '^': 'a',
  '8': 'b',
  '(': 'c', '<': 'c', '{': 'c',
  '3': 'e', '€': 'e', '£': 'e',
  '6': 'g', '9': 'g',
  '1': 'i', '!': 'i', '|': 'i',
  '0': 'o',
  '5': 's', '$': 's',
  '7': 't', '+': 't',
  '2': 'z',
};

/** Remove zero-width / direction-control characters. */
export function stripZeroWidth(text) {
  return String(text ?? '').replace(ZERO_WIDTH, '');
}

/** Remove combining marks (de-zalgo). */
export function stripCombining(text) {
  // Normalise to NFKD first so accented glyphs decompose into base + mark, then
  // drop the marks — this also folds many homoglyphs to ASCII.
  return String(text ?? '').normalize('NFKD').replace(COMBINING, '');
}

/** Count combining marks — used by the zalgo detector. */
export function countCombining(text) {
  const m = String(text ?? '').normalize('NFKD').match(COMBINING);
  return m ? m.length : 0;
}

/** Apply leetspeak substitutions (after lowercasing). */
function deLeet(text) {
  let out = '';
  for (const ch of text) out += LEET_MAP[ch] ?? ch;
  return out;
}

/**
 * Full normalisation pipeline for content matching:
 * lowercase → strip zero-width → de-zalgo → de-leet.
 * Preserves spaces/punctuation so callers can reason about separators.
 */
export function normalizeForMatch(text) {
  let t = String(text ?? '').toLowerCase();
  t = stripZeroWidth(t);
  t = stripCombining(t);
  t = deLeet(t);
  return t;
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Cache compiled matchers so we don't rebuild a regex per message per term.
const matcherCache = new Map();

/**
 * Build a bypass-tolerant matcher for one blocked term/phrase.
 * The generated regex, run against normalised text, matches the term even when:
 *   • letters are repeated  (ni+gg+er+)
 *   • up to 3 separator chars sit between letters (n . i . g)
 *   • it is a multi-word phrase (spaces collapse to the same separator class)
 * Alphanumeric boundaries on both ends keep "class" from matching inside
 * "classic" (mitigates the Scunthorpe problem).
 * @param {string} term
 * @returns {RegExp|null}
 */
export function buildMatcher(term) {
  if (matcherCache.has(term)) return matcherCache.get(term);

  const norm = normalizeForMatch(term);
  const chars = norm.replace(/[^a-z0-9]/g, '').split('');
  if (chars.length === 0) {
    matcherCache.set(term, null);
    return null;
  }

  const body = chars.map((c) => escapeRegex(c) + '+').join('[^a-z0-9]{0,3}');
  let re;
  try {
    re = new RegExp(`(?<![a-z0-9])${body}(?![a-z0-9])`, 'i');
  } catch {
    re = null;
  }
  matcherCache.set(term, re);
  return re;
}

/**
 * Does `text` contain any of `terms`? Returns the first matched term or null.
 * @param {string} text
 * @param {string[]} terms
 * @returns {string|null}
 */
export function findMatch(text, terms) {
  const norm = normalizeForMatch(text);
  if (!norm) return null;
  for (const term of terms) {
    const re = buildMatcher(term);
    if (re && re.test(norm)) return term;
  }
  return null;
}

export default { stripZeroWidth, stripCombining, countCombining, normalizeForMatch, buildMatcher, findMatch };
