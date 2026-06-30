// services/availability.js
// Availability auto-responder. When one of the tracked people is @pinged in a
// message, the bot REPLIES to that message with an "Availability" card showing
// THAT person's current local time (in their own timezone) and a status derived
// from their work hours (Mon–Fri 8AM–6PM by default).
//
// Supports multiple people, each with their own timezone — e.g. one on
// America/Los_Angeles (PDT/PST) and one on America/Chicago (CDT/CST). IANA zone
// names handle daylight-saving automatically.
//
// To avoid spam it replies at most once per channel per person per day (resets at
// midnight in that person's timezone, or via /availability reset). Test mode
// (/availability testmode) lifts that limit AND lets a tracked person trigger it
// by pinging themselves, so you can verify it live.
//
// Modes (global, set with /availability mode):
//   auto       (default) → work-hours aware (🟡 at work / 🟢 should be available)
//   available  → force 🟢 "Available"
//   away       → force 🔴 "Currently away"

import { EmbedBuilder } from 'discord.js';
import config from '../automod/config.js';
import { Store } from '../automod/db.js';
import { COLORS } from '../utils/embeds.js';
import logger from '../utils/logger.js';

const A = config.defaults.availability ?? {};
const ORANGE = COLORS.timeout ?? 0xe67e22;
const DEFAULT_WH = { days: [1, 2, 3, 4, 5], startHour: 8, endHour: 18 };
const DAY_MAP = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Normalise a person config entry, filling in defaults. */
function normalizePerson(p) {
  return {
    userId: String(p.userId),
    name: p.name || null,
    timezone: p.timezone || undefined, // undefined → host local time
    workHours: p.workHours || DEFAULT_WH,
    workHoursLabel: p.workHoursLabel || 'Mon–Fri 8AM – 6PM',
  };
}

/** Build the list of tracked people (new `people` array, or legacy single userId). */
function buildPeople() {
  if (Array.isArray(A.people) && A.people.length) {
    return A.people.filter((p) => p?.userId).map(normalizePerson);
  }
  if (A.userId) {
    return [normalizePerson(A)];
  }
  return [];
}

const PEOPLE = buildPeople();
const PEOPLE_BY_ID = new Map(PEOPLE.map((p) => [p.userId, p]));
export const TRACKED_USER_IDS = PEOPLE.map((p) => p.userId);

// In-memory "answered today": `${channelId}:${userId}` -> 'YYYY-MM-DD' (in their TZ).
const answeredToday = new Map();

/** Date key (YYYY-MM-DD) in a person's timezone, for the daily reset. */
function dayKey(person, d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: person.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** Current weekday (0–6) and hour (0–23) in a person's timezone. */
function zonedNow(person) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: person.timezone,
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
  }).formatToParts(new Date());
  const weekday = parts.find((p) => p.type === 'weekday')?.value;
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10) % 24;
  return { dow: DAY_MAP[weekday] ?? new Date().getDay(), hour };
}

/** Pretty current-time string in a person's timezone. */
function prettyNow(person) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: person.timezone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(new Date());
}

function isWorkHours(person) {
  const { dow, hour } = zonedNow(person);
  const wh = person.workHours || DEFAULT_WH;
  return wh.days.includes(dow) && hour >= wh.startHour && hour < wh.endHour;
}

/**
 * Build the Availability embed for a specific person and mode.
 * @param {object} person Normalised person config.
 * @param {'auto'|'available'|'away'} mode
 * @returns {EmbedBuilder}
 */
export function buildAvailabilityEmbed(person, mode = 'auto') {
  let color;
  let status;
  let footer;

  if (mode === 'away') {
    color = COLORS.danger;
    status = '🔴 Currently away';
    footer = 'Manually set to away';
  } else if (mode === 'available') {
    color = COLORS.success;
    status = '🟢 Available';
    footer = 'Manually set to available';
  } else if (isWorkHours(person)) {
    color = ORANGE;
    status = '🟡 Currently at work – available sometimes';
    footer = `Work hours: ${person.workHoursLabel}`;
  } else {
    color = COLORS.success;
    status = '🟢 Should be available';
    footer = 'Outside work hours';
  }

  if (person.timezone) footer += ` • ${person.timezone}`;

  return new EmbedBuilder()
    .setColor(color)
    .setTitle('🕒 Availability')
    .setDescription(`Availability for <@${person.userId}>`)
    .addFields(
      { name: 'Their Local Time', value: prettyNow(person), inline: true },
      { name: 'Status', value: status, inline: true }
    )
    .setFooter({ text: footer });
}

/** Current mode from persistent state (default 'auto'). */
function currentMode() {
  return Store.kvGet('avail:mode', 'auto');
}

/** Is the responder enabled? (persistent, default from config). */
export function isEnabled() {
  return Store.kvGet('avail:enabled', A.enabled ? '1' : '0') === '1';
}

export function setEnabled(on) {
  Store.kvSet('avail:enabled', on ? '1' : '0');
}

export function setMode(mode) {
  Store.kvSet('avail:mode', mode);
}

export function getMode() {
  return currentMode();
}

/** Test mode: lifts the daily limit and lets a tracked person ping themselves. */
export function isTestMode() {
  return Store.kvGet('avail:test', '0') === '1';
}

export function setTestMode(on) {
  Store.kvSet('avail:test', on ? '1' : '0');
}

/** Look up a tracked person by id (or null). */
export function getPerson(userId) {
  return PEOPLE_BY_ID.get(String(userId)) ?? null;
}

/** All tracked people (for the /availability test command). */
export function getPeople() {
  return PEOPLE;
}

/** Clear the once-per-day flags so it can answer again. */
export function resetDaily() {
  const n = answeredToday.size;
  answeredToday.clear();
  return n;
}

/**
 * Respond with an availability card if a tracked person was pinged. Replies to the
 * triggering message (so it visibly answers the asker). Self-guarded — never
 * throws. Called from messageCreate.
 */
export async function maybeRespondAvailability(message, _ctx) {
  try {
    if (!PEOPLE.length) return;
    if (message.author?.bot || !message.guildId) return;
    if (!isEnabled()) return;

    const content = message.content || '';
    const testing = isTestMode();
    const mode = currentMode();

    const embeds = [];
    for (const person of PEOPLE) {
      // Explicit @mention of this person in the message text (ignores role pings).
      if (!new RegExp(`<@!?${person.userId}>`).test(content)) continue;
      // Don't respond to a person pinging themselves — unless we're testing.
      if (message.author.id === person.userId && !testing) continue;

      // Once per channel per person per day (skipped in test mode).
      if (!testing) {
        const key = `${message.channelId}:${person.userId}`;
        const today = dayKey(person);
        if (answeredToday.get(key) === today) continue;
        answeredToday.set(key, today);
      }

      embeds.push(buildAvailabilityEmbed(person, mode));
    }

    if (!embeds.length) return;
    // Reply to the asker's message so it's a direct response (no extra ping).
    await message.reply({ embeds, allowedMentions: { repliedUser: false } });
  } catch (err) {
    logger.warn(`[availability] failed: ${err.message}`);
  }
}

export default {
  maybeRespondAvailability,
  buildAvailabilityEmbed,
  resetDaily,
  setEnabled,
  isEnabled,
  setMode,
  getMode,
  isTestMode,
  setTestMode,
  getPerson,
  getPeople,
  TRACKED_USER_IDS,
};
