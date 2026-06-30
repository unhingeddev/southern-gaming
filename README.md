# SellAuth Discord Bot

A production-ready Discord bot (Node.js + [discord.js](https://discord.js.org) v14) that integrates with the **SellAuth API** to:

- 📈 Display the latest **vouches/reviews** and **recent purchases**
- 🤖 **Auto-post** new vouches and purchases to configured channels (with duplicate prevention)
- 🧹 **Nuke** channels (admin-only, with confirmation + audit logging)
- 🔐 Store secrets **encrypted at rest**, never exposing API keys, emails, IPs, or tokens
- ⚙️ Full slash-command configuration system, cooldowns, and graceful error handling

---

## 📁 Project structure

```
bot/
├── commands/          # One file per slash command
├── events/            # Discord gateway event handlers (ready, interactionCreate)
├── services/          # SellAuth API client + automation poller
├── handlers/          # Dynamic command & event loaders
├── database/          # SQLite persistence layer (better-sqlite3)
├── config/            # Validated environment configuration
├── utils/             # logger, embeds, crypto, cooldowns, audit
├── data/              # SQLite database file (auto-created, git-ignored)
├── logs/              # Daily log files (auto-created, git-ignored)
├── index.js           # Entry point
├── deploy-commands.js # Slash-command registration script
├── .env.example       # Copy to .env and fill in
└── package.json
```

---

## ✅ Requirements

- **Node.js 18+** (developed/tested on Node 24)
- A Discord application + bot token — https://discord.com/developers/applications
- A SellAuth account with an **API key** and **Shop ID**

---

## 🚀 Installation

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file
cp .env.example .env       # Windows PowerShell: Copy-Item .env.example .env

# 3. Fill in .env (see the variable reference below)

# 4. Register the slash commands with Discord
npm run deploy

# 5. Start the bot
npm start
```

> 💡 For instant slash-command updates while testing, set `DISCORD_GUILD_ID` in
> `.env` to your test server's ID. Leave it blank to register **globally**
> (which can take up to an hour to propagate).

### Test server vs. live server

This bot is set up to **test on one server and run on another**. Command
registration is per-guild (instant), driven by two `.env` values:

| Variable | Purpose |
| --- | --- |
| `DISCORD_GUILD_ID` | Your **test** server |
| `DISCORD_LIVE_GUILD_ID` | Your **live/production** server |

| Command | What it does |
| --- | --- |
| `npm run deploy` | Push commands to the **test** server (instant) — use while iterating |
| `npm run deploy:live` | Push commands to the **live** server once you're happy |
| `npm run deploy:all` | Push to **both** at once |
| `npm run clear:global` | Remove any leftover global commands (avoids duplicates) |

All other settings (vouch/purchase/log channels, ticket config, automation
toggles) are **per-server**, so testing on one server never affects the other.
Your SellAuth API key in `.env` is shared, so you don't re-enter it per server.

---

## 🔐 Environment variables (`.env`)

| Variable | Required | Description |
| --- | --- | --- |
| `DISCORD_TOKEN` | ✅ | Bot token from the Developer Portal. **Keep secret.** |
| `DISCORD_CLIENT_ID` | ✅ | Application (client) ID. |
| `DISCORD_CLIENT_SECRET` | – | OAuth2 secret (only needed for OAuth flows). |
| `DISCORD_GUILD_ID` | – | Test guild for instant command registration. |
| `SELLAUTH_API_BASE` | – | Defaults to `https://api.sellauth.com/v1`. |
| `SELLAUTH_API_KEY` | – | Global fallback key (per-guild `/setapikey` overrides it). |
| `SELLAUTH_SHOP_ID` | – | Global fallback Shop ID. |
| `ENCRYPTION_KEY` | ✅ | 64 hex chars (32 bytes) for encrypting stored API keys. |
| `POLL_INTERVAL_SECONDS` | – | Automation poll frequency (default 120). |
| `COMMAND_COOLDOWN_SECONDS` | – | Default per-command cooldown (default 3). |
| `LOG_LEVEL` | – | `debug` \| `info` \| `warn` \| `error`. |

Generate an encryption key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 🎮 Commands

### SellAuth setup (admin)
| Command | Description |
| --- | --- |
| `/setapikey` | Store this server's SellAuth API key (encrypted) + optional Shop ID |
| `/testconnection` | Verify the API connection |

### Channel configuration (admin)
| Command | Description |
| --- | --- |
| `/setvouchchannel` | Channel for auto-posted vouches |
| `/setpurchasechannel` | Channel for auto-posted purchases |
| `/setlogchannel` | Channel for audit logs |

### Automation (admin)
| Command | Description |
| --- | --- |
| `/startvouches` · `/stopvouches` | Toggle vouch auto-posting |
| `/startpurchases` · `/stoppurchases` | Toggle purchase auto-posting |

### Utility
| Command | Description |
| --- | --- |
| `/vouch <product> <rating> <review> [image]` | Submit a vouch — posts a rich "Customer Vouch" card to the vouch channel. 30s cooldown. |
| `/vouches [count]` | Show latest reviews |
| `/recentpurchases [count]` | Show recent orders |
| `/status` | Show config + connection (admin) |
| `/reload` | Hot-reload command modules (admin) |
| `/help` | List all commands |

### Moderation
| Command | Description |
| --- | --- |
| `/kick <user> [reason]` | Kick a member. Requires **Kick Members**; enforces role hierarchy; DMs the user; audited. |
| `/ban <user> [reason] [delete_days]` | Ban a user (works by ID even if they've left). Requires **Ban Members**; optional 0–7 day message purge; enforces hierarchy; DMs the user; audited. |
| `/unban <user_id> [reason]` | Lift a ban by user ID. Requires **Ban Members**; checks the ban exists; audited. |
| `/timeout <user> <duration> [reason]` | Time out (mute) a member for a preset duration, or pick **Remove timeout** to clear it. Requires **Timeout Members**; enforces hierarchy; DMs the user; audited. |
| `/nuke [channel]` | Wipe all messages by recreating the channel (confirmation + audit) |
| `/embed [channel]` | Opens a modal to compose a rich embed (title, **multi-paragraph description**, color, footer, image) and posts it to the channel. Requires Manage Messages. |

### Roles & auto-roles (admin)
| Command | Description |
| --- | --- |
| `/roles set <type> <role>` | Register a named role: Owner, Co-owner, Staff, Buyers, or Members. |
| `/roles view` | Show all configured named roles + auto-roles. |
| `/roles auto add <role>` | Auto-assign a role to members when they join. |
| `/roles auto remove <role>` | Stop auto-assigning a role. |
| `/roles auto list` | List auto-assigned roles. |

> ⚠️ **Auto-roles require the privileged "Server Members Intent"** (Developer
> Portal → your app → Bot → Privileged Gateway Intents). The bot's role must also
> be **above** any role it auto-assigns, and it needs **Manage Roles**.

### Tickets
| Command | Description |
| --- | --- |
| `/ticketconfig <support_role> <category>` | Set the support role (sees all tickets) and the category new tickets are created under. |
| `/ticketcategory add\|remove\|list` | Manage the ticket **types** shown in a dropdown panel (label + description + emoji). |
| `/ticketpanel [channel] [style]` | Opens a modal to design the panel (title, multi-paragraph description, color, footer, action label). `style` = **Button** (single Open Ticket button) or **Dropdown** (members pick a ticket type). |
| `/close [reason]` | Close the current ticket (opener or support staff). |

Ticket setup commands are usable by the configured **Owner / Co-owner** roles or server admins.

**Button flow:** `/ticketconfig` → `/ticketpanel` → members click **Open Ticket**.
**Dropdown flow:** `/ticketconfig` → `/ticketcategory add` (a few times) → `/ticketpanel style:Dropdown` → members pick a type from the menu.

Either way a private channel is created for the opener + support, with **Claim**/**Close** buttons inside. One open ticket per user; events go to your `/setlogchannel`. Requires **Manage Channels** + **Manage Roles**.

### Presence (bot owner)
| Command | Description |
| --- | --- |
| `/statusadd` | Add a line to the bot's **rotating status**. Owner-only (presence is global). Options: `text`, `type` (Playing/Watching/Listening/Competing/Custom), `presence` (online/idle/dnd), and `duration` — how many seconds *this* status shows before rotating (5–3600, default 30). Placeholders `{servers}`, `{users}`, `{ping}` are filled live. `STATUS_ROTATE_SECONDS` (default 30) is the fallback duration when one isn't given. |
| `/statusclear` | Remove **all** rotating statuses at once (owner-only, with button confirmation). The bot falls back to its default status. |

---

## 🔒 Security model

- **Secrets in `.env` only** — never hardcoded; `.env` is git-ignored.
- **API keys encrypted at rest** with AES-256-GCM (`utils/crypto.js`); only ciphertext touches the database.
- **PII stripping** — the SellAuth client only surfaces display-safe fields. Emails and IPs are redacted as defence-in-depth (`services/sellauth.js`).
- **Least privilege** — the bot requests no privileged intents (no Message Content / Members).
- **Admin gating** — sensitive commands require Administrator (enforced both by Discord and re-checked in code).
- **Cooldowns** prevent command spam; `/nuke` requires explicit button confirmation.
- **Audit logging** — config changes and nukes are logged to file and the configured log channel with who/when.

> ⚠️ If a token or key is ever exposed, **reset it immediately** in the Discord
> Developer Portal / SellAuth dashboard and update `.env`.

---

## 🩹 Error handling

The bot is built to degrade gracefully:

- **SellAuth outages / timeouts / 5xx** → retried with exponential backoff (`services/sellauth.js`); automation simply tries again next cycle.
- **Rate limits (429)** → honoured via `Retry-After`.
- **Auth failures (401/403)** → surfaced as a clear "check your API key" message, not retried.
- **Malformed responses** → validated; non-JSON is rejected rather than crashing.
- **Command errors** → caught centrally in `events/interactionCreate.js` and shown to the user as a clean ephemeral embed while the full stack is logged.
- **Process-level** → `unhandledRejection` / `uncaughtException` are logged, and `SIGINT`/`SIGTERM` trigger a clean shutdown (DB closed, poller stopped).

### Example: handling a SellAuth failure in a command
```js
try {
  const vouches = await sa.getVouches(count);
  // ...render embeds...
} catch (err) {
  // err.message is safe to show; secrets are never included.
  await interaction.editReply({
    embeds: [Embeds.error('Could not fetch vouches', `SellAuth said: ${err.message}`)],
  });
}
```

---

## 🧩 Discohook-compatible embeds

`utils/embeds.js` exports `Embeds.fromDiscohook(obj)`, which accepts a
[Discohook](https://discohook.org)-style embed object (`title`, `description`,
`color`, `author`, `fields`, `footer`, `image`, …) and returns a discord.js
`EmbedBuilder`. This lets you design embeds visually in Discohook, then drop the
JSON straight into the bot.

---

## 🛠️ Required bot permissions / intents

When generating the invite link (OAuth2 → URL Generator), grant:

- **Scopes:** `bot`, `applications.commands`
- **Permissions:** View Channels, Send Messages, Embed Links, Read Message
  History, **Manage Channels** (for `/nuke`), **Kick Members** (for `/kick`),
  **Ban Members** (for `/ban` and `/unban`), **Timeout Members** (for `/timeout`).

No privileged gateway intents are needed.

---

## 📜 License

MIT
