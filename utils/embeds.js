// utils/embeds.js
// Centralised embed styling so every response looks consistent and professional.
// Also exposes a Discohook-compatible builder: pass a plain object shaped like a
// Discohook "embed" JSON and get back a discord.js EmbedBuilder.

import { EmbedBuilder } from 'discord.js';

// Brand palette — tweak these to match your shop's colours.
export const COLORS = {
  brand: 0x5865f2, // Discord blurple
  success: 0x57f287, // green
  warning: 0xfee75c, // yellow
  timeout: 0xe67e22, // orange → auto-mod timeout
  danger: 0xed4245, // red
  vouch: 0x76ff03, // lime green accent for vouch cards
  purchase: 0x57f287, // green for sales
  neutral: 0x2b2d31, // dark grey
};

// Default footer text. Left blank for now — branding will be added later.
// Set this to a string (e.g. "Powered by EGS") when you're ready to brand embeds.
const FOOTER_TEXT = '';

/** Base embed with a timestamp (and optional footer if FOOTER_TEXT is set). */
function base(color = COLORS.brand) {
  const embed = new EmbedBuilder().setColor(color).setTimestamp();
  if (FOOTER_TEXT) embed.setFooter({ text: FOOTER_TEXT });
  return embed;
}

/** Clamp a string to a max length (Discord field limits). */
function clip(value, max) {
  const s = String(value ?? '');
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/**
 * Convert various timestamp inputs to a Unix-seconds value for Discord's
 * <t:...:R> relative timestamps. Accepts ISO strings, Date, unix seconds, or
 * unix milliseconds. Defaults to "now" when missing/invalid.
 */
function toUnix(value) {
  if (value == null) return Math.floor(Date.now() / 1000);
  if (value instanceof Date) return Math.floor(value.getTime() / 1000);
  if (typeof value === 'number') return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
  const t = Date.parse(value);
  return Number.isFinite(t) ? Math.floor(t / 1000) : Math.floor(Date.now() / 1000);
}

export const Embeds = {
  /** Generic success message. */
  success(title, description) {
    return base(COLORS.success).setTitle(`✅ ${title}`).setDescription(description ?? null);
  },

  /** Generic error message. */
  error(title, description) {
    return base(COLORS.danger).setTitle(`❌ ${title}`).setDescription(description ?? null);
  },

  /** Generic warning/confirmation message. */
  warning(title, description) {
    return base(COLORS.warning).setTitle(`⚠️ ${title}`).setDescription(description ?? null);
  },

  /** Informational message. */
  info(title, description) {
    return base(COLORS.brand).setTitle(title).setDescription(description ?? null);
  },

  /**
   * Build a rich "Customer Vouch" card.
   * @param {object} v
   * @param {string} [v.productName]   Product purchased.
   * @param {string} [v.message]       The written review.
   * @param {number} [v.rating]        1–5 star rating.
   * @param {string} [v.customer]      Display name (used when there's no Discord user).
   * @param {string} [v.vouchBy]       A mention string like "<@123>" (preferred over customer).
   * @param {string} [v.authorName]    Header author line (e.g. the submitter's name).
   * @param {string} [v.authorIconUrl] Header author avatar.
   * @param {string|number|Date} [v.createdAt] When the vouch happened (defaults to now).
   * @param {string} [v.imageUrl]      Large image (e.g. an uploaded screenshot).
   */
  vouch(v = {}) {
    const rating = Math.max(0, Math.min(5, Math.round(v.rating || 0)));
    const stars = '⭐'.repeat(rating) + '▪️'.repeat(5 - rating);
    const by = v.vouchBy || v.customer || 'Anonymous';
    const whenUnix = toUnix(v.createdAt);

    const embed = new EmbedBuilder()
      .setColor(COLORS.vouch)
      .setTitle('⭐ Customer Vouch ⭐')
      .addFields(
        { name: 'Purchased', value: clip(v.productName || '—', 1024) },
        { name: 'Review', value: clip(v.message || '_No written review provided._', 1024) },
        { name: 'Rating (1-5):', value: stars },
        {
          name: '​', // zero-width header → renders as plain lines
          value: `**Vouch By:** ${by}\n**Vouched:** <t:${whenUnix}:R>`,
        }
      )
      .setFooter({ text: 'Vouch System' })
      .setTimestamp();

    if (v.authorName) {
      embed.setAuthor({ name: clip(v.authorName, 256), iconURL: v.authorIconUrl || undefined });
    }
    if (v.imageUrl) embed.setImage(v.imageUrl);

    return embed;
  },

  /**
   * Build an embed for a single purchase/order. Note: only non-sensitive fields
   * are ever surfaced — no emails, IPs, tokens, or payment details.
   * @param {object} order Normalised order object from the SellAuth service.
   */
  purchase(order) {
    return base(COLORS.purchase)
      .setAuthor({ name: '🛒 New Purchase' })
      .setTitle(order.productName || 'Order')
      .addFields(
        { name: 'Amount', value: order.amount || '—', inline: true },
        { name: 'Quantity', value: String(order.quantity ?? 1), inline: true },
        { name: 'Status', value: order.status || 'completed', inline: true }
      )
      .setDescription(`Order \`#${order.publicId ?? order.id}\``);
  },

  /**
   * Discohook-compatible builder. Accepts an object like:
   * { title, description, url, color, author:{name,icon_url,url},
   *   thumbnail:{url}, image:{url}, footer:{text,icon_url}, timestamp,
   *   fields:[{name,value,inline}] }
   * Color may be a hex string ("#5865F2") or an integer.
   * @param {object} data
   * @returns {EmbedBuilder}
   */
  fromDiscohook(data = {}) {
    const embed = new EmbedBuilder();

    if (data.title) embed.setTitle(String(data.title).slice(0, 256));
    if (data.description) embed.setDescription(String(data.description).slice(0, 4096));
    if (data.url) embed.setURL(data.url);

    if (data.color !== undefined) {
      const c =
        typeof data.color === 'string'
          ? parseInt(data.color.replace('#', ''), 16)
          : data.color;
      if (Number.isFinite(c)) embed.setColor(c);
    }

    if (data.author?.name) {
      embed.setAuthor({
        name: String(data.author.name).slice(0, 256),
        iconURL: data.author.icon_url || undefined,
        url: data.author.url || undefined,
      });
    }
    if (data.thumbnail?.url) embed.setThumbnail(data.thumbnail.url);
    if (data.image?.url) embed.setImage(data.image.url);
    if (data.footer?.text) {
      embed.setFooter({
        text: String(data.footer.text).slice(0, 2048),
        iconURL: data.footer.icon_url || undefined,
      });
    }
    if (data.timestamp) embed.setTimestamp(new Date(data.timestamp));

    if (Array.isArray(data.fields)) {
      embed.addFields(
        data.fields.slice(0, 25).map((f) => ({
          name: String(f.name ?? '​').slice(0, 256),
          value: String(f.value ?? '​').slice(0, 1024),
          inline: Boolean(f.inline),
        }))
      );
    }

    return embed;
  },
};

export default Embeds;
