// automod/db.js
// SEPARATE SQLite database for the auto-mod subsystem (data/automod.sqlite),
// using Node's built-in node:sqlite. Kept distinct from the host bot's
// data/bot.sqlite so integration cannot affect existing tables/queries.

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'automod.sqlite'));
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// ── Schema ─────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id        TEXT PRIMARY KEY,
    log_channel_id  TEXT,
    raid_mode       INTEGER NOT NULL DEFAULT 0,
    raid_mode_until INTEGER,
    prev_verification INTEGER,
    test_mode       INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at      INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS module_overrides (
    guild_id TEXT NOT NULL,
    module   TEXT NOT NULL,
    enabled  INTEGER NOT NULL,
    PRIMARY KEY (guild_id, module)
  );

  CREATE TABLE IF NOT EXISTS strikes (
    guild_id       TEXT NOT NULL,
    user_id        TEXT NOT NULL,
    count          INTEGER NOT NULL DEFAULT 0,
    last_strike_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    PRIMARY KEY (guild_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS strike_history (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id     TEXT NOT NULL,
    user_id      TEXT NOT NULL,
    rule         TEXT,
    reason       TEXT,
    action       TEXT,
    moderator_id TEXT,
    strike_count INTEGER,
    created_at   INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS blocklist (
    guild_id   TEXT NOT NULL,
    word       TEXT NOT NULL,
    category   TEXT NOT NULL DEFAULT 'general',
    added_by   TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    PRIMARY KEY (guild_id, word)
  );

  CREATE TABLE IF NOT EXISTS allowlist (
    guild_id   TEXT NOT NULL,
    domain     TEXT NOT NULL,
    added_by   TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    PRIMARY KEY (guild_id, domain)
  );

  CREATE INDEX IF NOT EXISTS idx_history_user ON strike_history (guild_id, user_id, created_at DESC);
`);

// ── Lightweight migrations ───────────────────────────────────────────────────
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
    logger.info(`[automod] Migration: added column ${table}.${column}.`);
  }
}
ensureColumn('guild_settings', 'test_mode', 'test_mode INTEGER NOT NULL DEFAULT 0');

// Generic key/value store for small feature state (e.g. availability responder).
db.exec(`CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT);`);

// ── Prepared statements ──────────────────────────────────────────────────────
const stmts = {
  upsertGuild: db.prepare(`INSERT INTO guild_settings (guild_id) VALUES (?) ON CONFLICT(guild_id) DO NOTHING`),
  getGuild: db.prepare(`SELECT * FROM guild_settings WHERE guild_id = ?`),
  setLogChannel: db.prepare(`UPDATE guild_settings SET log_channel_id = ?, updated_at = strftime('%s','now') WHERE guild_id = ?`),
  setRaidMode: db.prepare(`UPDATE guild_settings SET raid_mode = ?, raid_mode_until = ?, prev_verification = ?, updated_at = strftime('%s','now') WHERE guild_id = ?`),
  setTestMode: db.prepare(`UPDATE guild_settings SET test_mode = ?, updated_at = strftime('%s','now') WHERE guild_id = ?`),

  getOverride: db.prepare(`SELECT enabled FROM module_overrides WHERE guild_id = ? AND module = ?`),
  getOverrides: db.prepare(`SELECT module, enabled FROM module_overrides WHERE guild_id = ?`),
  setOverride: db.prepare(`
    INSERT INTO module_overrides (guild_id, module, enabled) VALUES (?, ?, ?)
    ON CONFLICT(guild_id, module) DO UPDATE SET enabled = excluded.enabled
  `),

  getStrikes: db.prepare(`SELECT count, last_strike_at FROM strikes WHERE guild_id = ? AND user_id = ?`),
  bumpStrikes: db.prepare(`
    INSERT INTO strikes (guild_id, user_id, count, last_strike_at)
    VALUES (?, ?, 1, strftime('%s','now'))
    ON CONFLICT(guild_id, user_id) DO UPDATE SET count = count + 1, last_strike_at = strftime('%s','now')
  `),
  setStrikes: db.prepare(`
    INSERT INTO strikes (guild_id, user_id, count, last_strike_at)
    VALUES (?, ?, ?, strftime('%s','now'))
    ON CONFLICT(guild_id, user_id) DO UPDATE SET count = excluded.count, last_strike_at = strftime('%s','now')
  `),
  clearStrikes: db.prepare(`DELETE FROM strikes WHERE guild_id = ? AND user_id = ?`),
  decayReset: db.prepare(`DELETE FROM strikes WHERE last_strike_at < ?`),

  addHistory: db.prepare(`
    INSERT INTO strike_history (guild_id, user_id, rule, reason, action, moderator_id, strike_count)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
  getHistory: db.prepare(`SELECT * FROM strike_history WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT ?`),
  clearHistory: db.prepare(`DELETE FROM strike_history WHERE guild_id = ? AND user_id = ?`),

  addBlock: db.prepare(`
    INSERT INTO blocklist (guild_id, word, category, added_by) VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id, word) DO UPDATE SET category = excluded.category
  `),
  removeBlock: db.prepare(`DELETE FROM blocklist WHERE guild_id = ? AND word = ?`),
  listBlock: db.prepare(`SELECT word, category FROM blocklist WHERE guild_id = ? ORDER BY word ASC`),

  addAllow: db.prepare(`INSERT OR IGNORE INTO allowlist (guild_id, domain, added_by) VALUES (?, ?, ?)`),
  removeAllow: db.prepare(`DELETE FROM allowlist WHERE guild_id = ? AND domain = ?`),
  listAllow: db.prepare(`SELECT domain FROM allowlist WHERE guild_id = ? ORDER BY domain ASC`),

  kvGet: db.prepare(`SELECT value FROM kv WHERE key = ?`),
  kvSet: db.prepare(`INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`),
};

function ensureGuild(guildId) {
  stmts.upsertGuild.run(guildId);
  return stmts.getGuild.get(guildId);
}

export const Store = {
  ensureGuild,

  getLogChannel(guildId) {
    return ensureGuild(guildId)?.log_channel_id ?? null;
  },
  setLogChannel(guildId, channelId) {
    ensureGuild(guildId);
    stmts.setLogChannel.run(channelId, guildId);
  },

  isModuleEnabled(guildId, module, fallback) {
    const row = stmts.getOverride.get(guildId, module);
    if (row === undefined) return Boolean(fallback);
    return row.enabled === 1;
  },
  getModuleOverrides(guildId) {
    const out = {};
    for (const row of stmts.getOverrides.all(guildId)) out[row.module] = row.enabled === 1;
    return out;
  },
  setModule(guildId, module, enabled) {
    ensureGuild(guildId);
    stmts.setOverride.run(guildId, module, enabled ? 1 : 0);
  },

  getStrikes(guildId, userId) {
    return stmts.getStrikes.get(guildId, userId) ?? { count: 0, last_strike_at: 0 };
  },
  addStrike(guildId, userId) {
    stmts.bumpStrikes.run(guildId, userId);
    return stmts.getStrikes.get(guildId, userId).count;
  },
  setStrikes(guildId, userId, count) {
    stmts.setStrikes.run(guildId, userId, count);
  },
  clearStrikes(guildId, userId) {
    return stmts.clearStrikes.run(guildId, userId).changes > 0;
  },
  decayStrikes(days) {
    const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
    return stmts.decayReset.run(cutoff).changes;
  },

  addHistory({ guildId, userId, rule, reason, action, moderatorId, strikeCount }) {
    stmts.addHistory.run(guildId, userId, rule ?? null, reason ?? null, action ?? null, moderatorId ?? null, strikeCount ?? null);
  },
  getHistory(guildId, userId, limit = 15) {
    return stmts.getHistory.all(guildId, userId, limit);
  },
  clearHistory(guildId, userId) {
    return stmts.clearHistory.run(guildId, userId).changes;
  },

  addBlockword(guildId, word, category, addedBy) {
    ensureGuild(guildId);
    stmts.addBlock.run(guildId, word.toLowerCase(), category ?? 'general', addedBy ?? null);
  },
  removeBlockword(guildId, word) {
    return stmts.removeBlock.run(guildId, word.toLowerCase()).changes > 0;
  },
  listBlockwords(guildId) {
    return stmts.listBlock.all(guildId);
  },

  addAllowDomain(guildId, domain, addedBy) {
    ensureGuild(guildId);
    stmts.addAllow.run(guildId, domain.toLowerCase(), addedBy ?? null);
    return true;
  },
  removeAllowDomain(guildId, domain) {
    return stmts.removeAllow.run(guildId, domain.toLowerCase()).changes > 0;
  },
  listAllowDomains(guildId) {
    return stmts.listAllow.all(guildId).map((r) => r.domain);
  },

  getRaidState(guildId) {
    const g = ensureGuild(guildId);
    return { active: g.raid_mode === 1, until: g.raid_mode_until, prevVerification: g.prev_verification };
  },
  setRaidMode(guildId, active, until, prevVerification) {
    ensureGuild(guildId);
    stmts.setRaidMode.run(active ? 1 : 0, until ?? null, prevVerification ?? null, guildId);
  },

  getTestMode(guildId) {
    return ensureGuild(guildId).test_mode === 1;
  },
  setTestMode(guildId, on) {
    ensureGuild(guildId);
    stmts.setTestMode.run(on ? 1 : 0, guildId);
  },

  // ── Generic key/value (feature state) ───────────────────────────────────────
  kvGet(key, fallback = null) {
    const row = stmts.kvGet.get(key);
    return row ? row.value : fallback;
  },
  kvSet(key, value) {
    stmts.kvSet.run(key, String(value));
  },
};

/** Close the auto-mod DB (called from the host bot's shutdown). */
export function closeAutomodDatabase() {
  try {
    db.close();
    logger.info('[automod] Database connection closed.');
  } catch (err) {
    logger.error('[automod] Error closing database:', err.message);
  }
}

export default db;
