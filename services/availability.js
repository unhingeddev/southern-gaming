// services/availability.js
// Availability auto-responder. When the configured owner is @pinged in a message,
// the bot posts an "Availability" card showing the current time and a status
// derived from work hours (Mon–Fri 8AM–6PM by default). To avoid spam it replies
// at most once per channel per day (resets at midnight or via /availability reset).
//
// Modes:
//   auto       (default) → work-hours aware:
//                during work hours  → 🟡 "Currently at work – available sometimes"
//                outside work hours → 🟢 "Should be available"
//   available  → force 🟢 "Available"
//   away       → force 🔴 "Currently away"

import { EmbedBuilder } from 'discord.js';
import config from '../automod/config.js';
import { Store } from '../automod/db.js';
import { COLORS } from '../utils/embeds.js';
import logger from '../utils/logger.js';

const A = config.defaults.availability ?? {};
const USER_ID = A.userId || '';
const TZ = A.timezone || undefined; // undefined → host local time
const WH = A.workHours || { days: [1, 2, 3, 4, 5], startHour: 8, endHour: 18 };
const WH_LABEL = A.workHoursLabel || 'Mon–Fri 8AM – 6PM';
const ORANGE = COLORS.timeout ?? 0xe67e22;

// In-memory "answered today" per channel: channelId -> 'YYYY-MM-DD' (in TZ).
const answeredToday = new Map();

const DAY_MAP = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Date key (YYYY-MM-DD) in the configured timezone, for the daily reset. */
function dayKey(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Current weekday (0–6) and hour (0–23) in the configured timezone. */
function zonedNow() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour12: false, weekday: 'short', hour: '2-digit' }).formatToParts(new Date());
  const weekday = parts.find((p) => p.type === 'weekday')?.value;
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10) % 24;
  return { dow: DAY_MAP[weekday] ?? new Date().getDay(), hour };
}

/** Pretty current-time string, e.g. "Sun, 21 Jun 2026, 03:09:38 am". */
function prettyNow() {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
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

function isWorkHours() {
  const { dow, hour } = zonedNow();
  return WH.days.includes(dow) && hour >= WH.startHour && hour < WH.endHour;
}

/**
 * Build the Availability embed for a given mode ('auto' | 'available' | 'away').
 * @returns {EmbedBuilder}
 */
export function buildAvailabilityEmbed(mode = 'auto') {
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
  } else if (isWorkHours()) {
    color = ORANGE;
    status = '🟡 Currently at work – available sometimes';
    footer = `Work hours: ${WH_LABEL}`;
  } else {
    color = COLORS.success;
    status = '🟢 Should be available';
    footer = 'Outside work hours';
  }

  return new EmbedBuilder()
    .setColor(color)
    .setTitle('Availability')
    .addFields(
      { name: 'Current Time', value: prettyNow(), inline: true },
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

/** Clear the once-per-day-per-channel flags so it can answer again. */
export function resetDaily() {
  const n = answeredToday.size;
  answeredToday.clear();
  return n;
}

/**
 * Respond with the availability card if the owner was pinged. Self-guarded —
 * never throws. Called from messageCreate.
 */
export async function maybeRespondAvailability(message, _ctx) {
  try {
    if (!USER_ID) return;
    if (message.author?.bot || !message.guildId) return;
    if (!isEnabled()) return;

    // Only an explicit @mention of the owner in the message text triggers it
    // (avoids firing on reply-mentions and role pings).
    if (!new RegExp(`<@!?${USER_ID}>`).test(message.content || '')) return;
    if (message.author.id === USER_ID) return; // don't respond to the owner themselves

    // Once per channel per day.
    const key = message.channelId;
    const today = dayKey();
    if (answeredToday.get(key) === today) return;
    answeredToday.set(key, today);

    await message.channel.send({ embeds: [buildAvailabilityEmbed(currentMode())] });
  } catch (err) {
    logger.warn(`[availability] failed: ${err.message}`);
  }
}

export const OWNER_USER_ID = USER_ID;

export default { maybeRespondAvailability, buildAvailabilityEmbed, resetDaily, setEnabled, isEnabled, setMode, getMode, OWNER_USER_ID };
