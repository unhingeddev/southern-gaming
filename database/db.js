// database/db.js
// SQLite persistence using Node's built-in `node:sqlite` module (Node 22.5+),
// so there are NO native build dependencies. Exposes a thin, well-typed query
// layer used across the bot. All schema creation is idempotent so the app is
// safe to start repeatedly.

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encrypt, decrypt } from '../utils/crypto.js';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'bot.sqlite'));
// WAL mode = better concurrency + durability; foreign keys for integrity.
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// ── Schema ─────────────────────────────────────────────────────────────────
// One row per guild holds all configuration. API keys are stored encrypted.
db.exec(`
  CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id            TEXT PRIMARY KEY,
    api_key_encrypted   TEXT,
    shop_id             TEXT,
    vouch_channel_id    TEXT,
    purchase_channel_id TEXT,
    log_channel_id      TEXT,
    vouches_enabled     INTEGER NOT NULL DEFAULT 0,
    purchases_enabled   INTEGER NOT NULL DEFAULT 0,
    created_at          INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at          INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  -- Tracks which vouch/purchase IDs have already been posted, to avoid duplicates.
  CREATE TABLE IF NOT EXISTS posted_items (
    guild_id   TEXT NOT NULL,
    kind       TEXT NOT NULL,          -- 'vouch' | 'purchase'
    item_id    TEXT NOT NULL,
    posted_at  INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    PRIMARY KEY (guild_id, kind, item_id)
  );

  -- Generic key/value bot settings (e.g. schema version, feature flags).
  CREATE TABLE IF NOT EXISTS bot_settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  -- Per-event log channels (leave | ban | kick | embed). One row per type/guild.
  CREATE TABLE IF NOT EXISTS log_channels (
    guild_id   TEXT NOT NULL,
    log_type   TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    PRIMARY KEY (guild_id, log_type)
  );

  -- Rotating presence/status lines. Global to the bot (presence is not per-guild).
  CREATE TABLE IF NOT EXISTS statuses (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    text       TEXT NOT NULL,
    type       TEXT NOT NULL DEFAULT 'Watching', -- Playing|Listening|Watching|Competing|Custom
    presence   TEXT NOT NULL DEFAULT 'online',   -- online|idle|dnd
    duration   INTEGER NOT NULL DEFAULT 30,      -- seconds to show before rotating
    added_by   TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  -- Named roles per guild (owner, coowner, staff, buyers, members, …).
  CREATE TABLE IF NOT EXISTS guild_roles (
    guild_id TEXT NOT NULL,
    role_key TEXT NOT NULL,   -- owner | coowner | staff | buyers | members
    role_id  TEXT NOT NULL,
    PRIMARY KEY (guild_id, role_key)
  );

  -- Roles automatically assigned to members when they join a guild.
  CREATE TABLE IF NOT EXISTS autoroles (
    guild_id TEXT NOT NULL,
    role_id  TEXT NOT NULL,
    PRIMARY KEY (guild_id, role_id)
  );

  -- Open/closed support tickets. One row per ticket channel.
  CREATE TABLE IF NOT EXISTS tickets (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id      TEXT NOT NULL,
    channel_id    TEXT NOT NULL UNIQUE,
    opener_id     TEXT NOT NULL,
    number        INTEGER NOT NULL,
    ticket_type   TEXT,
    status        TEXT NOT NULL DEFAULT 'open',     -- open | closed
    claimed_by    TEXT,
    last_activity INTEGER,                          -- unix secs of last human message
    close_at      INTEGER,                          -- scheduled close time (unix secs)
    close_kind    TEXT,                             -- 'inactivity' | 'closeall'
    created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    closed_at     INTEGER
  );

  -- Ticket types shown in a dropdown panel (multi-option tickets).
  CREATE TABLE IF NOT EXISTS ticket_categories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id    TEXT NOT NULL,
    label       TEXT NOT NULL,
    description TEXT,
    emoji       TEXT,
    created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  -- Giveaways. One row per giveaway; the message holds the "Enter" button.
  -- Like tickets, ending is driven by a stored end_at + a sweeper (not setTimeout)
  -- so pending giveaways survive bot restarts.
  CREATE TABLE IF NOT EXISTS giveaways (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id         TEXT NOT NULL,
    channel_id       TEXT NOT NULL,
    message_id       TEXT,
    prize            TEXT NOT NULL,
    winners_count    INTEGER NOT NULL DEFAULT 1,
    host_id          TEXT NOT NULL,
    required_role_id TEXT,                            -- optional entry gate
    end_at           INTEGER NOT NULL,                -- unix secs the giveaway ends
    ended            INTEGER NOT NULL DEFAULT 0,      -- 0 = running, 1 = drawn
    winner_ids       TEXT,                            -- JSON array of winner user IDs
    created_at       INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  -- One row per entrant per giveaway.
  CREATE TABLE IF NOT EXISTS giveaway_entries (
    giveaway_id INTEGER NOT NULL,
    user_id     TEXT NOT NULL,
    entered_at  INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    PRIMARY KEY (giveaway_id, user_id),
    FOREIGN KEY (giveaway_id) REFERENCES giveaways(id) ON DELETE CASCADE
  );
`);

// ── Lightweight migrations ───────────────────────────────────────────────────
// CREATE TABLE IF NOT EXISTS won't add columns to a table that already exists,
// so add any newly-introduced columns here if they're missing.
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
    logger.info(`Migration: added column ${table}.${column}.`);
  }
}
ensureColumn('statuses', 'duration', 'duration INTEGER NOT NULL DEFAULT 30');
// Ticket configuration lives alongside other per-guild settings.
ensureColumn('guild_settings', 'support_role_id', 'support_role_id TEXT');
ensureColumn('guild_settings', 'ticket_category_id', 'ticket_category_id TEXT');
ensureColumn('tickets', 'ticket_type', 'ticket_type TEXT');
ensureColumn('tickets', 'last_activity', 'last_activity INTEGER');
ensureColumn('tickets', 'close_at', 'close_at INTEGER');
ensureColumn('tickets', 'close_kind', 'close_kind TEXT');
ensureColumn('guild_settings', 'ticket_inactivity_minutes', 'ticket_inactivity_minutes INTEGER NOT NULL DEFAULT 0');

// ── Prepared statements ──────────────────────────────────────────────────────
const stmts = {
  upsertGuild: db.prepare(`
    INSERT INTO guild_settings (guild_id) VALUES (?)
    ON CONFLICT(guild_id) DO NOTHING
  `),
  getGuild: db.prepare(`SELECT * FROM guild_settings WHERE guild_id = ?`),
  allGuilds: db.prepare(`SELECT * FROM guild_settings`),

  setApiKey: db.prepare(
    `UPDATE guild_settings SET api_key_encrypted = ?, updated_at = strftime('%s','now') WHERE guild_id = ?`
  ),
  setShopId: db.prepare(
    `UPDATE guild_settings SET shop_id = ?, updated_at = strftime('%s','now') WHERE guild_id = ?`
  ),
  setVouchChannel: db.prepare(
    `UPDATE guild_settings SET vouch_channel_id = ?, updated_at = strftime('%s','now') WHERE guild_id = ?`
  ),
  setPurchaseChannel: db.prepare(
    `UPDATE guild_settings SET purchase_channel_id = ?, updated_at = strftime('%s','now') WHERE guild_id = ?`
  ),
  setLogChannel: db.prepare(
    `UPDATE guild_settings SET log_channel_id = ?, updated_at = strftime('%s','now') WHERE guild_id = ?`
  ),
  setVouchesEnabled: db.prepare(
    `UPDATE guild_settings SET vouches_enabled = ?, updated_at = strftime('%s','now') WHERE guild_id = ?`
  ),
  setPurchasesEnabled: db.prepare(
    `UPDATE guild_settings SET purchases_enabled = ?, updated_at = strftime('%s','now') WHERE guild_id = ?`
  ),

  hasPosted: db.prepare(
    `SELECT 1 AS hit FROM posted_items WHERE guild_id = ? AND kind = ? AND item_id = ?`
  ),
  markPosted: db.prepare(
    `INSERT OR IGNORE INTO posted_items (guild_id, kind, item_id) VALUES (?, ?, ?)`
  ),
  // Prune old posted-item rows so the table stays small (keeps last 500 per guild/kind).
  prunePosted: db.prepare(`
    DELETE FROM posted_items
    WHERE guild_id = ? AND kind = ? AND item_id NOT IN (
      SELECT item_id FROM posted_items
      WHERE guild_id = ? AND kind = ?
      ORDER BY posted_at DESC LIMIT 500
    )
  `),

  setNamedRole: db.prepare(`
    INSERT INTO guild_roles (guild_id, role_key, role_id) VALUES (?, ?, ?)
    ON CONFLICT(guild_id, role_key) DO UPDATE SET role_id = excluded.role_id
  `),
  getNamedRoles: db.prepare(`SELECT role_key, role_id FROM guild_roles WHERE guild_id = ?`),
  addAutorole: db.prepare(`INSERT OR IGNORE INTO autoroles (guild_id, role_id) VALUES (?, ?)`),
  removeAutorole: db.prepare(`DELETE FROM autoroles WHERE guild_id = ? AND role_id = ?`),
  getAutoroles: db.prepare(`SELECT role_id FROM autoroles WHERE guild_id = ?`),

  setSupportRole: db.prepare(
    `UPDATE guild_settings SET support_role_id = ?, updated_at = strftime('%s','now') WHERE guild_id = ?`
  ),
  setTicketCategory: db.prepare(
    `UPDATE guild_settings SET ticket_category_id = ?, updated_at = strftime('%s','now') WHERE guild_id = ?`
  ),
  nextTicketNumber: db.prepare(
    `SELECT COALESCE(MAX(number), 0) + 1 AS n FROM tickets WHERE guild_id = ?`
  ),
  insertTicket: db.prepare(
    `INSERT INTO tickets (guild_id, channel_id, opener_id, number, ticket_type, last_activity)
     VALUES (?, ?, ?, ?, ?, strftime('%s','now'))`
  ),
  touchTicket: db.prepare(
    `UPDATE tickets SET last_activity = strftime('%s','now') WHERE channel_id = ? AND status = 'open'`
  ),
  openTickets: db.prepare(`SELECT * FROM tickets WHERE status = 'open'`),
  scheduleClose: db.prepare(
    `UPDATE tickets SET close_at = ?, close_kind = ? WHERE channel_id = ? AND status = 'open'`
  ),
  cancelClose: db.prepare(
    `UPDATE tickets SET close_at = NULL, close_kind = NULL WHERE channel_id = ?`
  ),
  setInactivity: db.prepare(
    `UPDATE guild_settings SET ticket_inactivity_minutes = ?, updated_at = strftime('%s','now') WHERE guild_id = ?`
  ),
  addTicketCategory: db.prepare(
    `INSERT INTO ticket_categories (guild_id, label, description, emoji) VALUES (?, ?, ?, ?)`
  ),
  getTicketCategories: db.prepare(`SELECT * FROM ticket_categories WHERE guild_id = ? ORDER BY id ASC`),
  getTicketCategory: db.prepare(`SELECT * FROM ticket_categories WHERE id = ? AND guild_id = ?`),
  removeTicketCategory: db.prepare(`DELETE FROM ticket_categories WHERE id = ? AND guild_id = ?`),
  getTicketByChannel: db.prepare(`SELECT * FROM tickets WHERE channel_id = ?`),
  getOpenTicketByUser: db.prepare(
    `SELECT * FROM tickets WHERE guild_id = ? AND opener_id = ? AND status = 'open' LIMIT 1`
  ),
  closeTicket: db.prepare(
    `UPDATE tickets SET status = 'closed', closed_at = strftime('%s','now') WHERE channel_id = ?`
  ),
  claimTicket: db.prepare(`UPDATE tickets SET claimed_by = ? WHERE channel_id = ?`),

  addStatus: db.prepare(
    `INSERT INTO statuses (text, type, presence, duration, added_by) VALUES (?, ?, ?, ?, ?)`
  ),
  getStatuses: db.prepare(`SELECT * FROM statuses ORDER BY id ASC`),
  getStatus: db.prepare(`SELECT * FROM statuses WHERE id = ?`),
  removeStatus: db.prepare(`DELETE FROM statuses WHERE id = ?`),
  clearStatuses: db.prepare(`DELETE FROM statuses`),
  countStatuses: db.prepare(`SELECT COUNT(*) AS n FROM statuses`),

  // ── Giveaways ──────────────────────────────────────────────────────────────
  insertGiveaway: db.prepare(`
    INSERT INTO giveaways (guild_id, channel_id, prize, winners_count, host_id, required_role_id, end_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
  setGiveawayMessage: db.prepare(`UPDATE giveaways SET message_id = ? WHERE id = ?`),
  getGiveaway: db.prepare(`SELECT * FROM giveaways WHERE id = ?`),
  getGiveawayByMessage: db.prepare(`SELECT * FROM giveaways WHERE message_id = ?`),
  // Active giveaways across all guilds — used by the sweeper.
  activeGiveaways: db.prepare(`SELECT * FROM giveaways WHERE ended = 0`),
  // Most recent giveaways for one guild — used by /giveaway list.
  guildGiveaways: db.prepare(`SELECT * FROM giveaways WHERE guild_id = ? ORDER BY id DESC LIMIT ?`),
  markGiveawayEnded: db.prepare(`UPDATE giveaways SET ended = 1, winner_ids = ? WHERE id = ?`),
  setGiveawayWinners: db.prepare(`UPDATE giveaways SET winner_ids = ? WHERE id = ?`),

  addGiveawayEntry: db.prepare(`INSERT OR IGNORE INTO giveaway_entries (giveaway_id, user_id) VALUES (?, ?)`),
  removeGiveawayEntry: db.prepare(`DELETE FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?`),
  hasGiveawayEntry: db.prepare(`SELECT 1 AS hit FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?`),
  countGiveawayEntries: db.prepare(`SELECT COUNT(*) AS n FROM giveaway_entries WHERE giveaway_id = ?`),
  getGiveawayEntries: db.prepare(`SELECT user_id FROM giveaway_entries WHERE giveaway_id = ?`),

  setEventLog: db.prepare(`
    INSERT INTO log_channels (guild_id, log_type, channel_id) VALUES (?, ?, ?)
    ON CONFLICT(guild_id, log_type) DO UPDATE SET channel_id = excluded.channel_id
  `),
  getEventLog: db.prepare(`SELECT channel_id FROM log_channels WHERE guild_id = ? AND log_type = ?`),
  getAllEventLogs: db.prepare(`SELECT log_type, channel_id FROM log_channels WHERE guild_id = ?`),
  removeEventLog: db.prepare(`DELETE FROM log_channels WHERE guild_id = ? AND log_type = ?`),
};

/** Ensure a guild row exists, then return it. */
function ensureGuild(guildId) {
  stmts.upsertGuild.run(guildId);
  return stmts.getGuild.get(guildId);
}

// ── Public API ───────────────────────────────────────────────────────────────
export const Store = {
  /** Fetch a guild's settings (creating an empty row if needed). */
  getGuild(guildId) {
    return ensureGuild(guildId);
  },

  /** All guilds that have any settings — used by the automation poller. */
  getAllGuilds() {
    return stmts.allGuilds.all();
  },

  /** Store an API key encrypted at rest. */
  setApiKey(guildId, apiKey) {
    ensureGuild(guildId);
    stmts.setApiKey.run(encrypt(apiKey), guildId);
  },

  /** Decrypt and return a guild's API key, or null if unset/corrupt. */
  getApiKey(guildId) {
    const row = ensureGuild(guildId);
    if (!row?.api_key_encrypted) return null;
    return decrypt(row.api_key_encrypted);
  },

  setShopId(guildId, shopId) {
    ensureGuild(guildId);
    stmts.setShopId.run(shopId, guildId);
  },
  setVouchChannel(guildId, channelId) {
    ensureGuild(guildId);
    stmts.setVouchChannel.run(channelId, guildId);
  },
  setPurchaseChannel(guildId, channelId) {
    ensureGuild(guildId);
    stmts.setPurchaseChannel.run(channelId, guildId);
  },
  setLogChannel(guildId, channelId) {
    ensureGuild(guildId);
    stmts.setLogChannel.run(channelId, guildId);
  },
  setVouchesEnabled(guildId, enabled) {
    ensureGuild(guildId);
    stmts.setVouchesEnabled.run(enabled ? 1 : 0, guildId);
  },
  setPurchasesEnabled(guildId, enabled) {
    ensureGuild(guildId);
    stmts.setPurchasesEnabled.run(enabled ? 1 : 0, guildId);
  },

  /** Has this item already been posted for this guild? */
  hasPosted(guildId, kind, itemId) {
    return Boolean(stmts.hasPosted.get(guildId, kind, String(itemId)));
  },

  /** Mark an item as posted and prune old history. */
  markPosted(guildId, kind, itemId) {
    stmts.markPosted.run(guildId, kind, String(itemId));
    stmts.prunePosted.run(guildId, kind, guildId, kind);
  },

  // ── Roles & auto-roles ───────────────────────────────────────────────────
  /** Set a named role (owner|coowner|staff|buyers|members). */
  setNamedRole(guildId, key, roleId) {
    stmts.setNamedRole.run(guildId, key, roleId);
  },
  /** Return named roles as an object: { owner, coowner, staff, buyers, members }. */
  getNamedRoles(guildId) {
    const out = {};
    for (const row of stmts.getNamedRoles.all(guildId)) out[row.role_key] = row.role_id;
    return out;
  },
  /** Add a role to the auto-assign-on-join list. */
  addAutorole(guildId, roleId) {
    stmts.addAutorole.run(guildId, roleId);
  },
  /** Remove a role from the auto-assign list. Returns true if removed. */
  removeAutorole(guildId, roleId) {
    return stmts.removeAutorole.run(guildId, roleId).changes > 0;
  },
  /** Array of role IDs auto-assigned on join. */
  getAutoroles(guildId) {
    return stmts.getAutoroles.all(guildId).map((r) => r.role_id);
  },

  // ── Tickets ────────────────────────────────────────────────────────────────
  setSupportRole(guildId, roleId) {
    ensureGuild(guildId);
    stmts.setSupportRole.run(roleId, guildId);
  },
  setTicketCategory(guildId, categoryId) {
    ensureGuild(guildId);
    stmts.setTicketCategory.run(categoryId, guildId);
  },
  /** Next sequential ticket number for a guild. */
  nextTicketNumber(guildId) {
    return stmts.nextTicketNumber.get(guildId).n;
  },
  /** Record a new open ticket (ticketType optional, for dropdown panels). */
  createTicket(guildId, channelId, openerId, number, ticketType = null) {
    stmts.insertTicket.run(guildId, channelId, openerId, number, ticketType);
  },
  /** Add a ticket category (dropdown option). Returns its id. */
  addTicketCategory(guildId, label, description, emoji) {
    return Number(stmts.addTicketCategory.run(guildId, label, description ?? null, emoji ?? null).lastInsertRowid);
  },
  getTicketCategories(guildId) {
    return stmts.getTicketCategories.all(guildId);
  },
  getTicketCategory(id, guildId) {
    return stmts.getTicketCategory.get(id, guildId);
  },
  removeTicketCategory(id, guildId) {
    return stmts.removeTicketCategory.run(id, guildId).changes > 0;
  },
  getTicketByChannel(channelId) {
    return stmts.getTicketByChannel.get(channelId);
  },
  getOpenTicketByUser(guildId, openerId) {
    return stmts.getOpenTicketByUser.get(guildId, openerId);
  },
  closeTicketByChannel(channelId) {
    stmts.closeTicket.run(channelId);
  },
  claimTicket(channelId, userId) {
    stmts.claimTicket.run(userId, channelId);
  },
  /** Mark a ticket channel as having recent (human) activity. */
  touchTicketActivity(channelId) {
    stmts.touchTicket.run(channelId);
  },
  /** All currently-open tickets (across guilds) — used by the sweeper. */
  getOpenTickets() {
    return stmts.openTickets.all();
  },
  /** Schedule a ticket to close at `closeAt` (unix secs) for the given reason. */
  scheduleTicketClose(channelId, closeAt, kind) {
    stmts.scheduleClose.run(closeAt, kind, channelId);
  },
  /** Cancel a pending scheduled close (e.g. activity resumed). */
  cancelTicketClose(channelId) {
    stmts.cancelClose.run(channelId);
  },
  /** Set the per-guild inactivity auto-close window in minutes (0 = disabled). */
  setTicketInactivity(guildId, minutes) {
    ensureGuild(guildId);
    stmts.setInactivity.run(minutes, guildId);
  },

  // ── Rotating statuses ──────────────────────────────────────────────────────
  /** Add a rotating status line. Returns the new row's id. */
  addStatus(text, type, presence, duration, addedBy) {
    const info = stmts.addStatus.run(text, type, presence, duration ?? 30, addedBy ?? null);
    return Number(info.lastInsertRowid);
  },
  /** All statuses, ordered oldest-first. */
  getStatuses() {
    return stmts.getStatuses.all();
  },
  getStatus(id) {
    return stmts.getStatus.get(id);
  },
  /** Remove a status by id. Returns true if a row was deleted. */
  removeStatus(id) {
    return stmts.removeStatus.run(id).changes > 0;
  },
  /** Remove ALL statuses. Returns the number of rows deleted. */
  clearStatuses() {
    return stmts.clearStatuses.run().changes;
  },
  countStatuses() {
    return stmts.countStatuses.get().n;
  },

  // ── Giveaways ────────────────────────────────────────────────────────────
  /**
   * Create a giveaway row. Returns its new id.
   * @param {object} g
   * @param {string} g.guildId
   * @param {string} g.channelId
   * @param {string} g.prize
   * @param {number} g.winnersCount
   * @param {string} g.hostId
   * @param {string|null} [g.requiredRoleId]
   * @param {number} g.endAt  Unix seconds when the giveaway ends.
   */
  createGiveaway({ guildId, channelId, prize, winnersCount, hostId, requiredRoleId = null, endAt }) {
    const info = stmts.insertGiveaway.run(
      guildId,
      channelId,
      prize,
      winnersCount,
      hostId,
      requiredRoleId,
      endAt
    );
    return Number(info.lastInsertRowid);
  },
  /** Store the posted message id so the sweeper can edit it later. */
  setGiveawayMessage(id, messageId) {
    stmts.setGiveawayMessage.run(messageId, id);
  },
  getGiveaway(id) {
    return stmts.getGiveaway.get(id);
  },
  getGiveawayByMessage(messageId) {
    return stmts.getGiveawayByMessage.get(messageId);
  },
  /** All running giveaways (across guilds) — used by the sweeper. */
  getActiveGiveaways() {
    return stmts.activeGiveaways.all();
  },
  /** Most recent giveaways for a guild (default 10). */
  getGuildGiveaways(guildId, limit = 10) {
    return stmts.guildGiveaways.all(guildId, limit);
  },
  /** Mark a giveaway drawn, storing the winner IDs (array). */
  markGiveawayEnded(id, winnerIds) {
    stmts.markGiveawayEnded.run(JSON.stringify(winnerIds ?? []), id);
  },
  /** Overwrite the stored winners (used by reroll). */
  setGiveawayWinners(id, winnerIds) {
    stmts.setGiveawayWinners.run(JSON.stringify(winnerIds ?? []), id);
  },
  /** Add an entrant. Returns true if this was a new entry. */
  addGiveawayEntry(giveawayId, userId) {
    return stmts.addGiveawayEntry.run(giveawayId, userId).changes > 0;
  },
  /** Remove an entrant (leave). Returns true if a row was removed. */
  removeGiveawayEntry(giveawayId, userId) {
    return stmts.removeGiveawayEntry.run(giveawayId, userId).changes > 0;
  },
  hasGiveawayEntry(giveawayId, userId) {
    return Boolean(stmts.hasGiveawayEntry.get(giveawayId, userId));
  },
  countGiveawayEntries(giveawayId) {
    return stmts.countGiveawayEntries.get(giveawayId).n;
  },
  /** Array of entrant user IDs. */
  getGiveawayEntries(giveawayId) {
    return stmts.getGiveawayEntries.all(giveawayId).map((r) => r.user_id);
  },

  // ── Per-event log channels (leave|ban|kick|embed) ──────────────────────────
  setEventLog(guildId, type, channelId) {
    stmts.setEventLog.run(guildId, type, channelId);
  },
  getEventLog(guildId, type) {
    return stmts.getEventLog.get(guildId, type)?.channel_id ?? null;
  },
  getAllEventLogs(guildId) {
    const out = {};
    for (const row of stmts.getAllEventLogs.all(guildId)) out[row.log_type] = row.channel_id;
    return out;
  },
  removeEventLog(guildId, type) {
    return stmts.removeEventLog.run(guildId, type).changes > 0;
  },
};

/** Gracefully close the DB (call on shutdown). */
export function closeDatabase() {
  try {
    db.close();
    logger.info('Database connection closed.');
  } catch (err) {
    logger.error('Error closing database:', err.message);
  }
}

export default db;
