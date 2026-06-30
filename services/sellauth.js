// services/sellauth.js
// Secure client for the SellAuth API.
//
// Design goals:
//  • Never expose secrets — API keys live only in memory/DB (encrypted) and are
//    sent as Bearer tokens; they are never logged or returned to Discord.
//  • Only non-sensitive fields are surfaced. Emails, IPs, payment tokens, and
//    similar PII are deliberately stripped in the normalisers below.
//  • Resilient: timeouts, exponential backoff, and graceful handling of 429s
//    (rate limiting) and 5xx outages.
//
// SellAuth's exact response shapes can vary by account/version, so the
// normalisers defensively read several possible field names.

import config from '../config/config.js';
import logger from '../utils/logger.js';

const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_RETRIES = 3;

/** Sleep helper for backoff. */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class SellAuthError extends Error {
  constructor(message, { status, retriable = false } = {}) {
    super(message);
    this.name = 'SellAuthError';
    this.status = status;
    this.retriable = retriable;
  }
}

export class SellAuthClient {
  /**
   * @param {object} opts
   * @param {string} opts.apiKey   Bearer token.
   * @param {string} [opts.shopId] Shop ID (required by most endpoints).
   * @param {string} [opts.baseUrl]
   */
  constructor({ apiKey, shopId, baseUrl } = {}) {
    if (!apiKey) throw new SellAuthError('No SellAuth API key configured.');
    this.apiKey = apiKey;
    this.shopId = shopId || config.sellauth.shopId || '';
    this.baseUrl = (baseUrl || config.sellauth.apiBase).replace(/\/+$/, '');
  }

  /**
   * Core request method with timeout + retry/backoff. Returns parsed JSON.
   * @param {string} pathname e.g. "/shops/123/feedback"
   * @param {object} [options] { method, query, body }
   */
  async request(pathname, { method = 'GET', query, body } = {}) {
    const url = new URL(this.baseUrl + pathname);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }

    let attempt = 0;
    let lastError;

    while (attempt < MAX_RETRIES) {
      attempt += 1;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

      try {
        const res = await fetch(url, {
          method,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });
        clearTimeout(timer);

        // Rate limited — respect Retry-After, then back off.
        if (res.status === 429) {
          const retryAfter = Number(res.headers.get('retry-after')) || 2 ** attempt;
          logger.warn(`SellAuth rate limited (429). Waiting ${retryAfter}s before retry.`);
          await sleep(retryAfter * 1000);
          continue;
        }

        // Server-side outage — retry with exponential backoff.
        if (res.status >= 500) {
          lastError = new SellAuthError(`SellAuth server error (${res.status}).`, {
            status: res.status,
            retriable: true,
          });
          await sleep(2 ** attempt * 250);
          continue;
        }

        // Client errors — do not retry, surface a clean message.
        if (res.status === 401 || res.status === 403) {
          throw new SellAuthError('Authentication failed — check the API key/permissions.', {
            status: res.status,
          });
        }
        if (!res.ok) {
          throw new SellAuthError(`SellAuth request failed (${res.status}).`, {
            status: res.status,
          });
        }

        // Validate we actually got JSON back.
        const text = await res.text();
        if (!text) return {};
        try {
          return JSON.parse(text);
        } catch {
          throw new SellAuthError('SellAuth returned a malformed (non-JSON) response.');
        }
      } catch (err) {
        clearTimeout(timer);
        if (err.name === 'AbortError') {
          lastError = new SellAuthError('SellAuth request timed out.', { retriable: true });
          await sleep(2 ** attempt * 250);
          continue;
        }
        // Non-retriable SellAuthError — rethrow immediately.
        if (err instanceof SellAuthError && !err.retriable) throw err;
        lastError = err;
        await sleep(2 ** attempt * 250);
      }
    }

    throw lastError ?? new SellAuthError('SellAuth request failed after retries.');
  }

  /**
   * Lightweight connectivity/auth check. Tries to read the shop; returns a
   * boolean-ish result object without throwing for "expected" auth failures.
   */
  async testConnection() {
    try {
      // Prefer a shop-scoped endpoint when a shop ID is known; otherwise hit a
      // generic endpoint that simply requires a valid token.
      const path = this.shopId ? `/shops/${this.shopId}` : '/shops';
      await this.request(path);
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err.message, status: err.status };
    }
  }

  /**
   * Fetch the latest vouches/reviews (feedback).
   * @param {number} [limit=5]
   * @returns {Promise<object[]>} Normalised, sanitised vouch objects.
   */
  async getVouches(limit = 5) {
    const path = this.shopId ? `/shops/${this.shopId}/feedbacks` : '/feedbacks';
    const data = await this.request(path, {
      query: { perPage: limit, limit, sort: 'created_at', direction: 'desc' },
    });
    return extractArray(data).slice(0, limit).map(normaliseVouch);
  }

  /**
   * Fetch the most recent purchases/orders (invoices).
   * @param {number} [limit=5]
   * @returns {Promise<object[]>} Normalised, sanitised order objects.
   */
  async getRecentPurchases(limit = 5) {
    const path = this.shopId ? `/shops/${this.shopId}/invoices` : '/invoices';
    const data = await this.request(path, {
      query: { perPage: limit, limit, status: 'completed', sort: 'created_at', direction: 'desc' },
    });
    return extractArray(data).slice(0, limit).map(normaliseOrder);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * SellAuth (and many APIs) wrap lists differently: a bare array, { data: [] },
 * or a paginated { data: { data: [] } }. This digs out the actual array.
 */
function extractArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.data)) return payload.data.data;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
}

/** Pick the first defined value among several candidate keys. */
function pick(obj, ...keys) {
  for (const k of keys) {
    if (obj?.[k] !== undefined && obj?.[k] !== null && obj?.[k] !== '') return obj[k];
  }
  return undefined;
}

/**
 * Normalise a raw vouch/feedback object to a safe, display-only shape.
 * IMPORTANT: never copies email/ip/customer PII beyond a display name.
 */
function normaliseVouch(raw = {}) {
  const product = raw.product || raw.item || {};
  return {
    id: String(pick(raw, 'id', 'uuid', 'feedback_id') ?? cryptoRandomId()),
    rating: Number(pick(raw, 'rating', 'stars', 'score') ?? 0),
    message: sanitiseText(pick(raw, 'message', 'comment', 'review', 'body')),
    productName: sanitiseText(pick(product, 'name', 'title') ?? pick(raw, 'product_name')),
    // Only a display name/initial — never the email/IP.
    customer: sanitiseText(pick(raw, 'customer_name', 'username', 'display_name') ?? 'Anonymous'),
    createdAt: pick(raw, 'created_at', 'createdAt', 'date'),
  };
}

/**
 * Normalise a raw order/invoice object to a safe, display-only shape.
 * Strips emails, IPs, payment tokens, and gateway metadata.
 */
function normaliseOrder(raw = {}) {
  const product = raw.product || (Array.isArray(raw.items) ? raw.items[0] : {}) || {};
  const currency = pick(raw, 'currency', 'currency_code') ?? 'USD';
  const price = pick(raw, 'total', 'price', 'amount', 'price_usd');
  return {
    id: String(pick(raw, 'id', 'uuid', 'invoice_id') ?? cryptoRandomId()),
    publicId: pick(raw, 'public_id', 'short_id', 'reference') ?? pick(raw, 'id'),
    productName: sanitiseText(pick(product, 'name', 'title') ?? pick(raw, 'product_name') ?? 'Product'),
    quantity: Number(pick(raw, 'quantity', 'qty') ?? 1),
    amount: price !== undefined ? `${formatMoney(price)} ${currency}` : undefined,
    status: sanitiseText(pick(raw, 'status', 'state') ?? 'completed'),
    createdAt: pick(raw, 'created_at', 'createdAt', 'date'),
  };
}

/** Best-effort money formatting. */
function formatMoney(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : String(value);
}

/** Trim/limit free text and strip anything resembling an email or IP as defence-in-depth. */
function sanitiseText(value) {
  if (value === undefined || value === null) return undefined;
  return String(value)
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[redacted]') // emails
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '[redacted]') // IPv4
    .slice(0, 1000)
    .trim();
}

/** Fallback ID when the API omits one (keeps dedupe working). */
function cryptoRandomId() {
  return 'gen_' + Math.random().toString(36).slice(2, 12);
}

/**
 * Build a SellAuthClient for a guild, preferring the guild's own credentials and
 * falling back to the global env config. Returns null if no key is available.
 * @param {import('../database/db.js').Store} Store
 */
export function clientForGuild(Store, guildId) {
  const apiKey = Store.getApiKey(guildId) || config.sellauth.apiKey || null;
  if (!apiKey) return null;
  const row = Store.getGuild(guildId);
  const shopId = row?.shop_id || config.sellauth.shopId || '';
  return new SellAuthClient({ apiKey, shopId });
}
