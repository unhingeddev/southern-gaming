// services/payments.js
// Per-guild payment-method storage + embed builder for /paymentmethods and
// /setpayments. Values are stored as a small JSON blob in the auto-mod DB's
// generic key/value table (no changes to the main bot database).

import { EmbedBuilder } from 'discord.js';
import { Store } from '../automod/db.js';
import { COLORS } from '../utils/embeds.js';

const KEY = (guildId) => `payments:${guildId}`;
const FIELDS = ['paypal', 'cashapp', 'crypto'];

/** Get the saved methods for a guild: { paypal, cashapp, crypto }. */
export function getPayments(guildId) {
  const base = { paypal: '', cashapp: '', crypto: '' };
  const raw = Store.kvGet(KEY(guildId), null);
  if (!raw) return base;
  try {
    return { ...base, ...JSON.parse(raw) };
  } catch {
    return base;
  }
}

/** Merge `updates` (only the provided fields) into the saved methods. */
export function setPayments(guildId, updates) {
  const next = { ...getPayments(guildId) };
  for (const f of FIELDS) {
    if (updates[f] === undefined) continue;
    const v = String(updates[f]).trim();
    // "none"/"clear" wipes a field.
    next[f] = /^(none|clear)$/i.test(v) ? '' : v;
  }
  Store.kvSet(KEY(guildId), JSON.stringify(next));
  return next;
}

/** True if at least one method is configured. */
export function hasAnyPayment(guildId) {
  const p = getPayments(guildId);
  return Boolean(p.paypal || p.cashapp || p.crypto);
}

/** Build the public payment-methods embed. */
export function buildPaymentsEmbed(guildId) {
  const p = getPayments(guildId);
  const val = (v) => (v ? `\`${v}\`` : '_not set_');
  return new EmbedBuilder()
    .setColor(COLORS.success)
    .setTitle('💳 Payment Methods')
    .setDescription('Pay using any method below, then open a ticket with proof of payment.')
    .addFields(
      { name: '🅿️ PayPal', value: val(p.paypal) },
      { name: '💵 CashApp', value: val(p.cashapp) },
      { name: '🪙 Crypto', value: val(p.crypto) }
    )
    .setTimestamp();
}

export default { getPayments, setPayments, hasAnyPayment, buildPaymentsEmbed };
